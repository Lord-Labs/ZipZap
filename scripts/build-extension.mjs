import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile, copyFile, cp } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const folder = path.join(root, "extensions/browser");
const output = path.join(root, "dist/extension");
await mkdir(output, { recursive: true });
const result = spawnSync(
  process.execPath,
  [path.join(root, "node_modules/typescript/bin/tsc"), "-p", path.join(folder, "tsconfig.json")],
  { cwd: root, stdio: "inherit", windowsHide: true },
);
if (result.status !== 0) process.exit(result.status ?? 1);
const manifest = JSON.parse(await readFile(path.join(folder, "manifest.json"), "utf8"));
manifest.key = JSON.parse(await readFile(path.join(folder, "identity.json"), "utf8")).key;
await writeFile(path.join(output, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
for (const file of ["popup.html", "popup.css"])
  await copyFile(path.join(folder, file), path.join(output, file));
await cp(path.join(folder, "_locales"), path.join(output, "_locales"), { recursive: true });
for (const [size, name] of [
  [32, "32x32"],
  [128, "128x128"],
])
  await copyFile(
    path.join(root, `apps/desktop/src-tauri/icons/${name}.png`),
    path.join(output, `icon${size}.png`),
  );
console.log("Built dist/extension (load this folder unpacked in Chrome or Edge).");
