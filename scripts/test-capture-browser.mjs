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
assert.ok(
  process.argv.length <= 3 && (!process.argv[2] || process.argv[2] === "--video"),
  "usage: node scripts/test-capture-browser.mjs [--video]",
);
const videoMode = process.argv[2] === "--video";
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
if (videoMode)
  await cp(path.join(root, "dist/media"), path.join(run, "media"), { recursive: true });
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
let ownedVideo = Buffer.alloc(0);
if (videoMode) {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    ownedVideo = Buffer.from(
      await page.evaluate(async () => {
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 180;
        const context = canvas.getContext("2d");
        const recorder = new MediaRecorder(canvas.captureStream(10), {
            mimeType: "video/webm;codecs=vp8",
          }),
          parts = [];
        recorder.ondataavailable = (event) => parts.push(event.data);
        const stopped = new Promise((resolve) => {
          recorder.onstop = resolve;
        });
        let frame = 0;
        const timer = setInterval(() => {
          context.fillStyle = frame++ % 2 ? "#087f70" : "#df6b25";
          context.fillRect(0, 0, 320, 180);
        }, 40);
        recorder.start();
        await new Promise((resolve) => setTimeout(resolve, 400));
        recorder.stop();
        await stopped;
        clearInterval(timer);
        return Array.from(
          new Uint8Array(await new Blob(parts, { type: "video/webm" }).arrayBuffer()),
        );
      }),
    );
  } finally {
    await browser.close();
  }
  await writeFile(path.join(run, "owned.webm"), ownedVideo);
  assert.ok(ownedVideo.length > 110, "Owned fixture must contain encoded frames");
}
const server = http.createServer((request, response) => {
  const pathname = request.url.split("?")[0];
  requests.push({ path: request.url, range: request.headers.range || null });
  if (request.url === "/page") {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="en"><title>Capture fixture</title><main><h1>Public files</h1><a id="file" download href="/file.zip">Download file</a></main></html>',
    );
    return;
  }
  if (pathname === "/video-page" && videoMode) {
    response.setHeader("Content-Type", "text/html");
    response.end(
      '<!doctype html><html lang="en"><title>Owned media</title><main><h1>Owned public clip</h1><video controls muted width="640" height="360" src="/clip.webm?signature=fixture"></video></main></html>',
    );
    return;
  }
  if (!/^\/(file\.zip|explicit-\w+\.bin|clip\.webm)$/.test(pathname)) {
    response.writeHead(404);
    response.end();
    return;
  }
  const payload = pathname === "/clip.webm" ? ownedVideo : bytes;
  response.setHeader(
    "Content-Type",
    pathname === "/clip.webm" ? "video/webm" : "application/octet-stream",
  );
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("ETag", '"capture-fixture-v1"');
  response.setHeader(
    "Content-Disposition",
    `${pathname === "/clip.webm" ? "inline" : "attachment"}; filename="${pathname.slice(1)}"`,
  );
  const match = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || "");
  const start = match ? Number(match[1]) : 0,
    end = match && match[2] ? Math.min(Number(match[2]), payload.length - 1) : payload.length - 1;
  if (match) {
    response.statusCode = 206;
    response.setHeader("Content-Range", `bytes ${start}-${end}/${payload.length}`);
  }
  response.setHeader("Content-Length", end - start + 1);
  response.end(payload.subarray(start, end + 1));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const origin = `http://127.0.0.1:${server.address().port}`;
