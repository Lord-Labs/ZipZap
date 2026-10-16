import { spawnSync } from "node:child_process";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
if (process.platform !== "win32")
  throw new Error("Windows desktop packaging requires a Windows host");
const result = spawnSync("cargo", ["build", "-p", "zipzap-native", "--release", "--locked"], {
  cwd: root,
  stdio: "inherit",
  windowsHide: true,
});
if (result.status !== 0) process.exit(result.status ?? 1);
const folder = path.join(root, "apps/desktop/src-tauri/binaries");
await mkdir(folder, { recursive: true });
await copyFile(
  path.join(root, "target/release/zipzap-native.exe"),
  path.join(folder, "zipzap-native-x86_64-pc-windows-msvc.exe"),
);
