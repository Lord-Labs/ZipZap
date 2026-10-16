import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";

if (process.platform !== "win32")
  throw new Error("This benchmark records Windows process CPU/RSS; run on Windows.");
const output = process.argv[2];
if (!output) throw new Error("usage: node scripts/benchmark.mjs <results.json>");
const directory = await mkdtemp(path.join(os.tmpdir(), "zipzap-benchmark-"));
const bytes = Buffer.alloc(32 * 1024 * 1024);
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + (i >>> 12)) & 255;
const digest = (b) => createHash("sha256").update(b).digest("hex");
let active = 0,
  peak = 0,
  requests = 0;
const server = http.createServer(async (req, res) => {
  requests++;
  active++;
  peak = Math.max(peak, active);
  let counted = true;
  const finish = () => {
    if (counted) {
      active--;
      counted = false;
    }
  };
  res.once("finish", finish);
  res.once("close", finish);
  const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const start = match ? Number(match[1]) : 0,
    end = match?.[2] ? Number(match[2]) : bytes.length - 1;
  if (match) {
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
  }
  res.setHeader("Content-Length", end - start + 1);
  res.setHeader("ETag", '"benchmark-v1"');
  for (let offset = start; offset <= end && !res.destroyed; offset += 65536) {
    res.write(bytes.subarray(offset, Math.min(offset + 65536, end + 1)));
    if (offset + 65536 <= end) await delay(2);
  }
  res.end();
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const samples = [];
let child;
try {
  for (const connections of [1, 4])
    for (let repetition = 1; repetition <= 3; repetition++) {
      const pending = [];
      child = spawn(
        path.resolve("target/release/zipzap.exe"),
        [path.join(directory, `state-${connections}-${repetition}.sqlite`)],
        { windowsHide: true },
      );
      await once(child, "spawn");
      createInterface({ input: child.stdout }).on("line", (line) =>
        pending.shift()?.(JSON.parse(line)),
      );
      const ask = async (value) => {
        const answer = new Promise((resolve) => pending.push(resolve));
        child.stdin.write(`${JSON.stringify(value)}\n`);
        let timer;
        const result = await Promise.race([
          answer,
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error("Benchmark CLI timed out")), 10000);
          }),
        ]).finally(() => clearTimeout(timer));
        assert.equal(result.error, undefined);
        return result.result;
      };
      await ask({
        command: "settings",
        value: { max_concurrent: 1, connections, speed_limit: 0, language: "en" },
      });
      peak = 0;
      requests = 0;
      const started = performance.now();
      const job = await ask({
        command: "add",
        url: `http://127.0.0.1:${server.address().port}/file`,
        folder: directory,
        filename: `file-${connections}-${repetition}.bin`,
      });
      let done;
      for (let attempt = 0; attempt < 3000; attempt++) {
        done = (await ask({ command: "jobs" })).find((j) => j.id === job.id);
        if (["failed", "completed"].includes(done.status)) break;
        await delay(10);
      }
      const elapsedMs = performance.now() - started;
      assert.equal(done.status, "completed", done.error);
      assert.equal(digest(await readFile(done.destination)), digest(bytes));
      const metrics = JSON.parse(
        execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `$zipzapProcess=Get-Process -Id ${child.pid}; @{cpuSeconds=$zipzapProcess.TotalProcessorTime.TotalSeconds;peakWorkingSetBytes=$zipzapProcess.PeakWorkingSet64}|ConvertTo-Json -Compress`,
          ],
          { encoding: "utf8", windowsHide: true },
        ),
      );
      samples.push({
        connections,
        repetition,
        elapsedMs,
        MiBPerSecond: 32 / (elapsedMs / 1000),
        ...metrics,
        peakResponseStreams: peak,
        requests,
        sha256: digest(bytes),
      });
      const exit = once(child, "exit");
      await ask({ command: "shutdown" });
      child.stdin.end();
      await exit;
      child = null;
    }
  const result = {
    date: new Date().toISOString(),
    coreTree: execFileSync("git", ["rev-parse", "HEAD:crates/zipzap-core"], {
      encoding: "utf8",
    }).trim(),
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    ramBytes: os.totalmem(),
    node: process.version,
    rust: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
    profile: "release, thin LTO, one codegen unit, stripped",
    fixture: {
      bytes: bytes.length,
      chunkBytes: 65536,
      delayPerChunkMs: 2,
      transport: "HTTP loopback, strong ETag, exact ranges, same machine/server and client",
      disk: "local NTFS SSD; warm OS caches, no disk-cache flush",
    },
    samples,
    limits:
      "Synthetic per-response pacing rewards parallel streams. Not WAN, TLS, IDM comparison, GUI/WebView memory, cold startup, or disk saturation. CPU and peak working set cover the engine child process lifetime only, not server/test harness. No universal speed claim.",
  };
  await writeFile(output, JSON.stringify(result, null, 2) + "\n");
  console.log(JSON.stringify(samples, null, 2));
} finally {
  if (child?.pid && child.exitCode === null && child.signalCode === null) {
    child.kill();
    await once(child, "exit");
  }
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("zipzap-benchmark-"));
  await rm(directory, { recursive: true, force: true });
}
