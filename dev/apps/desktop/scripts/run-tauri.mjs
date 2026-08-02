import { spawn } from "node:child_process";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cargoBin = join(homedir(), ".cargo", "bin");
const pathKey = platform() === "win32" ? "Path" : "PATH";
const env = { ...process.env };
const sep = platform() === "win32" ? ";" : ":";
env[pathKey] = `${cargoBin}${sep}${env[pathKey] ?? ""}`;

if (platform() === "win32") {
  const localAppData =
    process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local");
  env.CARGO_TARGET_DIR = join(localAppData, "limbo-desktop-cargo-target");
}

const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const tauriCli = join(
  desktopRoot,
  "node_modules",
  "@tauri-apps",
  "cli",
  "tauri.js",
);

const args = process.argv.slice(2);
const child = spawn(process.execPath, [tauriCli, ...args], {
  stdio: "inherit",
  env,
  shell: false,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});