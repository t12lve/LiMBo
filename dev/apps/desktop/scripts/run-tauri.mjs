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
const isWindows = platform() === "win32";
const tauriCmd = isWindows
  ? join(desktopRoot, "node_modules", ".bin", "tauri.cmd")
  : join(desktopRoot, "node_modules", ".bin", "tauri");

const args = process.argv.slice(2);
// On Windows, spawning a .cmd file requires shell: true (Node refuses to spawn
// .cmd/.bat directly with shell: false — https://nodejs.org/en/blog/vulnerability/cve-2024-27980).
// Quote the command since the repo path may contain spaces (shell mode joins
// file+args into a single string without auto-quoting).
const child = spawn(isWindows ? `"${tauriCmd}"` : tauriCmd, args, {
  stdio: "inherit",
  env,
  shell: isWindows,
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 1);
});