// Only this origin/scripting is pregranted to the test copy. Native consent prompts are not qualified here.
const extensionManifest = JSON.parse(await readFile(path.join(extension, "manifest.json")));
extensionManifest.permissions.push("scripting");
extensionManifest.host_permissions = ["http://127.0.0.1/*"];
if (videoMode) extensionManifest.host_permissions.push("https://www.youtube.com/*");
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
  appPage.setDefaultTimeout(20000);
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
function mp4Tracks(data) {
  function boxes(start, end) {
    const values = [];
    for (let offset = start; offset + 8 <= end;) {
      let size = data.readUInt32BE(offset),
        header = 8;
      if (size === 1) {
        size = Number(data.readBigUInt64BE(offset + 8));
        header = 16;
      }
      if (size === 0) size = end - offset;
      assert.ok(size >= header && offset + size <= end);
      values.push({
        type: data.toString("ascii", offset + 4, offset + 8),
        start: offset + header,
        end: offset + size,
      });
      offset += size;
    }
    return values;
  }
  const top = boxes(0, data.length),
    moov = top.find((box) => box.type === "moov");
  assert.ok(
    moov && top.some((box) => box.type === "ftyp") && top.some((box) => box.type === "mdat"),
  );
  const tracks = boxes(moov.start, moov.end)
    .filter((box) => box.type === "trak")
    .map((track) => {
      const mdia = boxes(track.start, track.end).find((box) => box.type === "mdia"),
        handler = boxes(mdia.start, mdia.end).find((box) => box.type === "hdlr");
      return data.toString("ascii", handler.start + 8, handler.start + 12);
    });
  assert.ok(tracks.includes("vide") && tracks.includes("soun"));
  return tracks;
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
    console.log(`${channel}: starting isolated capture checks`);
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
        .waitFor()
        .catch(async (error) => {
          console.log(
            `${channel}: initial capture feedback`,
            await page.locator('[data-zipzap="capture"]').getByRole("status").allTextContents(),
          );
          throw error;
        });
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
      let mediaEvidence;
      if (videoMode) {
        console.log(`${channel}: checking direct video and fullscreen recovery`);
        await stopApp();
        await startApp();
        await invoke("set_queue_running", { running: false });
        const videoBefore = (await invoke("snapshot")).jobs.length;
        await popup.evaluate(() => chrome.storage.session.set({ faulted: false }));
        await page.goto(`${origin}/video-page`);
        await page.bringToFront();
        await page.waitForFunction(() => document.querySelector("video")?.readyState >= 1);
        await page
          .locator('[data-zipzap="video"]')
          .getByRole("button", { name: /^Download with ZipZap/ })
          .click();
        await page
          .locator('[data-zipzap="capture"]')
          .getByRole("status")
          .filter({ hasText: "may own this download" })
          .waitFor();
        assert.equal((await invoke("snapshot")).jobs.length, videoBefore + 1);
        await assert.rejects(access(path.join(folder, "clip.webm")));
        await page.locator("video").evaluate((video) => video.requestFullscreen());
        await page.locator('[data-zipzap="video"]').waitFor({ state: "detached" });
        const recovered = await popup.evaluate(async (origin) => {
          const tab = (await chrome.tabs.query({})).find(
            (tab) => tab.url === `${origin}/video-page`,
          );
          return chrome.runtime.sendMessage({ type: "zipzapVideoFromPopup", tabId: tab.id });
        }, origin);
        assert.equal(recovered.state, "queued");
        assert.equal((await invoke("snapshot")).jobs.length, videoBefore + 1);
        await page.evaluate(() => document.exitFullscreen());
        await invoke("set_queue_running", { running: true });
        const direct = await waitJob("clip.webm");
        assert.equal(digest(await readFile(direct.destination)), digest(ownedVideo));
        await popup.evaluate(() =>
          chrome.runtime.sendMessage({
            type: "zipzapSettings",
            action: "enable",
            origin: "https://www.youtube.com",
          }),
        );
        console.log(`${channel}: checking public YouTube action`);
        await invoke("set_queue_running", { running: false });
        const youtubeBefore = (await invoke("snapshot")).jobs.length;
        await page.goto("https://www.youtube.com/watch?v=YE7VzlLtp-4&hl=en", {
          waitUntil: "domcontentloaded",
          timeout: 45000,
        });
        await page.bringToFront();
        const reject = page.getByRole("button", { name: "Reject all", exact: true });
        if (await reject.isVisible().catch(() => false)) await reject.click();
        await page.locator("video").first().scrollIntoViewIfNeeded();
        const downloadVideo = page
          .locator('[data-zipzap="video"]')
          .getByRole("button", { name: /^Download with ZipZap/ });
        await downloadVideo.waitFor({ timeout: 45000 }).catch(async (error) => {
          await page.screenshot({ path: path.join(run, `${channel}-youtube-failure.png`) });
          console.log(
            `${channel}: extension diagnostics`,
            await popup.evaluate(async () => ({
              settings: await chrome.runtime.sendMessage({
                type: "zipzapSettings",
                action: "read",
              }),
              scripts: await chrome.scripting.getRegisteredContentScripts(),
              permitted: await chrome.permissions.contains({
                permissions: ["scripting"],
                origins: ["https://www.youtube.com/*"],
              }),
            })),
          );
          console.log(
            `${channel}: watch-page diagnostics`,
            await page.evaluate(() => ({
              host: location.hostname,
              path: location.pathname,
              title: document.title,
              hidden: document.hidden,
              players: Array.from(document.querySelectorAll("video"))
                .slice(0, 8)
                .map((video) => ({
                  width: video.getBoundingClientRect().width,
                  height: video.getBoundingClientRect().height,
                  top: video.getBoundingClientRect().top,
                  bottom: video.getBoundingClientRect().bottom,
                  ready: video.readyState,
                })),
            })),
          );
          throw error;
        });
        await downloadVideo.click();
        const videoStatus = page.locator('[data-zipzap="capture"]').getByRole("status");
        await videoStatus.filter({ hasText: "Added to ZipZap" }).waitFor({ timeout: 65000 });
        assert.equal((await invoke("snapshot")).jobs.length, youtubeBefore + 1);
        await invoke("set_queue_running", { running: true });
        const youtube = await waitJob("-YE7VzlLtp-4.mp4");
        const data = await readFile(youtube.destination),
          reference = await fetch(youtube.url, { signal: AbortSignal.timeout(60000) });
        assert.equal(reference.status, 200);
        assert.equal(digest(Buffer.from(await reference.arrayBuffer())), digest(data));
        assert.equal(youtube.publication.sha256, digest(data));
        mediaEvidence = {
          direct: {
            bytes: ownedVideo.length,
            sha256: digest(ownedVideo),
            nativeFullscreenPopupRecovery: "passed",
          },
          youtube: {
            id: "YE7VzlLtp-4",
            bytes: data.length,
            sha256: digest(data),
            tracks: mp4Tracks(data),
            independentReference: "matched",
          },
        };
        await page.screenshot({ path: path.join(run, `${channel}-youtube.png`) });
        await page.goto(`${origin}/page`);
      }
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
        ...(mediaEvidence ? { media: mediaEvidence } : {}),
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
