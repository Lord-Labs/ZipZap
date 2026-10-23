import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, cp, copyFile, readFile, writeFile, symlink } from "node:fs/promises";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testInstalledBrowsers } from "./test-browser.mjs";

assert.equal(process.platform, "win32", "Requires Windows, WebView2 and installed Chrome/Edge");
const root = fileURLToPath(new URL("../", import.meta.url));
const token = randomUUID().replaceAll("-", "");
const run = path.join(root, ".research-local/installed-browser", token);
const identifier = `com.zipzap.browser.t${token}`;
const state = path.join(process.env.LOCALAPPDATA, identifier);
const local = path.join(run, "local");
const output = path.join(run, "downloads");
const extension = path.join(run, "extension");
const host = `com.zipzap.test.h${token}`;
const manifest = path.join(run, "host.json");
const executable = path.join(run, "zipzap-desktop.exe");
const portServer = net.createServer().listen(0, "127.0.0.1");
await once(portServer, "listening");
const debugPort = portServer.address().port;
await new Promise((resolve) => portServer.close(resolve));
const keys = (name) =>
  ["Google\\Chrome", "Microsoft\\Edge"].map(
    (vendor) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${name}`,
  );
function registrations(name) {
  return keys(name).map((key) => {
    const value = spawnSync("reg.exe", ["query", key, "/ve"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return [value.status, value.stdout.trim()];
  });
}
const ordinary = registrations("com.zipzap.native");
assert.ok(registrations(host).every(([status]) => status !== 0));
const nativeBuild = spawnSync(
  "cargo",
  ["build", "-p", "zipzap-native", "-p", "zipzap-core", "--bins", "--locked"],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
assert.equal(nativeBuild.status, 0, "Native fixture build failed");
await mkdir(run, { recursive: true });
await mkdir(state);
await mkdir(local);
await mkdir(output);
await symlink(state, path.join(local, "com.zipzap.desktop"), "junction");
const config = path.join(run, "tauri.json");
await writeFile(
  config,
  JSON.stringify({
    identifier,
    productName: `ZipZap Browser Probe ${token}`,
    bundle: { externalBin: [] },
    app: {
      windows: [
        {
          label: "main",
          title: "ZipZap Browser Probe",
          visible: false,
          width: 780,
          height: 560,
          minWidth: 780,
          minHeight: 560,
        },
      ],
    },
  }),
);
const build = spawnSync(
  process.execPath,
  [
    path.join(root, "node_modules/@tauri-apps/cli/tauri.js"),
    "build",
    "--debug",
    "--no-bundle",
    "--config",
    config,
  ],
  {
    cwd: path.join(root, "apps/desktop"),
    stdio: "inherit",
    windowsHide: true,
  },
);
assert.equal(build.status, 0, "Isolated app build failed");
await copyFile(path.join(root, "target/debug/zipzap-desktop.exe"), executable);
assert.ok((await readFile(executable)).includes(Buffer.from(identifier)));
// The alternate sidecar name prevents the fixture app from registering the ordinary host.
await copyFile(path.join(root, "target/debug/zipzap-native.exe"), path.join(run, "host.exe"));
await cp(path.join(root, "dist/extension"), extension, { recursive: true });
const shared = path.join(extension, "shared.js");
await writeFile(shared, (await readFile(shared, "utf8")).replaceAll("com.zipzap.native", host));
const { id } = JSON.parse(await readFile(path.join(root, "extensions/browser/identity.json")));
await writeFile(
  manifest,
  JSON.stringify({
    name: host,
    description: "Isolated installed-browser test",
    path: path.join(run, "host.exe"),
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  }),
);

function core(input) {
  const answer = spawnSync(
    path.join(root, "target/debug/zipzap.exe"),
    [path.join(state, "zipzap.sqlite")],
    { input, encoding: "utf8", windowsHide: true, timeout: 15000 },
  );
  assert.equal(answer.status, 0, answer.stderr);
  const values = answer.stdout
    .trim()
    .split(/\r?\n/)
    .map((line) => JSON.parse(line));
  for (const value of values) assert.equal(value.error, undefined);
  return values;
}
const settings = core('{"command":"settings"}\n{"command":"shutdown"}\n')[0].result;
core(
  JSON.stringify({
    command: "settings",
    value: {
      ...settings,
      download_folder: output,
      close_to_tray: false,
      notifications: false,
      speed_limit: 0,
    },
  }) + '\n{"command":"shutdown"}\n',
);
const bytes = Buffer.alloc(1024 * 1024);
for (let index = 0; index < bytes.length; index++)
  bytes[index] = (index * 17 + (index >>> 12)) & 255;
const server = http.createServer((request, response) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Number(range[2]) : bytes.length - 1;
  assert.ok(start <= end && end < bytes.length);
  if (range) {
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  }
  response.setHeader("Content-Type", "application/octet-stream");
  response.setHeader("Content-Length", end - start + 1);
  response.setHeader("ETag", '"zipzap-browser-v1"');
  response.end(bytes.subarray(start, end + 1));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
let webview, results;
try {
  for (const key of keys(host))
    execFileSync("reg.exe", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  // Begin with no running fixture app: the native host must launch it. Browser close
  // must complete while that child app remains alive, exercising pipe inheritance.
  results = await testInstalledBrowsers(`http://127.0.0.1:${server.address().port}`, output, {
    extension,
    env: {
      ...process.env,
      LOCALAPPDATA: local,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${debugPort}`,
    },
  });
  webview = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, { timeout: 15000 });
  const page = webview.contexts()[0].pages()[0];
  const snapshot = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke("snapshot"));
  assert.equal(snapshot.jobs.length, 2);
  assert.ok(snapshot.jobs.every((job) => job.status === "completed"));
} finally {
  try {
    if (webview) {
      await webview
        .contexts()[0]
        .pages()[0]
        .evaluate(() => window.__TAURI_INTERNALS__.invoke("quit_app"))
        .catch(() => {});
      await webview.close().catch(() => {});
    }
    // Only the copied fixture executable may be stopped after a failed check.
    const closed = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `
      $ErrorActionPreference='Stop'
      foreach($fixtureProcess in @(Get-Process zipzap-desktop -ErrorAction SilentlyContinue | Where-Object Path -eq $env:ZIPZAP_BROWSER_EXE)) {
        if ($env:ZIPZAP_BROWSER_PASSED -eq 'true') {
          if (-not $fixtureProcess.WaitForExit(15000) -or $fixtureProcess.ExitCode -ne 0) { throw 'Private app did not exit cleanly' }
        } else { Stop-Process -Id $fixtureProcess.Id }
      }
    `,
      ],
      {
        windowsHide: true,
        timeout: 20000,
        env: {
          ...process.env,
          ZIPZAP_BROWSER_EXE: executable,
          ZIPZAP_BROWSER_PASSED: String(!!webview),
        },
      },
    );
    assert.equal(closed.status, 0, closed.stderr?.toString());
  } finally {
    for (const key of keys(host))
      spawnSync("reg.exe", ["delete", key, "/f"], { windowsHide: true, stdio: "ignore" });
    server.closeAllConnections();
    server.close();
    assert.deepEqual(registrations("com.zipzap.native"), ordinary, "Ordinary registration changed");
  }
}
await writeFile(
  path.join(run, "results.json"),
  JSON.stringify(
    {
      identifier,
      host,
      results,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      nativeLaunchedApp: "passed",
      browserCloseWithAppAlive: "passed",
      appClose: "passed",
      ordinaryRegistration: "unchanged",
      result: "passed",
    },
    null,
    2,
  ),
);
console.log(`Installed-browser evidence: ${path.join(run, "results.json")}`);
