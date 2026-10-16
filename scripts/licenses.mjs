import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, copyFile, stat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const output = path.resolve(process.argv[2] || "dist/release");
await mkdir(output, { recursive: true });
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
await writeFile(path.join(output, "THIRD_PARTY_LICENSES.txt"), texts.join("\n"));
await writeFile(path.join(output, "dependencies.json"), JSON.stringify(entries, null, 2) + "\n");
console.log(`Collected license texts for ${entries.length} dependencies; MPL sources copied.`);
