import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Test the built worker boundary with durable browser storage and controlled transport faults.
const id = "fixture-extension",
  origin = "https://example.com";
const local = {},
  session = {};
let allowed = false,
  listener,
  removed,
  registered = [],
  nativeCalls = [],
  state = "prepared",
  broken = false,
  pausePrepare = false,
  heldPrepare;
const storage = (data) => ({
  get: async (key) => ({ [key]: data[key] }),
  set: async (value) => Object.assign(data, value),
  setAccessLevel: async () => {},
});
globalThis.chrome = {
  i18n: { getMessage: (key) => key },
  storage: { local: storage(local), session: storage(session) },
  permissions: {
    contains: async () => allowed,
    remove: async () => true,
    onRemoved: {
      addListener: (value) => {
        removed = value;
      },
    },
  },
  tabs: { query: async () => [], sendMessage: async () => {} },
  action: { setBadgeText: async () => {} },
  scripting: {
    getRegisteredContentScripts: async () => registered,
    unregisterContentScripts: async () => {
      registered = [];
    },
    registerContentScripts: async (scripts) => {
      registered = scripts;
    },
  },
  runtime: {
    id,
    getURL: (file) => `chrome-extension://${id}/${file}`,
    onMessage: {
      addListener: (value) => {
        listener = value;
      },
    },
    onStartup: { addListener: () => {} },
    onInstalled: { addListener: () => {} },
    sendNativeMessage: (_host, message, callback) => {
      nativeCalls.push(message);
      if (broken) chrome.runtime.lastError = { message: "private path ?token=secret" };
      const deliver = () =>
        callback({
          version: 3,
          id: message.id,
          state: state.startsWith("reject:") ? "rejected" : state,
          ...(state.startsWith("reject:") ? { code: state.slice(7) } : {}),
        });
      if (pausePrepare && message.action === "prepare_video") {
        pausePrepare = false;
        heldPrepare = deliver;
      } else deliver();
      delete chrome.runtime.lastError;
    },
  },
};
const popup = { id, url: chrome.runtime.getURL("popup.html") };
const sender = {
  id,
  frameId: 0,
  documentId: "doc",
  url: `${origin}/page`,
  tab: { id: 1, incognito: false },
};
async function boot() {
  (await import(`../dist/extension/capture-background.js?worker=${randomUUID()}`)).installCapture();
}
async function send(message, source = sender) {
  return new Promise((resolve) => {
    if (listener(message, source, resolve) !== true) resolve(undefined);
  });
}
const operation = (action, key, url) => ({
  type: "zipzapCapture",
  id: key,
  action,
  ...(url ? { url } : {}),
});
const settings = (action, site) =>
  send({ type: "zipzapSettings", action, ...(site ? { origin: site } : {}) }, popup);
await boot();
assert.deepEqual(await send({ type: "zipzapPolicyRead" }), { enabled: false, video: false });
assert.deepEqual(await settings("read"), { sites: [], hiddenVideos: [] });
assert.deepEqual(await settings("enable", origin), { error: true });
assert.equal(nativeCalls.length, 0);
allowed = true;
assert.deepEqual(await settings("enable", origin), { sites: [origin], hiddenVideos: [] });
assert.equal(registered.length, 1);
assert.deepEqual(await send({ type: "zipzapPolicyRead" }), { enabled: true, video: true });

