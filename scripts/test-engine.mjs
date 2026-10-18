import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm, readdir, mkdir, rename } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { DatabaseSync } from "node:sqlite";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const binary = path.join(
  root,
  "target/debug",
  `zipzap${process.platform === "win32" ? ".exe" : ""}`,
);
const directory = await mkdtemp(path.join(os.tmpdir(), "zipzap-core-test-"));
const bytes = Buffer.alloc(4 * 1024 * 1024);
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + (i >>> 11)) & 255;
const changed = Buffer.from(bytes.map((b) => b ^ 255));
const digest = (b) => createHash("sha256").update(b).digest("hex");
let revision = 1;
let active = 0;
let peak = 0;
let retries = 0;
const requests = [];
const handler = async (request, response) => {
  active++;
  peak = Math.max(peak, active);
  let counted = true;
  const finish = () => {
    if (counted) {
      active--;
      counted = false;
    }
  };
  response.once("finish", finish);
  response.once("close", finish);
  const route = request.url.split("?")[0];
  requests.push({ route, range: request.headers.range, ifRange: request.headers["if-range"] });
  if (route === "/redirect") {
    response.writeHead(302, { Location: "/range" }).end();
    return;
  }
  if (route === "/unsafe") {
    response.writeHead(302, { Location: "file:///private" }).end();
    return;
  }
  if (route === "/error") {
    response.writeHead(404).end();
    return;
  }
  if (route === "/retry" && retries++ === 0) {
    response.writeHead(503).end();
    return;
  }
  let data = route === "/mutable" && revision === 2 ? changed : bytes;
  if (route === "/small") data = bytes.subarray(0, 256 * 1024);
  if (route === "/empty") data = Buffer.alloc(0);
  const etag = route === "/mutable" ? `"v${revision}"` : '"v1"';
  let start = 0;
  let end = data.length - 1;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (
    range &&
    !["/ignore", "/unknown", "/truncated"].includes(route) &&
    (!request.headers["if-range"] || request.headers["if-range"] === etag)
  ) {
    start = Number(range[1]);
    end = range[2] ? Number(range[2]) : end;
    if (start > end || end >= data.length) {
      response.writeHead(416, { "Content-Range": `bytes */${data.length}` }).end();
      return;
    }
    response.statusCode = 206;
    response.setHeader(
      "Content-Range",
      route === "/bad-range" && start !== 0
        ? "bytes 1-2/3"
        : `bytes ${start}-${end}/${data.length}`,
    );
  }
  if (route !== "/unknown") response.setHeader("Content-Length", end - start + 1);
  if (route !== "/unknown") response.setHeader("ETag", etag);
  if (route === "/truncated") {
    response.write(data.subarray(0, 4096));
    response.destroy();
    return;
  }
  for (let offset = start; offset <= end && !response.destroyed; offset += 32768) {
    response.write(data.subarray(offset, Math.min(offset + 32768, end + 1)));
    if (offset + 32768 <= end) await delay(route === "/slow" || route === "/mutable" ? 10 : 1);
  }
  response.end();
};
const server = http.createServer(handler);
const openssl =
  process.platform === "win32" ? "C:/Program Files/Git/usr/bin/openssl.exe" : "openssl";
