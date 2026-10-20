// Issue #46: owned synthetic fixtures, production core and bundled UI; no native UI control.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "@playwright/test";

assert.equal(process.platform, "win32", "Windows process measurements require Windows");
const output = process.argv[2];
assert.ok(output, "usage: node scripts/benchmark-performance.mjs <new-local-directory>");
const directory = path.resolve(output);
await mkdir(directory); // Refuse reuse: results and databases must belong to this run.
const binary = path.resolve("target/release/zipzap.exe");
const hash = (value) => createHash("sha256").update(value).digest("hex");
const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const bytes = Buffer.alloc(8 * 1024 * 1024);
for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + (i >>> 12)) & 255;
const expectedHash = hash(bytes);
const repetitions = 3;
const results = {
  sourceCommit: git("rev-parse", "HEAD"),
  sourceTrees: {
    core: git("rev-parse", "HEAD:crates/zipzap-core"),
    desktop: git("rev-parse", "HEAD:apps/desktop"),
  },
  worktree: git("status", "--short"),
  date: new Date().toISOString(),
  environment: {
    os: `${os.type()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0].model,
    logicalCpus: os.cpus().length,
    ramBytes: os.totalmem(),
    node: process.version,
    rust: execFileSync("rustc", ["--version"], { encoding: "utf8" }).trim(),
    engineSha256: hash(await readFile(binary)),
    profile: "release, thin LTO, one codegen unit, stripped; Vite production bundle",
  },
  fixture: { bytes: bytes.length, sha256: expectedHash, chunkBytes: 65536 },
  transfers: [],
  histories: [],
  limits: [
    "Loopback response delay/pacing models server behavior, not WAN RTT or packet loss.",
    "Server and client share a host; local caches are warm and no cache flush occurs.",
    "Chromium uses a real core JSON-lines bridge, not Tauri IPC or native WebView2.",
    "No native/cold-boot/installer or IDM measurement; no optimization/before-after claim.",
    "Three repetitions are descriptive samples, not a statistically powered population.",
  ],
};

function core(database, trusted = true) {
  const child = spawn(binary, [database, ...(trusted ? [cert] : [])], { windowsHide: true });
  const pending = [];
  let failure;
  const fail = (error) => {
    failure = error;
    for (const item of pending.splice(0)) item.reject(error);
  };
  child.on("error", fail);
  child.on("exit", () => fail(new Error("Benchmark core exited")));
  child.stderr.on("data", () => {}); // Never publish raw errors containing fixture paths.
  createInterface({ input: child.stdout }).on("line", (line) => {
    const item = pending.shift();
    try {
      const answer = JSON.parse(line);
      assert.equal(answer.error, undefined, answer.error);
      item?.resolve(answer.result);
    } catch (error) {
      item?.reject(error);
      fail(error);
    }
  });
  return {
    child,
    async ask(value) {
      if (failure) throw failure;
      let timer;
      try {
        return await Promise.race([
          new Promise((resolve, reject) => {
            pending.push({ resolve, reject });
            child.stdin.write(`${JSON.stringify(value)}\n`);
          }),
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              const error = new Error("Benchmark command timed out");
              fail(error);
              child.kill();
              reject(error);
            }, 30000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      if (child.exitCode !== null || child.signalCode !== null) return;
      const exited = once(child, "exit");
      try {
        await this.ask({ command: "shutdown" });
        child.stdin.end();
      } catch {
        child.kill();
      }
      await exited;
    },
  };
}

function metrics(pid) {
  return JSON.parse(
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `$zipzapMeasured=Get-Process -Id ${pid}; @{cpuSeconds=$zipzapMeasured.TotalProcessorTime.TotalSeconds;peakWorkingSetBytes=$zipzapMeasured.PeakWorkingSet64;workingSetBytes=$zipzapMeasured.WorkingSet64;privateBytes=$zipzapMeasured.PrivateMemorySize64}|ConvertTo-Json -Compress`,
      ],
      { encoding: "utf8", windowsHide: true },
    ),
  );
}

const cert = path.join(directory, "fixture-cert.pem");
const key = path.join(directory, "fixture-key.pem");
execFileSync(
  "C:/Program Files/Git/usr/bin/openssl.exe",
  [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-nodes",
    "-keyout",
    key,
    "-out",
    cert,
    "-days",
    "1",
    "-subj",
    "/CN=localhost",
    "-addext",
    "subjectAltName=IP:127.0.0.1",
  ],
  { stdio: "ignore", windowsHide: true },
);
let scenario;
let requests = [];
let rejected = false;
let active = 0;
let peak = 0;
const handler = async (req, res) => {
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  const probe = range?.[1] === "0" && range?.[2] === "0";
  requests.push({ range: req.headers.range || null, probe });
  if (!probe) {
    active++;
    peak = Math.max(peak, active);
  }
  let counted = !probe;
  const finish = () => {
    if (counted) {
      active--;
      counted = false;
    }
  };
  res.once("close", finish);
  res.once("finish", finish);
  if (scenario === "rate-limit" && !rejected) {
    rejected = true;
    res.writeHead(429, { "Retry-After": "1" }).end();
    return;
  }
  // Delayed headers are an application-level latency model, not a network emulator.
  await delay(scenario === "latency" ? 80 : 5);
  const ranged = range && scenario !== "range-refusal";
  const start = ranged ? Number(range[1]) : 0;
  const end = ranged && range[2] ? Number(range[2]) : bytes.length - 1;
  assert.ok(start <= end && end < bytes.length);
  if (ranged)
    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${bytes.length}`,
      "Content-Length": end - start + 1,
      ETag: '"performance-v1"',
    });
  else res.writeHead(200, { "Content-Length": bytes.length, ETag: '"performance-v1"' });
  for (let offset = start; offset <= end && !res.destroyed; offset += 65536) {
    if (!res.write(bytes.subarray(offset, Math.min(offset + 65536, end + 1)))) {
      const controller = new AbortController();
      try {
        await Promise.race([
          once(res, "drain", { signal: controller.signal }),
          once(res, "close", { signal: controller.signal }),
        ]);
      } finally {
        controller.abort();
      }
    }
    const pacing = scenario === "unequal-segments" && offset >= (bytes.length * 3) / 4 ? 12 : 2;
    if (offset + 65536 <= end) await delay(pacing);
  }
  res.end();
};
const server = http.createServer((req, res) => void handler(req, res).catch(() => res.destroy()));
const secure = https.createServer(
  { cert: await readFile(cert), key: await readFile(key) },
  (req, res) => void handler(req, res).catch(() => res.destroy()),
);
for (const service of [server, secure]) {
  service.listen(0, "127.0.0.1");
  await once(service, "listening");
}

