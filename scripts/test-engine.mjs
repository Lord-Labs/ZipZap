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
let segmentRetried = false;
let refreshExpired = false;
let refreshRevision = 1;
let refreshWeak = false;
const retryCounts = new Map();
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
  if (["/refresh-old", "/refresh-new"].includes(route)) {
    if (route === "/refresh-old" && refreshExpired) response.writeHead(403).end();
    else response.writeHead(302, { Location: "/refresh-resource" }).end();
    return;
  }
  if (route === "/metadata-redirect") {
    response.writeHead(302, { Location: "/metadata-star" }).end();
    return;
  }
  const dispositionHeaders = {
    "/metadata-star": "attachment; filename=old.zip; filename*=UTF-8''%D9%85%D9%84%D9%81.zip",
    "/metadata-plain": 'attachment; filename="report; Q1.zip"',
    "/metadata-unsafe": 'attachment; filename="../evil.zip"',
    "/metadata-malformed": "attachment; filename=a.zip; FILENAME=b.zip",
  };
  if (dispositionHeaders[route])
    response.setHeader("Content-Disposition", dispositionHeaders[route]);
  if (request.headers["if-range"]) {
    if (route === "/segment-auth") {
      response.writeHead(403).end();
      return;
    }
    if (route === "/segment-retry" && !segmentRetried) {
      segmentRetried = true;
      response.writeHead(429, { "Retry-After": "1" }).end();
      return;
    }
  }
  if (route.startsWith("/retry-")) {
    const count = retryCounts.get(route) || 0;
    retryCounts.set(route, count + 1);
    if (route === "/retry-cap" || count === 0) {
      const retryAfter =
        route === "/retry-date"
          ? new Date(Date.now() + 2000).toUTCString()
          : route === "/retry-malformed"
            ? "not-a-date"
            : route === "/retry-cap"
              ? "99999999999999999999999999999"
              : "1";
      response
        .writeHead(route === "/retry-seconds" ? 429 : 503, { "Retry-After": retryAfter })
        .end();
      return;
    }
  }
  if (route === "/auth") {
    response.writeHead(403).end();
    return;
  }
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
  let data =
    (route === "/mutable" && revision === 2) ||
    (route === "/refresh-resource" && refreshRevision === 2)
      ? changed
      : bytes;
  if (route === "/small") data = bytes.subarray(0, 256 * 1024);
  if (route === "/empty") data = Buffer.alloc(0);
  const etag =
    route === "/refresh-resource"
      ? `${refreshWeak ? "W/" : ""}"v${refreshRevision}"`
      : route === "/mutable"
        ? `"v${revision}"`
        : '"v1"';
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
    if (offset + 32768 <= end)
      await delay(["/slow", "/mutable", "/refresh-resource"].includes(route) ? 10 : 1);
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
  if (process.platform === "win32") {
    assert.equal(done.provenance, "internet");
    assert.equal(
      await readFile(`${done.destination}:Zone.Identifier`, "utf8"),
      "[ZoneTransfer]\r\nZoneId=3\r\n",
    );
  }
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
  assert.equal((await complete(resumed)).recovery_mode, "validated_resume");
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
  const beforeProbe = (await ask({ command: "jobs" })).length;
  for (const [route, expected] of [
    ["/metadata-star", "ملف.zip"],
    ["/metadata-redirect", "ملف.zip"],
    ["/metadata-plain", "report; Q1.zip"],
    ["/metadata-unsafe", "metadata-unsafe"],
    ["/metadata-malformed", "metadata-malformed"],
    ["/%D9%85%D9%84%D9%81.zip", "ملف.zip"],
  ]) {
    const proposal = await ask({
      command: "suggest",
      url: `${base}${route}?token=DO_NOT_LEAK`,
      folder: directory,
    });
    assert.equal(proposal.filename, expected);
    assert.equal(proposal.total, bytes.length);
    assert.equal(proposal.alternative, null);
  }
  assert.equal((await ask({ command: "jobs" })).length, beforeProbe);
  await assert.rejects(
    ask({ command: "suggest", url: `${base}/unsafe?token=DO_NOT_LEAK`, folder: directory }),
    (error) => !error.message.includes("DO_NOT_LEAK"),
  );
  const explicit = await ask({
    command: "suggest",
    url: `${base}/metadata-star`,
    folder: directory,
    filename: "chosen.zip",
  });
  assert.equal(explicit.filename, "chosen.zip");
  const proposal = await ask({
    command: "suggest",
    url: `${base}/metadata-star`,
    folder: directory,
  });
  await complete(
    await ask({
      command: "add",
      url: `${base}/metadata-star`,
      folder: directory,
      filename: proposal.filename,
    }),
  );
  const collision = await ask({
    command: "suggest",
    url: `${base}/metadata-star`,
    folder: directory,
  });
  assert.equal(collision.alternative, "ملف (1).zip");
  assert.equal(digest(await readFile(path.join(directory, "ملف.zip"))), digest(bytes));
  passed.push(
    "metadata headers, Unicode, safe fallbacks, redirects and duplicate alternatives stay advisory",
  );
  const categoryFolder = path.join(directory, "category-archives");
  await mkdir(categoryFolder);
  const categorySettings = await ask({ command: "settings" });
  const previousCategories = structuredClone(categorySettings.categories);
  categorySettings.categories[0].download_folder = categoryFolder;
  await ask({ command: "settings", value: categorySettings });
  const routed = await ask({
    command: "suggest_auto",
    url: `${base}/metadata-star`,
    folder: directory,
  });
  assert.equal(routed.category, "compressed");
  assert.equal(path.resolve(routed.destination).replace(/^\\\\\?\\/, ""), categoryFolder);
  assert.equal(routed.alternative, null);
  const routedJob = await ask({
    command: "add",
    url: `${base}/metadata-star`,
    folder: routed.destination,
    filename: routed.filename,
  });
  await complete(routedJob);
  assert.equal(digest(await readFile(path.join(categoryFolder, routed.filename))), digest(bytes));
  const explicitFolder = await ask({
    command: "suggest",
    url: `${base}/metadata-star`,
    folder: directory,
    filename: "explicit-category.zip",
  });
  assert.equal(path.resolve(explicitFolder.destination).replace(/^\\\\\?\\/, ""), directory);
  categorySettings.categories = previousCategories;
  await ask({ command: "settings", value: categorySettings });
  assert.equal((await get(routedJob.id)).destination, routedJob.destination);
  passed.push(
    "server filename category suggests its folder, explicit destination wins, and rule edits keep completed output",
  );
  for (const reason of ["same", "changed", "weak", "different-url", "different-query"]) {
    refreshExpired = false;
    refreshRevision = 1;
    refreshWeak = false;
    const original = await add("/refresh-old", `refresh-${reason}.bin`);
    await until(original.id, (job) => job.downloaded > 256 * 1024);
    await action(original, "pause");
    await stop();
    start();
    refreshExpired = true;
    if (reason === "same") {
      await action(original, "resume");
      await until(original.id, (job) => job.status === "failed");
    }
    const before = await get(original.id);
    const savedBytes = before.segments.reduce((sum, segment) => sum + segment.done, 0);
    assert.ok(savedBytes > 0);
    if (reason === "changed") refreshRevision = 2;
    if (reason === "weak") refreshWeak = true;
    const replacementUrl = `${base}/${reason === "different-url" ? "refresh-other" : reason === "different-query" ? "refresh-resource" : "refresh-new"}?token=PRIVATE_QUERY`;
    const replace = (restart = false) =>
      ask({ command: "replace_link", id: original.id, url: replacementUrl, restart });
    let result = await replace();
    if (reason === "same") assert.equal(result.retained_bytes, savedBytes);
    else {
      assert.equal(result.status, "restart_required");
      assert.deepEqual(await get(original.id), before);
      result = await replace(true);
      assert.equal(result.retained_bytes, 0);
      assert.deepEqual((await get(original.id)).segments, []);
    }
    assert.equal(result.status, "updated");
    assert.ok(!JSON.stringify(result).includes("PRIVATE_QUERY"));
    assert.equal((await get(original.id)).destination, before.destination);
    assert.equal((await get(original.id)).status, "paused");
    await stop();
    start();
    assert.equal((await get(original.id)).url, replacementUrl);
    const requestStart = requests.length;
    await action(original, "resume");
    await complete(original, reason === "changed" ? changed : bytes);
    if (reason === "same")
      assert.ok(
        requests
          .slice(requestStart)
          .some((request) =>
            before.segments.some(
              (segment) =>
                segment.done > 0 &&
                request.range === `bytes=${segment.start + segment.done}-${segment.end}`,
            ),
          ),
      );
    passed.push(`link replacement ${reason}: explicit identity/restart decision and exact output`);
  }
  refreshExpired = false;
  refreshRevision = 1;
  refreshWeak = false;
  assert.equal((await complete(await add("/range", "range.bin"))).recovery_mode, "fresh");
  passed.push("segmented transfer matches full digest");
  assert.ok(requests.some((r) => r.range?.startsWith("bytes=2097152-") && r.ifRange));
  for (const route of ["/ignore", "/bad-range", "/unknown", "/redirect", "/retry"]) {
    await complete(await add(route, `${route.slice(1)}.bin`));
    passed.push(`${route}: safe completion`);
  }
  for (const route of ["/retry-seconds", "/retry-date", "/retry-malformed", "/segment-retry"]) {
    const started = Date.now();
    const delayed = await add(route, `${route.slice(1)}.bin`);
    const waiting = await until(delayed.id, (j) => j.next_retry !== null);
    assert.equal(waiting.attempt, 1);
    assert.equal(
      waiting.failure_reason,
      ["/retry-seconds", "/segment-retry"].includes(route) ? "rate_limited" : "server",
    );
    assert.ok(waiting.next_retry >= Date.now() - 100);
    const completeRetry = await complete(delayed);
    assert.equal(completeRetry.attempt, 2);
    assert.equal(completeRetry.next_retry, null);
    assert.ok(Date.now() - started >= (route === "/retry-malformed" ? 400 : 900));
    passed.push(`${route}: bounded retry deadline and exact completion`);
  }
  for (const control of ["pause", "cancel", "shutdown"]) {
    const delayed = await add(`/retry-cap?token=DO_NOT_LEAK`, `retry-cap-${control}.bin`);
    const waiting = await until(delayed.id, (j) => j.next_retry !== null);
    const observedNow = Date.now();
    // Windows Node/V8 and Rust wall clocks can differ by one coarse system-clock tick.
    const clockResolution = process.platform === "win32" ? 20 : 0;
    assert.ok(
      waiting.next_retry <= observedNow + 30000 + clockResolution,
      `${control}: deadline=${waiting.next_retry}, observed=${observedNow}, remaining=${waiting.next_retry - observedNow}ms`,
    );
    assert.equal(waiting.attempt, 1);
    assert.ok(!waiting.error.includes("DO_NOT_LEAK"));
    const count = retryCounts.get("/retry-cap");
    const started = Date.now();
    if (control === "shutdown") {
      await stop();
      start();
    } else await action(delayed, control);
    const state = await get(delayed.id);
    assert.equal(state.status, control === "cancel" ? "cancelled" : "paused");
    assert.equal(state.next_retry, null);
    assert.ok(Date.now() - started < 3000, `${control} did not interrupt backoff`);
    await delay(150);
    assert.equal(retryCounts.get("/retry-cap"), count);
    passed.push(`${control} interrupts excessive capped Retry-After promptly`);
  }
  const denied = await add("/auth?token=DO_NOT_LEAK", "denied.bin");
  const deniedFailure = await until(denied.id, (j) => j.status === "failed");
  assert.equal(deniedFailure.failure_reason, "authentication");
  assert.equal(deniedFailure.attempt, 1);
  assert.equal(deniedFailure.next_retry, null);
  assert.ok(!deniedFailure.error.includes("DO_NOT_LEAK"));
  passed.push("permanent authentication refusal stops after one attempt without leaking the URL");
  const segmentDenied = await add("/segment-auth", "segment-denied.bin");
  const segmentFailure = await until(segmentDenied.id, (j) => j.status === "failed");
  assert.equal(segmentFailure.failure_reason, "authentication");
  assert.equal(segmentFailure.attempt, 1);
  await assert.rejects(readFile(segmentDenied.destination), { code: "ENOENT" });
  passed.push("permanent segment refusal stops without single-stream fallback");
  await complete(await add("/empty", "empty.bin"), Buffer.alloc(0));
  passed.push("zero-byte file");
  for (const route of ["/error", "/truncated", "/unsafe"]) {
    const job = await add(`${route}?token=DO_NOT_LEAK`, `${route.slice(1)}.bin`);
    const failed = await until(job.id, (j) => j.status === "failed");
    assert.ok(!failed.error.includes("DO_NOT_LEAK"));
    assert.equal(failed.attempt, route === "/truncated" ? 3 : 1);
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
    const beforeReplacement = requests.length;
    await assert.rejects(
      ask({ command: "replace_link", id: job.id, url: `${base}/range`, restart: true }),
      /pending file publication/,
    );
    assert.deepEqual(await get(job.id), unpublished);
    assert.equal(requests.length, beforeReplacement);
    passed.push("link replacement cannot discard pending publication evidence or output");
    assert.equal(digest(await readFile(job.destination)), digest(bytes));
    assert.ok((await readdir(directory)).includes(`.zipzap-${job.id}.part0`));
    assert.equal(
      JSON.parse(db.prepare("SELECT data FROM jobs WHERE id=?").get(job.id).data).status,
      "failed",
    );
    db.exec("DROP TRIGGER reject_completion;");
    const beforeRecovery = requests.length;
    await action(job, "resume");
    assert.equal((await complete(job)).recovery_mode, "publication_recovery");
    assert.equal(requests.length, beforeRecovery, "publication recovery downloaded again");
    await stop();
    start();
    assert.equal((await get(job.id)).status, "completed");
    passed.push(
      "completion save failure retains output/evidence, then retries without another HTTP request",
    );

    db.exec(`CREATE TRIGGER reject_completion BEFORE UPDATE ON jobs
      WHEN json_extract(NEW.data, '$.status') = 'completed'
      BEGIN SELECT RAISE(ABORT, 'injected completion save failure'); END;`);
    job = await add("/range", "publication-conflict.bin");
    await until(job.id, (j) => j.status === "failed");
    db.exec("DROP TRIGGER reject_completion;");
    await rename(job.destination, `${job.destination}.owned`);
    await writeFile(job.destination, bytes);
    const beforeConflict = requests.length;
    await action(job, "resume");
    const conflict = await until(job.id, (j) => j.status === "failed");
    assert.match(conflict.error, /^Published file conflict:/);
    assert.equal(digest(await readFile(job.destination)), digest(bytes));
    assert.ok((await readdir(directory)).includes(`.zipzap-${job.id}.part4`));
    await stop();
    start();
    assert.match((await get(job.id)).error, /^Published file conflict:/);
    await rm(job.destination);
    await rename(`${job.destination}.owned`, job.destination);
    await action(job, "resume");
    await complete(job);
    assert.equal(requests.length, beforeConflict, "conflict recovery downloaded again");
    passed.push(
      "byte-identical replacement is rejected across reopen and recovers after restoring the owned file",
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
  assert.equal((await complete(job, changed)).recovery_mode, "safe_restart");
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
  const missingDestination = await until(job.id, (j) => j.status === "failed");
  assert.match(missingDestination.error, /^Storage error: missing\./);
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

  await ask({ command: "queue", running: false });
  const heldA = await add("/slow", "held-a.bin");
  const heldB = await add("/slow", "held-b.bin");
  const later = await ask({
    command: "add",
    url: `${base}/slow`,
    folder: directory,
    filename: "later.bin",
    later: true,
  });
  const beforeHold = requests.length;
  await delay(200);
  assert.equal(requests.length, beforeHold);
  assert.equal((await get(later.id)).status, "paused");
  assert.deepEqual((await ask({ command: "queue" })).waiting, [heldA.id, heldB.id]);
  await ask({ command: "move_waiting", id: heldB.id, direction: "up" });
  await stop();
  start();
  const heldQueue = await ask({ command: "queue" });
  assert.equal(heldQueue.running, false);
  assert.deepEqual(heldQueue.waiting, [heldB.id, heldA.id]);
  await ask({ command: "queue", running: true });
  await until(heldB.id, (job) => job.downloaded > 256 * 1024);
  assert.equal((await get(heldA.id)).status, "queued");
  await ask({ command: "queue", running: false });
  await complete(heldB);
  assert.equal((await get(heldA.id)).status, "queued");
  assert.equal((await get(later.id)).status, "paused");
  passed.push("durable hold/order and add-for-later survive restart without unpausing jobs");
  const heldAddition = await add("/slow", "held-addition.bin");
  await ask({ command: "move_waiting", id: heldAddition.id, direction: "up" });
  await delay(150);
  assert.equal((await get(heldAddition.id)).status, "queued");
  await ask({ command: "queue", running: true });
  await until(heldAddition.id, (job) => job.downloaded > 256 * 1024);
  assert.equal((await get(heldA.id)).status, "queued");
  await complete(heldAddition);
  await complete(heldA);
  assert.equal((await get(later.id)).status, "paused");
  await action(later, "cancel");
  passed.push("holding lets active work finish while new additions wait in the shared queue");

  // Cross one real minute boundary to cover the production clock and dispatch loop.
  const scheduledAt = new Date(Math.ceil((Date.now() + 5000) / 60000) * 60000);
  const localDate = `${scheduledAt.getFullYear()}-${String(scheduledAt.getMonth() + 1).padStart(2, "0")}-${String(scheduledAt.getDate()).padStart(2, "0")}`;
  const startMinute = scheduledAt.getHours() * 60 + scheduledAt.getMinutes();
  const window = {
    timing: { kind: "once", date: localDate },
    start_minute: startMinute,
    stop_minute: (startMinute + 1) % 1440,
  };
  const scheduledQueue = await ask({ command: "schedule", value: window });
  assert.equal(scheduledQueue.running, false);
  assert.equal(scheduledQueue.schedule.next_start, scheduledAt.getTime() / 1000);
  const scheduled = await add("/small", "scheduled.bin");
  const scheduledRequests = requests.length;
  await delay(150);
  assert.equal((await get(scheduled.id)).status, "queued");
  assert.equal(requests.length, scheduledRequests);
  await until(
    scheduled.id,
    (job) => ["completed", "failed"].includes(job.status),
    Math.ceil((scheduledAt.getTime() - Date.now()) / 1000) + 15,
  );
  await complete(scheduled, bytes.subarray(0, 256 * 1024));
  await ask({ command: "queue", running: false });
  await assert.rejects(
    ask({ command: "schedule", value: { ...window, timing: { kind: "weekly", weekdays: [] } } }),
    /weekdays/,
  );
  assert.deepEqual((await ask({ command: "queue" })).schedule.config, window);
  await stop();
  start();
  const reopenedSchedule = await ask({ command: "queue" });
  assert.equal(reopenedSchedule.running, false);
  assert.deepEqual(reopenedSchedule.schedule.config, window);
  assert.equal((await get(scheduled.id)).status, "completed");
  await ask({ command: "schedule", value: null });
  assert.equal((await ask({ command: "queue" })).running, false);
  await ask({ command: "queue", running: true });
  passed.push(
    "real local-time start dispatches once, preserves exact bytes and schedule/hold across restart",
  );

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
    url: `${tlsBase}/range?token=DO_NOT_LEAK`,
    folder: directory,
    filename: "untrusted.bin",
  });
  const tlsFailure = await until(untrusted.id, (j) => j.status === "failed");
  assert.equal(tlsFailure.failure_reason, "tls");
  assert.equal(tlsFailure.attempt, 1);
  assert.ok(!tlsFailure.error.includes("DO_NOT_LEAK"));
  await assert.rejects(readFile(untrusted.destination), { code: "ENOENT" });
  passed.push("untrusted TLS certificate rejected");
  const summary = await ask({ command: "support_summary" });
  assert.ok(Buffer.byteLength(summary) <= 8192);
  assert.equal(JSON.parse(summary).counts.jobs, (await ask({ command: "jobs" })).length);
  for (const privateValue of ["DO_NOT_LEAK", "token=", "http://", "https://", directory, "cookie"])
    assert.ok(!summary.includes(privateValue));
  assert.ok(JSON.parse(summary).failure_counts.tls > 0);
  assert.equal(JSON.parse(summary).browser_host_registered, null);
  passed.push("support summary exports only bounded counts and safe codes without URLs or paths");
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
