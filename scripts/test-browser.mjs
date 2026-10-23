import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

// Requires the real installed host and an explicitly selected test destination.
const [url, destination] = process.argv.slice(2);
if (!url || !destination || process.platform !== "win32")
  throw new Error(
    "usage: node scripts/test-browser.mjs <fixture-url> <app-download-folder> (Windows)",
  );
const extension = fileURLToPath(new URL("../dist/extension", import.meta.url));
const { id } = JSON.parse(
  await readFile(new URL("../extensions/browser/identity.json", import.meta.url)),
);
for (const channel of ["chromium", "msedge"]) {
  const filename = `${channel}-${randomUUID()}.bin`;
  const profile = await mkdtemp(path.join(tmpdir(), "zipzap-browser-"));
  const context = await chromium.launchPersistentContext(profile, {
    channel,
    headless: false,
    timeout: 30000,
    ignoreDefaultArgs: ["--disable-extensions"],
    args:
      channel === "msedge"
        ? ["--enable-unsafe-extension-debugging"]
        : [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:
        "--remote-debugging-port=9223 --force-renderer-accessibility",
    },
  });
  try {
    if (channel === "msedge") {
      const cdp = await context.browser().newBrowserCDPSession();
      assert.equal((await cdp.send("Extensions.loadUnpacked", { path: extension })).id, id);
    }
    const page = await context.newPage();
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
    const fixture = await (await fetch(`${url}/browser.bin`)).arrayBuffer();
    assert.equal(
      createHash("sha256").update(bytes).digest("hex"),
      createHash("sha256").update(Buffer.from(fixture)).digest("hex"),
    );
    console.log(
      JSON.stringify({
        browser: channel,
        version: context.browser().version(),
        extension: id,
        size: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        result: "passed",
      }),
    );
    await page.locator("#url").fill("file:///private");
    await page.locator("form button").click();
    await page.locator("#status.error").waitFor();
  } finally {
    await context.close();
  }
}
