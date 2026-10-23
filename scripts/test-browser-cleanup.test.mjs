import assert from "node:assert/strict";
import { test } from "node:test";
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { testInstalledBrowsers } from "./test-browser.mjs";

test(
  "a stuck close stops only the private browser and preserves the handoff failure",
  {
    skip: process.platform !== "win32",
    timeout: 60000,
  },
  async () => {
    const root = fileURLToPath(new URL("../", import.meta.url));
    const run = path.join(root, ".research-local/browser-cleanup", randomUUID());
    const extension = path.join(run, "extension");
    await mkdir(run, { recursive: true });
    await cp(path.join(root, "dist/extension"), extension, { recursive: true });
    const shared = path.join(extension, "shared.js");
    // No registration exists for this private host; no personal native host is called.
    const host = `com.zipzap.test.h${randomUUID().replaceAll("-", "")}`;
    await writeFile(shared, (await readFile(shared, "utf8")).replaceAll("com.zipzap.native", host));
    const launch = chromium.launchPersistentContext;
    let browserPid;
    chromium.launchPersistentContext = async function (profile, options) {
      const context = await launch.call(this, profile, options);
      const process = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          String.raw`
      $escaped = [regex]::Escape($env:ZIPZAP_BROWSER_PROFILE)
      Get-CimInstance Win32_Process -Filter "name = 'chrome.exe'" | Where-Object { $_.CommandLine -match ('--user-data-dir=(?:"' + $escaped + '"|' + $escaped + ')(?:\s|$)') -and $_.CommandLine -notmatch '(?:^|\s)--type=' } | ForEach-Object ProcessId
    `,
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          timeout: 10000,
          env: { ...globalThis.process.env, ZIPZAP_BROWSER_PROFILE: profile },
        },
      );
      assert.equal(process.status, 0, process.stderr);
      browserPid = Number(process.stdout.trim());
      assert.ok(browserPid > 0);
      context.close = () => new Promise(() => {});
      return context;
    };
    try {
      await assert.rejects(
        testInstalledBrowsers("http://127.0.0.1:1", run, { extension }),
        (error) => {
          assert.ok(error instanceof AggregateError);
          assert.match(error.errors[0].message, /#status\.success/);
          assert.match(error.errors[1].message, /chrome: close browser timed out/);
          return true;
        },
      );
      const alive = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "$p = Get-Process -Id $env:ZIPZAP_BROWSER_PID -ErrorAction SilentlyContinue; if ($p -and -not $p.WaitForExit(5000)) { exit 1 }",
        ],
        {
          windowsHide: true,
          timeout: 10000,
          env: { ...process.env, ZIPZAP_BROWSER_PID: String(browserPid) },
        },
      );
      assert.equal(alive.status, 0, "Private browser survived the close timeout");
    } finally {
      chromium.launchPersistentContext = launch;
    }
  },
);
