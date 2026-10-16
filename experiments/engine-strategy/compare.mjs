import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const probe = path.join(
  root,
  "target",
  "debug",
  `zipzap-engine-probe${process.platform === "win32" ? ".exe" : ""}`,
);
const aria2 = process.argv[2];
assert.ok(process.argv.length <= 3, "usage: node compare.mjs [absolute-path-to-aria2c]");
if (aria2) assert.ok(path.isAbsolute(aria2), "aria2c path must be absolute");
const data = Buffer.alloc(8 * 1024 * 1024);
for (let i = 0; i < data.length; i++) data[i] = ((i >>> 8) ^ (i * 31)) & 255;
const changed = Buffer.from(data.map((byte) => byte ^ 255));
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const requests = [];
const directory = await mkdtemp(path.join(os.tmpdir(), "zipzap-engine-probe-"));
const observations = [];

const server = http.createServer(async (request, response) => {
  const body = request.url === "/changed" ? changed : data;
  const etag = request.url === "/changed" ? '"fixture-v2"' : '"fixture-v1"';
  const record = {
    route: request.url,
    range: request.headers.range ?? null,
    ifRange: request.headers["if-range"] ?? null,
    sent: 0,
    aborted: false,
  };
  requests.push(record);
  response.on("close", () => {
    record.aborted = record.sent < body.length && !response.writableFinished;
  });
  let start = 0;
  let end = body.length - 1;
  const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? "");
  if (
    range &&
    request.url !== "/ignore" &&
    (!request.headers["if-range"] || request.headers["if-range"] === etag)
  ) {
    start = Number(range[1]);
    end = range[2] ? Number(range[2]) : end;
    if (start > end || end >= body.length) {
      response.writeHead(416, { "Content-Range": `bytes */${body.length}` }).end();
      return;
    }
    response.statusCode = 206;
    response.setHeader(
      "Content-Range",
      request.url === "/bad-range" ? "bytes 1-2/3" : `bytes ${start}-${end}/${body.length}`,
    );
  }
  response.setHeader("Content-Length", end - start + 1);
  response.setHeader("Accept-Ranges", "bytes");
  response.setHeader("ETag", etag);
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  // A small artificial delay makes overlap and cancellation observable, not a benchmark.
  for (let offset = start; offset <= end && !response.destroyed; offset += 16384) {
    const chunk = body.subarray(offset, Math.min(offset + 16384, end + 1));
    response.write(chunk);
    record.sent += chunk.length;
    await delay(2);
  }
  response.end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const base = `http://127.0.0.1:${server.address().port}`;

function command(executable, args) {
  const child = spawn(executable, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  const timer = setTimeout(() => child.kill(), 20000);
  const completion = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code, signal, stdout, stderr }));
  }).finally(() => clearTimeout(timer));
  return { child, completion };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (predicate()) return;
    await delay(20);
  }
  throw new Error("fixture observation timed out");
}

async function rust(mode, route, output, expectedCode = 0) {
  const result = await command(probe, [mode, `${base}${route}`, output]).completion;
  assert.equal(result.signal, null, "Rust probe exceeded its budget");
  if (expectedCode === 0) assert.equal(result.code, 0, result.stderr);
  else assert.notEqual(result.code, 0, "Rust must reject invalid range/identity");
}

