import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, cp, copyFile, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "win32", "Requires Windows and installed Chrome/Edge");
const root = fileURLToPath(new URL("../", import.meta.url));
const run = path.join(root, ".research-local/browser-health", randomUUID());
const extension = path.join(run, "extension");
const host = `com.zipzap.test.h${randomUUID().replaceAll("-", "")}`;
const binary = path.join(run, "zipzap-native.exe");
const manifest = path.join(run, "host.json");
const { id } = JSON.parse(await readFile(path.join(root, "extensions/browser/identity.json")));
await mkdir(run, { recursive: true });
await cp(path.join(root, "dist/extension"), extension, { recursive: true });
await copyFile(path.join(root, "target/debug/zipzap-native.exe"), binary);
const shared = path.join(extension, "shared.js");
await writeFile(shared, (await readFile(shared, "utf8")).replaceAll("com.zipzap.native", host));
await writeFile(
  manifest,
  JSON.stringify({
    name: host,
    description: "Isolated ZipZap health test",
    path: binary,
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  }),
);

function registry(remove = false) {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `
    $ErrorActionPreference='Stop'
    if ($env:ZIPZAP_TEST_HOST -notmatch '^com\\.zipzap\\.test\\.h[a-f0-9]{32}$') { throw 'Invalid test identity' }
    foreach ($vendor in @('Google\\Chrome','Microsoft\\Edge')) {
      $key = 'HKCU:\\Software\\' + $vendor + '\\NativeMessagingHosts\\' + $env:ZIPZAP_TEST_HOST
      if ($env:ZIPZAP_TEST_REMOVE -eq 'true') {
        if (Test-Path -LiteralPath $key) { Remove-Item -LiteralPath $key }
      } else {
        if (Test-Path -LiteralPath $key) { throw 'Test registry entry already exists' }
        New-Item -Path $key -Force | Out-Null
        Set-Item -LiteralPath $key -Value $env:ZIPZAP_TEST_MANIFEST
      }
    }
  `,
    ],
    {
      windowsHide: true,
      env: {
        ...process.env,
        ZIPZAP_TEST_HOST: host,
        ZIPZAP_TEST_MANIFEST: manifest,
        ZIPZAP_TEST_REMOVE: String(remove),
      },
    },
  );
}

const results = [];
try {
  registry();
  for (const channel of ["chrome", "msedge"]) {
    const local = path.join(run, channel);
    const profile = path.join(local, "profile");
    await mkdir(local, { recursive: true });
    const context = await chromium.launchPersistentContext(profile, {
      channel,
      headless: true,
      timeout: 30000,
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging"],
      env: { ...process.env, LOCALAPPDATA: local },
    });
    context.setDefaultTimeout(10000);
    try {
      const cdp = await context.browser().newBrowserCDPSession();
      assert.equal((await cdp.send("Extensions.loadUnpacked", { path: extension })).id, id);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${id}/popup.html`);
      await page.locator("#check-connection").click();
      await page.locator("#health.pending").waitFor();
      const state = path.join(local, "com.zipzap.desktop");
      const contact = JSON.parse(
        await readFile(
          path.join(state, channel === "chrome" ? "contact-chrome.json" : "contact-edge.json"),
        ),
      );
      assert.ok(Date.now() / 1000 - contact.at < 30);
      await assert.rejects(access(path.join(state, "inbox")));
      await assert.rejects(access(path.join(state, "results")));
      // Synthetic heartbeat checks protocol fidelity, not actual desktop/database readiness.
      await writeFile(
        path.join(state, "app-ready.json"),
        JSON.stringify({ at: Math.floor(Date.now() / 1000), version: "fixture" }),
      );
      await page.locator("#check-connection").click();
      await page.locator("#health.success").waitFor();
      results.push({
        browser: channel,
        version: context.browser().version(),
        hostOnly: "passed",
        syntheticHeartbeat: "passed",
        jobsCreated: 0,
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      let timer;
      try {
        await Promise.race([
          context.close(),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error(`${channel} close timed out`)), 10000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    }
  }
} finally {
  registry(true);
}
assert.equal(results.length, 2);
await writeFile(path.join(run, "results.json"), JSON.stringify(results, null, 2));