const certPath = path.join(directory, "fixture-cert.pem");
const keyPath = path.join(directory, "fixture-key.pem");
execFileSync(
  openssl,
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certPath,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore", windowsHide: true },
);
const secure = https.createServer(
  { key: await readFile(keyPath), cert: await readFile(certPath) },
  handler,
);
secure.listen(0, "127.0.0.1");
await once(secure, "listening");
const tlsBase = `https://127.0.0.1:${secure.address().port}`;
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;
let child;
let answers = [];
let errors = "";
function start(trusted = true) {
  child = spawn(binary, [path.join(directory, "state.sqlite"), ...(trusted ? [certPath] : [])], {
    windowsHide: true,
  });
  child.stderr.on("data", (b) => {
    errors += b;
  });
  answers = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    const pending = answers.shift();
    if (pending) pending(JSON.parse(line));
  });
}
async function ask(value) {
  const answer = new Promise((resolve) => answers.push(resolve));
  child.stdin.write(`${JSON.stringify(value)}\n`);
  let timeout;
  const result = await Promise.race([
    answer,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(`CLI response timeout: ${errors}`)), 10000);
    }),
  ]).finally(() => clearTimeout(timeout));
  if (result.error) throw new Error(result.error);
  return result.result;
}
async function get(id) {
  return (await ask({ command: "jobs" })).find((j) => j.id === id);
}
async function until(id, predicate, seconds = 20) {
  const deadline = Date.now() + seconds * 1000;
  while (Date.now() < deadline) {
    const job = await get(id);
    if (predicate(job)) return job;
    await delay(40);
  }
  throw new Error(`Job timed out: ${JSON.stringify(await get(id))}`);
}
async function add(route, name) {
  return ask({ command: "add", url: `${base}${route}`, folder: directory, filename: name });
}
async function action(job, value) {
  return ask({ command: "action", id: job.id, action: value });
}
async function complete(job, expected = bytes) {
  const done = await until(job.id, (j) => ["completed", "failed"].includes(j.status));
  assert.equal(done.status, "completed", done.error);
  assert.equal(digest(await readFile(done.destination)), digest(expected));
  return done;
}
async function stop(kill = false) {
  const exit = once(child, "exit");
  if (kill) child.kill();
  else {
    await ask({ command: "shutdown" });
    child.stdin.end();
  }
  await exit;
}
const passed = [];
try {
  const legacy = JSON.parse(
    await readFile(
      new URL("../crates/zipzap-core/tests/fixtures/first-beta-state.json", import.meta.url),
      "utf8",
    ),
  );
  const prefix = bytes.subarray(0, 65536);
  const resumed = {
    ...legacy.jobs[1],
    url: `${base}/range`,
    effective_url: `${base}/range`,
    destination: path.join(directory, "first-beta-resume.bin"),
    total: bytes.length,
    downloaded: prefix.length + 1024,
    validator: '"v1"',
    segments: [{ start: 0, end: bytes.length - 1, done: prefix.length, hash: digest(prefix) }],
  };
  const legacyDb = new DatabaseSync(path.join(directory, "state.sqlite"));
  try {
    legacyDb.exec(
      "CREATE TABLE jobs(id TEXT PRIMARY KEY, data TEXT NOT NULL); CREATE TABLE settings(id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL); PRAGMA user_version=1;",
    );
    legacyDb.prepare("INSERT INTO jobs VALUES(?, ?)").run(resumed.id, JSON.stringify(resumed));
    legacyDb
      .prepare("INSERT INTO settings VALUES(1, ?)")
      .run(JSON.stringify({ ...legacy.settings, speed_limit: 0 }));
  } finally {
    legacyDb.close();
  }
  await writeFile(path.join(directory, `.zipzap-${resumed.id}.part0`), prefix);
  start();
  assert.equal((await get(resumed.id)).status, "paused");
  assert.equal((await get(resumed.id)).downloaded, prefix.length);
  const settings = await ask({ command: "settings" });
  assert.equal(settings.language, "ar");
  assert.equal(settings.download_folder, null);
  await action(resumed, "resume");
  await complete(resumed);
  assert.ok(
    requests.some(
      (r) => r.range === `bytes=${prefix.length}-${bytes.length - 1}` && r.ifRange === '"v1"',
    ),
  );
  await stop();
  start();
  assert.equal((await get(resumed.id)).status, "completed");
  passed.push(
    "first-beta state upgrades, resumes its owned prefix over HTTP, and reopens completed",
  );
  await complete(
    await ask({
      command: "add",
      url: `${tlsBase}/range`,
      folder: directory,
      filename: "https.bin",
    }),
  );
  passed.push("HTTPS with explicitly trusted fixture CA");
  await complete(await add("/range", "range.bin"));
  passed.push("segmented transfer matches full digest");
  assert.ok(requests.some((r) => r.range?.startsWith("bytes=2097152-") && r.ifRange));
  for (const route of ["/ignore", "/bad-range", "/unknown", "/redirect", "/retry"]) {
    await complete(await add(route, `${route.slice(1)}.bin`));
    passed.push(`${route}: safe completion`);
  }
  await complete(await add("/empty", "empty.bin"), Buffer.alloc(0));
  passed.push("zero-byte file");
  for (const route of ["/error", "/truncated", "/unsafe"]) {
    const job = await add(`${route}?token=DO_NOT_LEAK`, `${route.slice(1)}.bin`);
    const failed = await until(job.id, (j) => j.status === "failed");
    assert.ok(!failed.error.includes("DO_NOT_LEAK"));
    await assert.rejects(readFile(job.destination), { code: "ENOENT" });
    passed.push(`${route}: error without publishing or leaking URL`);
  }
  let job = await add("/slow", "resume.bin");
  await until(job.id, (j) => j.downloaded > 256 * 1024);
  await action(job, "pause");
  await delay(150);
  await stop();
  start();
  assert.equal((await get(job.id)).status, "paused");
  await action(job, "resume");
  await complete(job);
  passed.push("pause/restart/resume with persisted prefix hashes");

  job = await add("/slow", "immediate-resume.bin");
  await until(job.id, (j) => j.downloaded > 256 * 1024);
  await action(job, "pause");
  await action(job, "resume");
  await complete(job);
  passed.push("immediate resume waits for the paused worker before restarting");

  const db = new DatabaseSync(path.join(directory, "state.sqlite"));
  try {
    db.exec(`CREATE TRIGGER reject_checkpoint BEFORE UPDATE ON jobs
      WHEN json_extract(NEW.data, '$.status') = 'failed' OR EXISTS (
        SELECT 1 FROM json_each(NEW.data, '$.segments')
        WHERE json_extract(value, '$.done') > 1048576)
      BEGIN SELECT RAISE(ABORT, 'injected checkpoint save failure'); END;`);
    job = await add("/slow", "checkpoint-save-error.bin");
    const failed = await until(job.id, (j) => j.status === "failed");
    assert.match(failed.error, /last saved state retained.*injected checkpoint save failure/);
    assert.equal(failed.speed, 0);
    const durable = JSON.parse(db.prepare("SELECT data FROM jobs WHERE id=?").get(job.id).data);
    assert.equal(durable.status, "downloading");
    assert.ok(durable.segments.some((s) => s.done > 0));
    assert.deepEqual(failed.segments, durable.segments);
    assert.ok((await readdir(directory)).includes(`.zipzap-${job.id}.part0`));
    await assert.rejects(readFile(job.destination), { code: "ENOENT" });
    db.exec("DROP TRIGGER reject_checkpoint;");
    await stop();
    start();
    assert.equal((await get(job.id)).status, "paused");
    await action(job, "resume");
    await complete(job);
    passed.push(
      "checkpoint and terminal save failures retain durable parts and recover after repair/restart",
    );

    db.exec(`CREATE TRIGGER reject_completion BEFORE UPDATE ON jobs
      WHEN json_extract(NEW.data, '$.status') = 'completed'
      BEGIN SELECT RAISE(ABORT, 'injected completion save failure'); END;`);
    job = await add("/range", "completion-save-error.bin");
    const unpublished = await until(job.id, (j) => j.status === "failed");
    assert.match(unpublished.error, /injected completion save failure/);
    assert.equal(unpublished.speed, 0);
    assert.equal(digest(await readFile(job.destination)), digest(bytes));
    assert.ok((await readdir(directory)).includes(`.zipzap-${job.id}.part0`));
    assert.equal(
      JSON.parse(db.prepare("SELECT data FROM jobs WHERE id=?").get(job.id).data).status,
      "failed",
    );
    db.exec("DROP TRIGGER reject_completion;");
    // Publication reconciliation belongs to #32; keep the verified output for manual recovery.
    await rename(job.destination, `${job.destination}.verified`);
    await action(job, "resume");
    await complete(job);
    await stop();
    start();
    assert.equal((await get(job.id)).status, "completed");
    passed.push(
      "completion save failure never reports success, keeps output/parts, and permits a safe retry",
    );
  } finally {
    db.close();
  }

  job = await add("/mutable", "changed.bin");
  await until(job.id, (j) => j.downloaded > 256 * 1024);
  await action(job, "pause");
  await delay(200);
  revision = 2;
  await action(job, "resume");
  await complete(job, changed);
  passed.push("changed ETag restarts every segment safely");

  job = await add("/slow", "corrupt.bin");
  await until(job.id, (j) => j.downloaded > 256 * 1024);
  await action(job, "pause");
  await stop();
  const partial = path.join(directory, `.zipzap-${job.id}.part0`);
  const content = await readFile(partial);
  content[0] ^= 255;
  await writeFile(partial, content);
  start();
  await action(job, "resume");
  await complete(job);
  passed.push("corrupt partial data discarded instead of appended");

  job = await add("/slow", "crash.bin");
  await until(job.id, (j) => j.segments.some((s) => s.done >= 1024 * 1024));
  await stop(true);
  start();
  assert.equal((await get(job.id)).status, "paused");
  await action(job, "resume");
  await complete(job);
  passed.push("forced process exit recovers last durable checkpoint");

  job = await add("/slow", "cancel.bin");
  await until(job.id, (j) => j.downloaded > 0);
  await action(job, "cancel");
  await delay(250);
  await assert.rejects(readFile(job.destination), { code: "ENOENT" });
  passed.push("cancel never publishes partial output");

  job = await add("/slow", "clobber.bin");
  await until(job.id, (j) => j.downloaded > 0);
  await writeFile(job.destination, "keep existing");
  await until(job.id, (j) => j.status === "failed");
  assert.equal(await readFile(job.destination, "utf8"), "keep existing");
  passed.push("destination race cannot overwrite existing data");

  const unavailable = path.join(directory, "unavailable");
  await mkdir(unavailable);
  job = await ask({
    command: "add",
    url: `${base}/slow`,
    folder: unavailable,
    filename: "disk-error.bin",
  });
  await action(job, "pause");
  await stop();
  await rm(unavailable, { recursive: true });
  start();
  await action(job, "resume");
  await until(job.id, (j) => j.status === "failed");
  await assert.rejects(readFile(job.destination), { code: "ENOENT" });
  await mkdir(unavailable);
  await action(job, "resume");
  await complete(job);
  passed.push("unavailable destination fails safely and retries after repair");

  await ask({
    command: "settings",
    value: { max_concurrent: 1, connections: 2, speed_limit: 0, language: "en" },
  });
  const first = await add("/slow", "queue-first.bin");
  const second = await add("/slow", "queue-second.bin");
  await until(first.id, (j) => j.downloaded > 0);
  assert.equal((await get(second.id)).status, "queued");
  await stop();
  start();
  assert.equal((await get(first.id)).status, "paused");
  await complete(second);
  await action(first, "resume");
  await complete(first);
  passed.push("bounded queue order survives restart");

  await ask({
    command: "settings",
    value: { max_concurrent: 2, connections: 4, speed_limit: 0, language: "en" },
  });
  await delay(100);
  peak = 0;
  const parallel = [await add("/slow", "parallel-a.bin"), await add("/slow", "parallel-b.bin")];
  await Promise.all(parallel.map((j) => complete(j)));
  assert.ok(peak <= 4, `host limit exceeded: ${peak}`);
  passed.push("concurrent jobs share four host request slots");

  await ask({
    command: "settings",
    value: { max_concurrent: 2, connections: 2, speed_limit: 131072, language: "en" },
  });
  const started = Date.now();
  const limited = [await add("/small", "limited-a.bin"), await add("/small", "limited-b.bin")];
  await Promise.all(limited.map((j) => complete(j, bytes.subarray(0, 256 * 1024))));
  assert.ok(Date.now() - started >= 2500);
  passed.push("shared bandwidth limit enforced across jobs");
  await stop();
  start(false);
  const untrusted = await ask({
    command: "add",
    url: `${tlsBase}/range`,
    folder: directory,
    filename: "untrusted.bin",
  });
  await until(untrusted.id, (j) => j.status === "failed");
  await assert.rejects(readFile(untrusted.destination), { code: "ENOENT" });
  passed.push("untrusted TLS certificate rejected");
  await stop();
  assert.equal(errors, "");
  console.log(
    JSON.stringify(
      { passed, peakConnections: peak, fixtureBytes: bytes.length, sha256: digest(bytes) },
      null,
      2,
    ),
  );
} finally {
  if (child && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, "exit");
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  secure.closeAllConnections();
  await new Promise((resolve) => secure.close(resolve));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("zipzap-core-test-"));
  await rm(directory, { recursive: true, force: true });
}
