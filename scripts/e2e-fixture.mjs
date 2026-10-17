import http from "node:http";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
const folder = new URL("../.research-local/", import.meta.url);
await mkdir(folder, { recursive: true });
const full = Buffer.alloc(16 * 1024 * 1024);
for (let i = 0; i < full.length; i++) full[i] = (i * 17 + (i >>> 12)) & 255;
const note = Buffer.from("ZipZap native smoke test.\r\nاختبار تنزيل محلي آمن.\r\n", "utf8");
const server = http.createServer(async (req, res) => {
  if (req.url === "/") {
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.end(
      '<!doctype html><html><head><title>ZipZap integration fixture</title></head><body><h1>ZipZap browser integration</h1><a id="download" href="/browser.bin">Download the test file with ZipZap</a></body></html>',
    );
    return;
  }
  const data =
    req.url === "/smoke-note.txt"
      ? note
      : req.url?.includes("manual")
        ? full
        : full.subarray(0, 1024 * 1024);
  let start = 0,
    end = data.length - 1;
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range || "");
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Number(range[2]) : end;
    if (start > end || end >= data.length) {
      res.writeHead(416, { "Content-Range": `bytes */${data.length}` }).end();
      return;
    }
    res.statusCode = 206;
    res.setHeader("Content-Range", `bytes ${start}-${end}/${data.length}`);
  }
  res.setHeader("Content-Length", end - start + 1);
  res.setHeader("ETag", '"zipzap-e2e-v1"');
  res.setHeader("Content-Type", "application/octet-stream");
  for (let offset = start; offset <= end && !res.destroyed; offset += 32768) {
    res.write(data.subarray(offset, Math.min(offset + 32768, end + 1)));
    if (offset + 32768 <= end) await delay(req.url?.includes("manual") ? 70 : 1);
  }
  res.end();
});
server.listen(0, "127.0.0.1", async () => {
  const port = server.address().port;
  const value = {
    url: `http://127.0.0.1:${port}`,
    manualSha256: createHash("sha256").update(full).digest("hex"),
    browserSha256: createHash("sha256")
      .update(full.subarray(0, 1024 * 1024))
      .digest("hex"),
    noteSha256: createHash("sha256").update(note).digest("hex"),
  };
  await writeFile(new URL("e2e-fixture.json", folder), JSON.stringify(value, null, 2));
  console.log(JSON.stringify(value));
});
