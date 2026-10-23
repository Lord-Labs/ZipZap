import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

const output = path.resolve(process.argv[2] || "dist/release");
await mkdir(output, { recursive: true });
for (const record of JSON.parse(await readFile("licenses/third-party/sources.json", "utf8"))) {
  const data = await readFile(path.join("licenses/third-party", `${record.package}.txt`));
  assert.equal(
    createHash("sha256").update(data).digest("hex"),
    record.sha256,
    `Supplemental notice changed: ${record.package}`,
  );
}
const metadata = JSON.parse(
  execFileSync(
    "cargo",
    [
      "metadata",
      "--locked",
      "--format-version",
      "1",
      "--filter-platform",
      "x86_64-pc-windows-msvc",
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024, windowsHide: true },
  ),
);
const nodes = new Map(metadata.resolve.nodes.map((n) => [n.id, n]));
const pending = [...metadata.workspace_members],
  included = new Set();
while (pending.length) {
  const id = pending.pop();
  if (included.has(id)) continue;
  included.add(id);
  pending.push(...nodes.get(id).deps.map((d) => d.pkg));
}
const entries = [];
const texts = [
  "ZipZap third-party notices\n\nIncludes the Windows dependency closure, build/test tooling and installed npm tooling.\nSome listed dependencies are build-only and are not part of the installed runtime.\nUnmodified MPL package source archives accompany this file under sources/.\nZipZap itself: MIT, https://github.com/Lord-shaban/ZipZap\n",
];
async function licenseFiles(folder, depth = 0) {
  const found = [];
  for (const file of (await readdir(folder, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  )) {
    const target = path.join(folder, file.name);
    if (
      file.isFile() &&
      /^(licen[cs]e|copying|notice|copyright|unlicense)([.\-_]|$)/i.test(file.name)
    )
      found.push(target);
    else if (
      file.isDirectory() &&
      depth < 2 &&
      !["node_modules", ".git", "target"].includes(file.name)
    )
      found.push(...(await licenseFiles(target, depth + 1)));
  }
  return found;
}
async function append(kind, name, version, license, folder, source) {
  assert.ok(license, `Missing license metadata: ${name}`);
  const files = await licenseFiles(folder);
  const override = path.resolve(
    "licenses/third-party",
    `${name.replaceAll("/", "-").replaceAll("@", "")}-${version}.txt`,
  );
  if (!files.length && name.startsWith("@rolldown/binding-"))
    files.push(...(await licenseFiles("node_modules/rolldown")));
  if (!files.length && name.startsWith("@tauri-apps/cli-"))
    files.push(...(await licenseFiles("node_modules/@tauri-apps/cli")));
  if (!files.length && (await stat(override).catch(() => false))) files.push(override);
  assert.ok(files.length, `Missing license text: ${name}@${version}`);
  const label = (file) =>
    path.resolve(file) === override
      ? `repository-notice/${path.basename(file)}`
      : path.relative(folder, file).startsWith("..")
        ? `shared-notice/${path.basename(path.dirname(file))}/${path.basename(file)}`
        : path.relative(folder, file).replaceAll("\\", "/");
  entries.push({ kind, name, version, license, source, licenseFiles: files.map(label) });
  texts.push(
    `\n${"=".repeat(72)}\n${kind}: ${name}@${version}\nLicense: ${license}\nSource: ${source}\n`,
  );
  for (const file of files)
    texts.push(`\n--- ${label(file)} ---\n${await readFile(file, "utf8")}\n`);
}
for (const pkg of metadata.packages
  .filter((p) => included.has(p.id) && p.source)
  .sort((a, b) => a.name.localeCompare(b.name))) {
  const folder = path.dirname(pkg.manifest_path);
  await append(
    "Cargo",
    pkg.name,
    pkg.version,
    pkg.license,
    folder,
    `https://crates.io/crates/${pkg.name}/${pkg.version}`,
  );
  if (pkg.license.includes("MPL-2.0")) {
    const registry = path.dirname(folder),
      registryName = path.basename(registry),
      cargoRegistry = path.dirname(path.dirname(registry));
    const archive = path.join(
      cargoRegistry,
      "cache",
      registryName,
      `${pkg.name}-${pkg.version}.crate`,
    );
    await mkdir(path.join(output, "sources"), { recursive: true });
    await copyFile(archive, path.join(output, "sources", path.basename(archive)));
  }
}
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const [folder, pkg] of Object.entries(lock.packages).sort(([a], [b]) => a.localeCompare(b))) {
  if (
    pkg.link ||
    !folder.includes("node_modules/") ||
    !(await stat(path.join(folder, "package.json")).catch(() => false))
  )
    continue;
  const manifest = JSON.parse(await readFile(path.join(folder, "package.json"), "utf8"));
  await append(
    "npm",
    manifest.name,
    pkg.version,
    typeof manifest.license === "string" ? manifest.license : manifest.license?.type,
    folder,
    pkg.resolved || manifest.repository?.url || "npm registry",
  );
}
if (process.platform === "win32") {
  const media = JSON.parse(await readFile("tools/media/manifest.json", "utf8"));
  await append(
    "Bundled media runtime",
    "CPython",
    media.python.version,
    "PSF and bundled third-party/Windows redistribution terms",
    "dist/media/python",
    media.python.url,
  );
  await append(
    "Bundled media runtime",
    "Node.js",
    media.node.version,
    "MIT and bundled third-party terms",
    "dist/media/node",
    media.node.url,
  );
  for (const [name, version, license, source] of [
    ["yt-dlp", media["yt-dlp"].version, "Unlicense", media["yt-dlp"].url],
    ["yt-dlp-ejs", "0.8.0", "Unlicense", "https://github.com/yt-dlp/ejs/tree/0.8.0"],
    ["meriyah", "6.1.4", "ISC", "https://registry.npmjs.org/meriyah/-/meriyah-6.1.4.tgz"],
    ["astring", "1.9.0", "MIT", "https://registry.npmjs.org/astring/-/astring-1.9.0.tgz"],
  ])
    await append("Bundled media component", name, version, license, "licenses/third-party", source);
  await writeFile(
    path.join(output, "INSTALLER_LICENSE.txt"),
    `${await readFile("LICENSE", "utf8")}\n\nBundled CPython and Windows redistribution terms\n\n${await readFile("dist/media/python/LICENSE.txt", "utf8")}\n\nMicrosoft Edge WebView2 Evergreen Runtime\nThe bundled, unmodified Microsoft bootstrapper is redistributed under Microsoft's terms, not the ZipZap MIT license. Setup runs it only when the runtime is absent; internet is then required to download the runtime from Microsoft. The shared runtime retains its normal Microsoft update behavior and is not removed with ZipZap.\nhttps://developer.microsoft.com/en-us/microsoft-edge/webview2/\nhttps://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution\n\nAdditional bundled component notices are installed in THIRD_PARTY_LICENSES.txt and media/licenses/.\n`,
  );
}
await writeFile(path.join(output, "THIRD_PARTY_LICENSES.txt"), texts.join("\n"));
await writeFile(path.join(output, "dependencies.json"), JSON.stringify(entries, null, 2) + "\n");
console.log(`Collected license texts for ${entries.length} dependencies; MPL sources copied.`);