for (const invalid of [
  { ...sender, id: "foreign" },
  { ...sender, frameId: 1 },
  { ...sender, tab: { id: 1, incognito: true } },
  { ...sender, url: "file:///private" },
]) {
  await send(operation("prepare", randomUUID(), `${origin}/file.zip`), invalid);
}
assert.equal(nativeCalls.length, 0);
assert.equal(
  (await send(operation("prepare", randomUUID(), `${origin}/file.zip?secret=1`))).state,
  "fallback",
);
const key = randomUUID();
assert.equal((await send(operation("prepare", key, `${origin}/file.zip`))).state, "prepared");
assert.deepEqual(
  nativeCalls.map((value) => value.action),
  ["prepare"],
);
broken = true;
assert.equal((await send(operation("activate", key))).state, "unknown");
assert.equal(session.captureAttempts.find((value) => value.id === key).phase, "activate");
broken = false;
state = "queued";
await boot();
assert.equal((await send(operation("status", key))).state, "queued");
assert.equal(nativeCalls.filter((value) => value.action === "activate").length, 1);
assert.equal(
  (await send(operation("status", key), { ...sender, documentId: "other" })).state,
  "unknown",
);
assert.equal((await send(operation("prepare", key, `${origin}/different.zip`))).state, "unknown");
for (const [response, expected] of [
  ["reject:app_rejected", "fallback"],
  ["reject:capture_expired", "fallback"],
  ["reject:destination", "fallback"],
  ["reject:expired", "unknown"],
  ["reject:inbox_full", "unknown"],
  ["reject:host_rejected", "unknown"],
]) {
  state = "prepared";
  const key = randomUUID();
  await send(operation("prepare", key, `${origin}/file.zip`));
  state = response;
  assert.equal((await send(operation("activate", key))).state, expected);
}
broken = true;
assert.equal(
  (await send(operation("prepare", randomUUID(), `${origin}/file.zip`))).state,
  "fallback",
);
broken = false;
assert.ok(!JSON.stringify(session).includes("file.zip"));
assert.ok(!JSON.stringify(session).includes("secret"));
state = "prepared";
const watch = "https://www.youtube.com/watch?v=YE7VzlLtp-4",
  youtube = { ...sender, url: watch + "&list=ignored" };
await settings("enable", "https://www.youtube.com");
assert.equal((await send(operation("prepare_video", randomUUID(), watch))).state, "fallback");
const videoId = randomUUID();
assert.equal((await send(operation("prepare_video", videoId, watch), youtube)).state, "prepared");
assert.equal(
  (
    await send(
      operation("prepare_video", randomUUID(), "https://www.youtube.com/watch?v=AAAAAAAAAAA"),
      youtube,
    )
  ).state,
  "fallback",
);
await settings("video_hide", "https://www.youtube.com");
assert.equal((await send(operation("activate", videoId), youtube)).state, "fallback");
assert.equal((await send({ type: "zipzapPolicyRead" }, youtube)).video, false);
await settings("video_show", "https://www.youtube.com");
pausePrepare = true;
const cancelledId = randomUUID(),
  preparation = send(operation("prepare_video", cancelledId, watch), youtube);
for (let index = 0; index < 100 && !heldPrepare; index++)
  await new Promise((resolve) => setTimeout(resolve, 5));
assert.ok(heldPrepare);
assert.equal((await send(operation("cancel_prepare", cancelledId), youtube)).state, "cancelled");
heldPrepare();
assert.equal((await preparation).state, "unknown");
const activations = nativeCalls.filter((value) => value.action === "activate").length;
assert.equal((await send(operation("activate", cancelledId), youtube)).state, "unknown");
assert.equal(nativeCalls.filter((value) => value.action === "activate").length, activations);
const directId = randomUUID();
assert.equal(
  (
    await send(
      operation("prepare_video", directId, "https://cdn.example.com/clip.mp4?signature=private"),
    )
  ).state,
  "prepared",
);
assert.ok(!JSON.stringify(session).includes("signature"));
session.captureAttempts = Array.from({ length: 100 }, () => ({ id: randomUUID(), at: Date.now() }));
const retired = session.captureAttempts[0].id;
state = "prepared";
assert.equal(
  (await send(operation("prepare", randomUUID(), `${origin}/file.zip`))).state,
  "prepared",
);
assert.equal(session.captureAttempts.length, 100);
assert.equal((await send(operation("activate", retired))).state, "unknown");
session.captureAttempts = [{ id: randomUUID(), at: Date.now() - 86400001 }];
state = "prepared";
assert.equal(
  (await send(operation("prepare", randomUUID(), `${origin}/file.zip`))).state,
  "prepared",
);
allowed = false;
removed();
for (let index = 0; index < 20 && local.captureSites.length; index++)
  await new Promise((resolve) => setTimeout(resolve, 10));
assert.deepEqual(local.captureSites, []);
assert.equal((await send(operation("prepare", randomUUID(), `${origin}/file.zip`))).disabled, true);
await settings("clear");
assert.deepEqual(local.captureSites, []);
console.log(
  "Capture worker: default-off consent, sender/policy checks, phases, restart/status, failure/quota/expiry and privacy passed.",
);