let client;
let browser;
let web;
try {
  for (const name of ["paced", "latency", "unequal-segments", "range-refusal", "rate-limit", "tls"])
    for (let repetition = 1; repetition <= repetitions; repetition++)
      for (const connections of repetition % 2 ? [1, 4] : [4, 1]) {
        scenario = name;
        requests = [];
        rejected = false;
        peak = 0;
        client = core(path.join(directory, `${name}-${repetition}-${connections}.sqlite`));
        await client.ask({
          command: "settings",
          value: { max_concurrent: 1, connections, speed_limit: 0, language: "en" },
        });
        const started = performance.now();
        const job = await client.ask({
          command: "add",
          url: `${name === "tls" ? "https" : "http"}://127.0.0.1:${(name === "tls" ? secure : server).address().port}/file`,
          folder: directory,
          filename: `${name}-${repetition}-${connections}.bin`,
        });
        let done;
        do {
          [done] = await client.ask({ command: "jobs" });
          if (["completed", "failed"].includes(done.status)) break;
          assert.ok(performance.now() - started < 60000, "Transfer deadline exceeded");
          await delay(10);
        } while (true);
        const elapsedMs = performance.now() - started;
        assert.equal(done.status, "completed", done.error);
        const sha256 = hash(await readFile(done.destination));
        assert.equal(sha256, expectedHash);
        if (name === "range-refusal") assert.ok(requests.every((r) => !r.range || r.probe));
        if (name === "rate-limit") assert.ok(done.attempt >= 2);
        assert.ok(peak <= connections);
        results.transfers.push({
          scenario: name,
          repetition,
          connections,
          elapsedMs,
          MiBPerSecond: 8 / (elapsedMs / 1000),
          sha256,
          peakResponseStreams: peak,
          requests: requests.length,
          attempts: done.attempt,
          ...metrics(client.child.pid),
        });
        await client.close();
        client = null;
        console.log(
          `${name} ${repetition}/${repetitions} connections=${connections}: ${elapsedMs.toFixed(0)} ms; hash verified`,
        );
      }
  // Trust remains enabled: the same self-signed server must fail without its explicit CA.
  client = core(path.join(directory, "untrusted.sqlite"), false);
  await client.ask({
    command: "add",
    url: `https://127.0.0.1:${secure.address().port}/file`,
    folder: directory,
    filename: "untrusted.bin",
  });
  let untrusted;
  for (let i = 0; i < 200; i++) {
    [untrusted] = await client.ask({ command: "jobs" });
    if (untrusted.status === "failed") break;
    await delay(25);
  }
  assert.equal(untrusted.status, "failed");
  assert.equal(untrusted.failure_reason, "tls");
  results.untrustedTlsRejected = true;
  await client.close();
  client = null;

  // Serve only the production web bundle, bound to loopback.
  const assets = new Map();
  web = http.createServer(async (req, res) => {
    const relative = req.url === "/" ? "index.html" : req.url?.slice(1);
    if (!relative || !/^(index\.html|assets\/[\w.-]+)$/.test(relative)) {
      res.writeHead(404).end();
      return;
    }
    try {
      if (!assets.has(relative))
        assets.set(relative, await readFile(path.join("apps/desktop/dist", relative)));
      res.setHeader(
        "Content-Type",
        relative.endsWith(".js")
          ? "text/javascript"
          : relative.endsWith(".css")
            ? "text/css"
            : "text/html",
      );
      res.end(assets.get(relative));
    } catch {
      res.writeHead(404).end();
    }
  });
  web.listen(0, "127.0.0.1");
  await once(web, "listening");
  browser = await chromium.launch({ headless: true });
  results.environment.chromium = browser.version();
  for (const count of [100, 1000]) {
    const database = path.join(directory, `history-${count}.sqlite`);
    client = core(database);
    for (let i = 0; i < count; i++)
      await client.ask({
        command: "add",
        later: true,
        url: `https://example.invalid/fixture-${i}`,
        folder: directory,
        filename: `fixture-${String(i).padStart(4, "0")}.bin`,
      });
    assert.equal((await client.ask({ command: "jobs" })).length, count);
    await client.close();
    client = null;
    const history = {
      rows: count,
      startupKind: "warm OS cache; fresh core process/browser context",
      samples: [],
    };
    for (const language of ["en", "ar"])
      for (let repetition = 1; repetition <= repetitions; repetition++) {
        const started = performance.now();
        client = core(database);
        const settings = await client.ask({ command: "settings" });
        const startupMs = performance.now() - started;
        await client.ask({
          command: "settings",
          value: {
            ...settings,
            language,
            view: { ...settings.view, sort: "recent", descending: false },
          },
        });
        const context = await browser.newContext({ viewport: { width: 1200, height: 800 } });
        const page = await context.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        const snapshots = [];
        await page.exposeFunction("benchmarkInvoke", async (command, args) => {
          if (command === "snapshot") {
            const at = performance.now();
            const jobs = await client.ask({ command: "jobs" });
            const queue = await client.ask({ command: "queue" });
            const settings = await client.ask({ command: "settings" });
            const value = {
              jobs,
              queue,
              settings,
              folder: directory,
              version: "0.1.0-beta.1",
              tray_available: false,
              native_error: "Unavailable in headless benchmark",
              notice: null,
            };
            snapshots.push({
              bridgeMs: performance.now() - at,
              jsonBytes: Buffer.byteLength(JSON.stringify(value)),
            });
            return value;
          }
          if (command === "save_settings")
            return client.ask({ command: "settings", value: args.settings });
          throw new Error("Unexpected benchmark command");
        });
        await page.addInitScript(() => {
          window.benchmarkFrames = [];
          window.__TAURI_INTERNALS__ = {
            invoke: async (command, args) => {
              const started = performance.now();
              const value = await window.benchmarkInvoke(command, args);
              if (command === "snapshot")
                requestAnimationFrame(() =>
                  requestAnimationFrame(() =>
                    window.benchmarkFrames.push(performance.now() - started),
                  ),
                );
              return value;
            },
          };
        });
        const loaded = performance.now();
        await page.goto(`http://127.0.0.1:${web.address().port}/`);
        await page.waitForFunction(
          (n) => document.querySelectorAll("tbody tr").length === n,
          count,
        );
        const renderMs = performance.now() - loaded;
        const session = await context.newCDPSession(page);
        await session.send("Performance.enable");
        const operations = [];
        for (let i = 0; i < 5; i++) {
          const duration = await page.evaluate(async () => {
            const input = document.querySelector('input[type="search"]');
            const started = performance.now();
            input.value = "fixture-0000.bin";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            await new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            );
            if (document.querySelectorAll("tbody tr").length !== 1)
              throw new Error("Search did not select one synthetic row");
            return performance.now() - started;
          });
          operations.push(duration);
          await page.locator('input[type="search"]').fill("");
          await page.waitForFunction(
            (n) => document.querySelectorAll("tbody tr").length === n,
            count,
          );
        }
        const sorts = [];
        for (const expected of [
          "fixture-0000.bin",
          `fixture-${String(count - 1).padStart(4, "0")}.bin`,
        ]) {
          const sortedAt = performance.now();
          await page.locator("thead th button").first().click();
          await page.waitForFunction(
            (name) => document.querySelector(".file-select bdi")?.textContent === name,
            expected,
          );
          sorts.push(performance.now() - sortedAt);
        }
        await page.locator(".file-select").first().click();
        assert.equal(await page.locator('.file-select[aria-pressed="true"]').count(), 1);
        const idleStart = await session.send("Performance.getMetrics");
        await delay(3000); // Include four ordinary 750 ms refreshes, not a disabled-polling UI.
        const idleEnd = await session.send("Performance.getMetrics");
        const metric = (response, name) => response.metrics.find((m) => m.name === name)?.value;
        assert.ok(snapshots.length >= 4);
        assert.deepEqual(errors, []);
        history.samples.push({
          language,
          repetition,
          coreStartupMs: startupMs,
          browserRenderMs: renderMs,
          searchToTwoFramesMs: operations,
          sortThroughCoreSaveMs: sorts,
          snapshotToTwoFramesMs: await page.evaluate(() => window.benchmarkFrames),
          snapshots,
          jsHeapUsedBytes: metric(idleEnd, "JSHeapUsedSize"),
          rendererTaskSecondsDuring3s:
            metric(idleEnd, "TaskDuration") - metric(idleStart, "TaskDuration"),
          ...metrics(client.child.pid),
        });
        await context.close();
        await client.close();
        client = null;
        console.log(
          `history=${count} ${language} ${repetition}/${repetitions}: core ${startupMs.toFixed(0)} ms, render ${renderMs.toFixed(0)} ms`,
        );
      }
    results.histories.push(history);
  }
  await writeFile(path.join(directory, "results.json"), JSON.stringify(results, null, 2) + "\n");
  console.log(`Results saved; databases and private fixture artifacts stay local: ${directory}`);
} finally {
  if (client) await client.close();
  if (browser) await browser.close();
  for (const service of [server, secure, web].filter(Boolean)) {
    service.closeAllConnections();
    await new Promise((resolve) => service.close(resolve));
  }
}