try {
  let output = path.join(directory, "rust-split.bin");
  let before = requests.length;
  await rust("split", "/range", output);
  assert.equal(sha(await readFile(output)), sha(data));
  const split = requests.slice(before);
  assert.equal(split.length, 2);
  assert.ok(split.every((r) => r.range && r.ifRange === '"fixture-v1"'));
  observations.push({
    engine: "rust",
    case: "two ranges",
    result: "complete bytes match",
    requests: split.length,
  });

  for (const route of ["/ignore", "/bad-range"]) {
    output = path.join(directory, `rust-reject-${route.slice(1)}.bin`);
    await rust("split", route, output, 1);
    await assert.rejects(readFile(output), { code: "ENOENT" });
    observations.push({ engine: "rust", case: route, result: "rejected before creating output" });
  }

  output = path.join(directory, "rust-resume.bin");
  await writeFile(output, data.subarray(0, data.length / 2));
  await rust("resume", "/range", output);
  assert.equal(sha(await readFile(output)), sha(data));
  observations.push({
    engine: "rust",
    case: "same identity resume",
    result: "complete bytes match",
  });

  output = path.join(directory, "rust-changed.bin");
  const prefix = data.subarray(0, data.length / 2);
  await writeFile(output, prefix);
  await rust("resume", "/changed", output, 1);
  assert.deepEqual(await readFile(output), prefix);
  observations.push({
    engine: "rust",
    case: "changed identity",
    result: "rejected; original prefix untouched",
  });

  before = requests.length;
  await rust("cancel", "/slow", path.join(directory, "unused"));
  await waitFor(() => requests.slice(before).some((r) => r.aborted));
  observations.push({
    engine: "rust",
    case: "body cancellation",
    result: "server observed connection closed before full body",
  });

  if (aria2) {
    const version = await command(aria2, ["--version"]).completion;
    assert.equal(version.code, 0, version.stderr);
    observations.push({ engine: "aria2", version: version.stdout.split(/\r?\n/, 1)[0] });
    const args = (route, name) => [
      "--no-conf=true",
      "--no-netrc=true",
      "--all-proxy=",
      "--auto-file-renaming=false",
      "--allow-overwrite=false",
      "--file-allocation=none",
      "--max-tries=1",
      "--connect-timeout=3",
      "--timeout=5",
      "--console-log-level=error",
      "--summary-interval=0",
      "--split=2",
      "--max-connection-per-server=2",
      "--min-split-size=1M",
      `--dir=${directory}`,
      `--out=${name}`,
      `${base}${route}`,
    ];
    for (const route of ["/range", "/ignore"]) {
      const name = `aria2-${route.slice(1)}.bin`;
      before = requests.length;
      const result = await command(aria2, args(route, name)).completion;
      assert.equal(result.code, 0, result.stderr || result.stdout);
      assert.equal(sha(await readFile(path.join(directory, name))), sha(data));
      observations.push({
        engine: "aria2",
        case: route,
        result: "complete bytes match",
        requests: requests.slice(before).map((r) => ({ range: r.range, ifRange: r.ifRange })),
      });
    }
    for (const route of ["/range", "/changed"]) {
      const name = `aria2-resume-${route.slice(1)}.bin`;
      output = path.join(directory, name);
      await writeFile(output, prefix);
      before = requests.length;
      const result = await command(aria2, [
        "--continue=true",
        "--split=1",
        ...args(route, name).filter((arg) => !arg.startsWith("--split=")),
      ]).completion;
      assert.equal(result.code, 0, result.stderr || result.stdout);
      const content = await readFile(output);
      if (route === "/range") assert.equal(sha(content), sha(data));
      observations.push({
        engine: "aria2",
        case: `seeded prefix resume ${route}`,
        result:
          sha(content) === sha(data)
            ? "matches original"
            : sha(content) === sha(changed)
              ? "matches changed resource"
              : "mixed representation",
        requests: requests.slice(before).map((r) => ({ range: r.range, ifRange: r.ifRange })),
      });
    }
    before = requests.length;
    const running = command(aria2, args("/slow", "aria2-cancel.bin"));
    await waitFor(() => requests.slice(before).some((r) => r.sent > 0));
    running.child.kill();
    await running.completion;
    await waitFor(() => requests.slice(before).some((r) => r.aborted));
    observations.push({
      engine: "aria2",
      case: "process cancellation",
      result: "server observed connection closed before full body",
    });
  }
  console.log(
    JSON.stringify(
      { fixtureBytes: data.length, sha256: sha(data), aria2Compared: Boolean(aria2), observations },
      null,
      2,
    ),
  );
} finally {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("zipzap-engine-probe-"));
  await rm(directory, { recursive: true, force: true });
}
