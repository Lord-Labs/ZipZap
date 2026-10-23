import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath, pathToFileURL } from "node:url";

const { id } = JSON.parse(
  await readFile(new URL("../extensions/browser/identity.json", import.meta.url)),
);

async function stage(browser, name, operation, timeout) {
  console.log(JSON.stringify({ browser, stage: name, state: "starting" }));
  let timer;
  try {
    const result = await Promise.race([
      operation(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${browser}: ${name} timed out`)), timeout);
      }),
    ]);
    console.log(JSON.stringify({ browser, stage: name, state: "completed" }));
    return result;
  } catch (error) {
    console.error(JSON.stringify({ browser, stage: name, state: "failed", error: error.message }));
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function stopBrowser(profile) {
  const stopped = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      String.raw`
    $ErrorActionPreference='Stop'
    $escaped = [regex]::Escape($env:ZIPZAP_BROWSER_PROFILE)
    $argument = '--user-data-dir=(?:"' + $escaped + '"|' + $escaped + ')(?:\s|$)'
    foreach($browserProcess in @(Get-CimInstance Win32_Process -Filter "name = 'chrome.exe' or name = 'msedge.exe'" | Where-Object { $_.CommandLine -match $argument -and $_.CommandLine -notmatch '(?:^|\s)--type=' })) {
      & taskkill.exe /PID $browserProcess.ProcessId /T /F | Out-Null
      if ($LASTEXITCODE -ne 0) { throw 'Cannot stop private browser tree' }
    }
  `,
    ],
    {
      windowsHide: true,
      encoding: "utf8",
      timeout: 15000,
      env: { ...process.env, ZIPZAP_BROWSER_PROFILE: profile },
    },
  );
  assert.equal(stopped.status, 0, stopped.stderr || stopped.error?.message);
}

// Overrides let the same checks use a private extension/host and disposable app state.
export async function testInstalledBrowsers(
  url,
  destination,
  {
    extension = fileURLToPath(new URL("../dist/extension", import.meta.url)),
    env = process.env,
  } = {},
) {
  const results = [];
  for (const channel of ["chrome", "msedge"]) {
    const filename = `${channel}-${randomUUID()}.bin`;
    const profile = await mkdtemp(path.join(tmpdir(), "zipzap-browser-"));
    const context = await stage(
      channel,
      "launch",
      () =>
        chromium.launchPersistentContext(profile, {
          channel,
          headless: false,
          timeout: 30000,
          ignoreDefaultArgs: ["--disable-extensions"],
          args: ["--enable-unsafe-extension-debugging"],
          env,
        }),
      35000,
    );
    context.setDefaultTimeout(15000);
    context.setDefaultNavigationTimeout(15000);
    let result, failure;
    try {
      await stage(
        channel,
        "load extension",
        async () => {
          const cdp = await context.browser().newBrowserCDPSession();
          assert.equal((await cdp.send("Extensions.loadUnpacked", { path: extension })).id, id);
        },
        15000,
      );
      const page = await context.newPage();
      result = await stage(
        channel,
        "handoff and verify bytes",
        async () => {
          await page.goto(`chrome-extension://${id}/popup.html`, { timeout: 15000 });
          await page.locator("#url").fill(`${url}/${filename}`);
          await page.locator("form button").click();
          await page.locator("#status.success").waitFor({ timeout: 15000 });
          const output = path.join(destination, filename);
          for (let attempt = 0; attempt < 120; attempt++) {
            if (await stat(output).catch(() => null)) break;
            await delay(250);
          }
          const bytes = await readFile(output);
          const fixture = await (
            await fetch(`${url}/browser.bin`, { signal: AbortSignal.timeout(15000) })
          ).arrayBuffer();
          assert.equal(
            createHash("sha256").update(bytes).digest("hex"),
            createHash("sha256").update(Buffer.from(fixture)).digest("hex"),
          );
          return {
            browser: channel,
            version: context.browser().version(),
            extension: id,
            size: bytes.length,
            sha256: createHash("sha256").update(bytes).digest("hex"),
          };
        },
        60000,
      );
      await stage(
        channel,
        "reject invalid link",
        async () => {
          await page.locator("#url").fill("file:///private");
          await page.locator("form button").click();
          await page.locator("#status.error").waitFor();
        },
        15000,
      );
    } catch (error) {
      failure = error;
      throw error;
    } finally {
      try {
        await stage(channel, "close browser", () => context.close(), 15000);
      } catch (error) {
        try {
          stopBrowser(profile);
        } catch (cleanupError) {
          throw new AggregateError(
            [...(failure ? [failure] : []), error, cleanupError],
            `${channel}: check and cleanup failed`,
          );
        }
        if (failure)
          throw new AggregateError([failure, error], `${channel}: check and browser close failed`);
        throw error;
      }
    }
    results.push({
      ...result,
      invalidLink: "passed",
      browserClose: "passed",
      result: "passed",
    });
    console.log(JSON.stringify(results.at(-1)));
  }
  return results;
}

// Requires the real installed host and an explicitly selected test destination.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [url, destination] = process.argv.slice(2);
  if (!url || !destination || process.platform !== "win32")
    throw new Error(
      "usage: node scripts/test-browser.mjs <fixture-url> <app-download-folder> (Windows)",
    );
  await testInstalledBrowsers(url, destination);
}
