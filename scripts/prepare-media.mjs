import { mkdir, readFile, writeFile, copyFile, rm, stat } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

assert.equal(process.platform, "win32", "Media packaging currently targets Windows x64");
const root = fileURLToPath(new URL("../", import.meta.url));
const manifest = JSON.parse(await readFile(path.join(root, "tools/media/manifest.json")));
const cache = path.join(root, ".research-local/media-assets");
const output = path.join(root, "dist/media");
await mkdir(cache, { recursive: true });
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function asset(name, record) {
  const target = path.join(cache, record.sha256 + (name === "yt-dlp" ? ".zipapp" : ".zip"));
  const saved = await readFile(target).catch(() => null);
  if (saved?.length === record.bytes && digest(saved) === record.sha256) return target;
  let failure;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetch(record.url, { signal: AbortSignal.timeout(30000) });
      assert.equal(response.status, 200, `Cannot fetch pinned ${name}`);
      let size = 0;
      const chunks = [];
      for await (const chunk of response.body) {
        size += chunk.length;
        assert.ok(size <= record.bytes, `Pinned ${name} size rejected`);
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      assert.equal(bytes.length, record.bytes, `Pinned ${name} size mismatch`);
      assert.equal(digest(bytes), record.sha256, `Pinned ${name} checksum mismatch`);
      await writeFile(target, bytes);
      return target;
    } catch (error) {
      failure = error;
    }
  }
  throw failure;
}
const assets = {};
for (const [name, record] of Object.entries(manifest)) assets[name] = await asset(name, record);
// Only generated output is rebuilt. Verify the absolute target before recursive removal.
assert.equal(path.resolve(output), path.join(root, "dist", "media"));
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
function extract(archive, destination) {
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:ZIPZAP_MEDIA_ARCHIVE,$env:ZIPZAP_MEDIA_EXTRACT)",
    ],
    {
      windowsHide: true,
      stdio: "pipe",
      env: { ...process.env, ZIPZAP_MEDIA_ARCHIVE: archive, ZIPZAP_MEDIA_EXTRACT: destination },
    },
  );
}
extract(assets.python, path.join(output, "python"));
await mkdir(path.join(output, "node"));
execFileSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive=[IO.Compression.ZipFile]::OpenRead($env:ZIPZAP_MEDIA_ARCHIVE)
try { foreach($name in @('node.exe','LICENSE')) {
  $entry=$archive.GetEntry($env:ZIPZAP_NODE_PREFIX+'/'+$name)
  if (!$entry) {throw 'Missing pinned Node member'}
  [IO.Compression.ZipFileExtensions]::ExtractToFile($entry,[IO.Path]::Combine($env:ZIPZAP_MEDIA_EXTRACT,$name),$true)
}} finally {$archive.Dispose()}
`,
  ],
  {
    windowsHide: true,
    stdio: "pipe",
    env: {
      ...process.env,
      ZIPZAP_MEDIA_ARCHIVE: assets.node,
      ZIPZAP_MEDIA_EXTRACT: path.join(output, "node"),
      ZIPZAP_NODE_PREFIX: `node-v${manifest.node.version}-win-x64`,
    },
  },
);
await copyFile(assets["yt-dlp"], path.join(output, "yt-dlp"));
await copyFile(path.join(root, "tools/media/resolve.py"), path.join(output, "resolve.py"));
await copyFile(path.join(root, "tools/media/manifest.json"), path.join(output, "manifest.json"));
await mkdir(path.join(output, "licenses"));
for (const name of ["yt-dlp-2026.10.21", "yt-dlp-ejs-0.8.0", "meriyah-6.1.4", "astring-1.9.0"])
  await copyFile(
    path.join(root, "licenses/third-party", `${name}.txt`),
    path.join(output, "licenses", `${name}.txt`),
  );
assert.ok((await stat(path.join(output, "python/python.exe"))).isFile());
assert.ok((await stat(path.join(output, "node/node.exe"))).isFile());
console.log("Prepared pinned media resources and notices; no application media request was made.");
