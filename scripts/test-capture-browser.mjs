import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdir, readFile, writeFile, copyFile, cp, symlink, access } from "node:fs/promises";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import http from "node:http";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

assert.equal(process.platform, "win32", "Requires Windows, WebView2 and installed Chrome/Edge");
const root = fileURLToPath(new URL("../", import.meta.url));
const token = randomUUID().replaceAll("-", "");
const run = path.join(root, ".research-local/capture-browser", token);
const identifier = `com.zipzap.capture.t${token}`;
const state = path.join(process.env.LOCALAPPDATA, identifier);
const local = path.join(run, "local"),
  output = path.join(run, "output"),
  extension = path.join(run, "extension");
const executable = path.join(run, "zipzap-desktop.exe"),
  host = `com.zipzap.test.h${token}`;
const manifest = path.join(run, "host.json");
const { id } = JSON.parse(await readFile(path.join(root, "extensions/browser/identity.json")));
const keys = (name) =>
  ["Google\\Chrome", "Microsoft\\Edge"].map(
    (vendor) => `HKCU\\Software\\${vendor}\\NativeMessagingHosts\\${name}`,
  );
function readRegistration(name) {
  return keys(name).map((key) => {
    const result = spawnSync("reg.exe", ["query", key, "/ve"], {
      encoding: "utf8",
      windowsHide: true,
    });
    return [result.status, result.stdout.trim()];
  });
}
const ordinary = readRegistration("com.zipzap.native");
assert.ok(/^com\.zipzap\.test\.h[a-f0-9]{32}$/.test(host));
assert.ok(
  readRegistration(host).every(([code]) => code !== 0),
  "Private host already exists",
);
await mkdir(run, { recursive: true });
await mkdir(local);
await mkdir(output);
await mkdir(state); // A fresh unique identity, never the user's normal database.
await symlink(state, path.join(local, "com.zipzap.desktop"), "junction");
await writeFile(path.join(run, "identity.json"), JSON.stringify({ identifier, state, host }));
const config = path.join(run, "tauri.json");
await writeFile(
  config,
  JSON.stringify({
    identifier,
    productName: `ZipZap Capture Probe ${token}`,
    bundle: { externalBin: [] },
    app: {
      windows: [
        {
          label: "main",
          title: "ZipZap Capture Probe",
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
  { cwd: path.join(root, "apps/desktop"), stdio: "inherit", windowsHide: true },
);
assert.equal(build.status, 0, "Isolated app build failed");
await copyFile(path.join(root, "target/debug/zipzap-desktop.exe"), executable);
assert.ok(
  (await readFile(executable)).includes(Buffer.from(identifier)),
  "Build identity mismatch",
);
// The app must not find a production-named sidecar and register the ordinary host.
await assert.rejects(access(path.join(run, "zipzap-native.exe")));
await copyFile(path.join(root, "target/debug/zipzap-native.exe"), path.join(run, "host.exe"));
await cp(path.join(root, "dist/extension"), extension, { recursive: true });
await writeFile(
  path.join(extension, "shared.js"),
  (await readFile(path.join(extension, "shared.js"), "utf8")).replaceAll("com.zipzap.native", host),
);
// Lose one activation acknowledgment after the real host receives it; production code is unchanged.
await writeFile(
  path.join(extension, "fixture-fault.js"),
  `const original=chrome.runtime.sendNativeMessage.bind(chrome.runtime);
chrome.runtime.sendNativeMessage=(host,message,callback)=>original(host,message,response=>{
 if(message.version===3&&message.action==='activate'){
  chrome.storage.session.get('faulted').then(saved=>{if(saved.faulted)callback(response);else chrome.storage.session.set({faulted:true}).then(()=>setTimeout(()=>callback(response),6000));});
 }else callback(response);
});`,
);
const background = path.join(extension, "background.js");
await writeFile(background, `import './fixture-fault.js';\n${await readFile(background, "utf8")}`);
await writeFile(
  manifest,
  JSON.stringify({
    name: host,
    description: "Isolated capture fixture",
    path: path.join(run, "host.exe"),
    type: "stdio",
    allowed_origins: [`chrome-extension://${id}/`],
  }),
);

const bytes = Buffer.alloc(1024 * 1024);
for (let index = 0; index < bytes.length; index++)
  bytes[index] = (index * 31 + (index >>> 9)) & 255;
const digest = (value) => createHash("sha256").update(value).digest("hex");
const requests = [];
const server = http.createServer((request, response) => {
  requests.push({ path: request.url, range: request.headers.range || null });
  if (request.url === "/page") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="en"><title>Capture fixture</title><main><h1>Public files</h1><a id="file" download href="/file.zip">Download file</a></main></html>',
    );
    return;
  }
  if (!/^\/(file\.zip|explicit-\w+\.bin)$/.test(request.url)) {
    response.writeHead(404);
    response.end();
    return;
  }
  response.setHeader("Content-Type", "application/octet-stream");
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("ETag", '"capture-fixture-v1"');
  response.setHeader("Content-Disposition", `attachment; filename="${request.url.slice(1)}"`);
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
  const start = match ? Number(match[1]) : 0,
    end = match && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1;
  if (match) {
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  }
  response.setHeader("Content-Length", end - start + 1);
  response.end(bytes.subarray(start, end + 1));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
// Only this origin/scripting is pregranted to the test copy. Native consent prompts are not qualified here.
const extensionManifest = JSON.parse(await readFile(path.join(extension, "manifest.json")));
extensionManifest.permissions.push("scripting");
extensionManifest.host_permissions = ["http://127.0.0.1/*"];
await writeFile(path.join(extension, "manifest.json"), JSON.stringify(extensionManifest));
let app, webview, appPage;
async function startApp() {
  const portServer = net.createServer();
  portServer.listen(0, "127.0.0.1");
  await once(portServer, "listening");
  const port = portServer.address().port;
  await new Promise((resolve) => portServer.close(resolve));
  app = spawn(executable, [], {
    stdio: "ignore",
    windowsHide: true,
    env: {
      ...process.env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --force-renderer-accessibility`,
    },
  });
  for (let index = 0; index < 120; index++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/json/version`)).ok) break;
    } catch {}
    if (index === 119) throw new Error("Private WebView startup timeout");
    await delay(250);
  }
  webview = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  appPage = webview.contexts()[0].pages()[0];
  await appPage.waitForFunction(() => !!window.__TAURI_INTERNALS__);
  assert.ok(
    (await invoke("snapshot")).native_error,
    "Fixture must not register the ordinary sidecar",
  );
}
async function invoke(command, args) {
  return appPage.evaluate(({ command, args }) => window.__TAURI_INTERNALS__.invoke(command, args), {
    command,
    args,
  });
}
async function stopApp() {
  if (app?.exitCode === null) {
    // WebView can close before its quit IPC promise settles; the process must still exit cleanly.
    await invoke("quit_app").catch(() => {});
    for (let index = 0; index < 100 && app.exitCode === null; index++) await delay(100);
    assert.notEqual(app.exitCode, null, "Private app quit timeout");
  }
  if (app) assert.equal(app.exitCode, 0, "Private app did not quit cleanly");
  await webview?.close().catch(() => {});
}
async function waitJob(name) {
  for (let index = 0; index < 240; index++) {
    const job = (await invoke("snapshot")).jobs.findLast((job) => job.destination.endsWith(name));
    if (job?.status === "completed") return job;
    if (job?.status === "failed") throw new Error("Fixture transfer failed");
    await delay(250);
  }
  throw new Error("Fixture download timeout");
}
const results = [];
try {
  for (const key of keys(host))
    execFileSync("reg.exe", ["add", key, "/ve", "/t", "REG_SZ", "/d", manifest, "/f"], {
      windowsHide: true,
      stdio: "ignore",
    });
  await startApp();
  const snapshot = await invoke("snapshot");
  await invoke("save_settings", { settings: { ...snapshot.settings, download_folder: output } });
  await invoke("set_queue_running", { running: false });
  for (const channel of ["chrome", "msedge"]) {
    // The preceding explicit v2 action intentionally raises the app; reset this capture fixture.
    await stopApp();
    await startApp();
    // Distinct output directories avoid destination reuse between browsers.
    const folder = path.join(output, channel);
    await mkdir(folder);
    const snapshot = await invoke("snapshot");
    await invoke("save_settings", { settings: { ...snapshot.settings, download_folder: folder } });
    await invoke("set_queue_running", { running: false });
    const before = snapshot.jobs.length;
    const context = await chromium.launchPersistentContext(path.join(run, `${channel}-profile`), {
      channel,
      headless: true,
      timeout: 30000,
      acceptDownloads: true,
      downloadsPath: path.join(run, `${channel}-downloads`),
      ignoreDefaultArgs: ["--disable-extensions"],
      args: ["--enable-unsafe-extension-debugging"],
      env: { ...process.env, LOCALAPPDATA: local },
    });
    context.setDefaultTimeout(20000);
    try {
      const cdp = await context.browser().newBrowserCDPSession();
      assert.equal((await cdp.send("Extensions.loadUnpacked", { path: extension })).id, id);
      const popup = await context.newPage();
      await popup.goto(`chrome-extension://${id}/popup.html`);
      const setting = await popup.evaluate(
        (origin) =>
          chrome.runtime.sendMessage({ type: "zipzapSettings", action: "enable", origin }),
        origin,
      );
      assert.deepEqual(setting.sites, [origin]);
      const workerCDP = await context.newCDPSession(popup);
      let version;
      workerCDP.on("ServiceWorker.workerVersionUpdated", (event) => {
        for (const value of event.versions)
          if (value.scriptURL === `chrome-extension://${id}/background.js`)
            version = value.versionId;
      });
      await workerCDP.send("ServiceWorker.enable");
      const page = await context.newPage();
      let downloads = 0;
      page.on("download", () => downloads++);
      await page.goto(`${origin}/page`);
      await page.waitForTimeout(250);
      await page.locator("#file").click();
      await page
        .locator("[data-zipzap]")
        .getByRole("status")
        .filter({ hasText: "may own this download" })
        .waitFor();
      let saved = await invoke("snapshot");
      assert.equal(
        await invoke("plugin:window|is_visible", { label: "main" }),
        false,
        "Background capture raised the hidden fixture window",
      );
      assert.equal(saved.jobs.length, before + 1);
      assert.equal(saved.jobs.at(-1).status, "queued");
      assert.equal(downloads, 0);
      await assert.rejects(access(path.join(folder, "file.zip")));
      assert.ok(version, "Extension worker version missing");
      await workerCDP.send("ServiceWorker.stopWorker", { versionId: version });
      await stopApp();
      await startApp();
      await page
        .locator("[data-zipzap]")
        .getByRole("button", { name: "Check the same request" })
        .click();
      await page
        .locator("[data-zipzap]")
        .getByRole("status")
        .filter({ hasText: "Added to ZipZap" })
        .waitFor();
      assert.equal(downloads, 0);
      assert.equal((await invoke("snapshot")).jobs.length, before + 1);
      await invoke("set_queue_running", { running: true });
      const job = await waitJob("file.zip");
      assert.equal(digest(await readFile(job.destination)), digest(bytes));
      // Occupied destination: the app rejects before queueing; browser fallback occurs exactly once.
      const browserCopy = page.waitForEvent("download");
      await page.locator("#file").click();
      const download = await browserCopy;
      await download.path();
      assert.equal(downloads, 1);
      assert.equal((await invoke("snapshot")).jobs.length, before + 1);
      assert.equal(digest(await readFile(job.destination)), digest(bytes));
      // Actual v2 explicit popup handoff remains usable alongside optional capture.
      await popup.locator("#url").fill(`${origin}/explicit-${channel}.bin`);
      await popup.locator("form button").click();
      await popup.locator("#status.success").waitFor();
      const explicit = await waitJob(`explicit-${channel}.bin`);
      assert.equal(digest(await readFile(explicit.destination)), digest(bytes));
      const count = (await invoke("snapshot")).jobs.length;
      await popup.evaluate(
        (origin) =>
          chrome.runtime.sendMessage({ type: "zipzapSettings", action: "disable", origin }),
        origin,
      );
      const normal = page.waitForEvent("download");
      await page.locator("#file").click();
      await (await normal).path();
      assert.equal((await invoke("snapshot")).jobs.length, count);
      results.push({
        browser: channel,
        version: context.browser().version(),
        capture: "passed",
        lostActivationAck: "passed",
        workerAndAppRestart: "passed",
        heldQueue: "passed",
        destinationFallbackOnce: "passed",
        explicitV2: "passed",
        off: "passed",
        bytes: bytes.length,
        sha256: digest(bytes),
        permissionFixture: "pregranted; consent prompt not exercised",
      });
      console.log(JSON.stringify(results.at(-1)));
    } finally {
      await context.close();
    }
  }
} finally {
  try {
    await stopApp();
  } finally {
    if (app?.exitCode === null) app.kill();
    for (const key of keys(host))
      spawnSync("reg.exe", ["delete", key, "/f"], { windowsHide: true, stdio: "ignore" });
    server.close();
  }
  assert.deepEqual(
    readRegistration("com.zipzap.native"),
    ordinary,
    "Ordinary registration changed",
  );
}
await writeFile(
  path.join(run, "results.json"),
  JSON.stringify({ results, requests, identifier, webview: webview.version() }, null, 2),
);
assert.equal(results.length, 2);
