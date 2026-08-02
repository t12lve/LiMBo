// Builds the Tauri desktop app in release mode and copies the resulting executable,
// installer bundle(s) (.msi/.exe), and sidecar binaries (yt-dlp/ffmpeg) into `prod/desktop/`.
//
// Delegates to `apps/desktop`'s `tauri` script (`apps/desktop/scripts/run-tauri.mjs`) so the
// release build gets the same `CARGO_TARGET_DIR` redirect to
// `%LOCALAPPDATA%\limbo-desktop-cargo-target` used everywhere else in this project — this keeps
// Cargo's build artifacts (and their file locks) out of the Dropbox-synced repo folder.
//
// Usage: node scripts/build-desktop.mjs (from `dev/`, or via `pnpm build`)

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const desktopDir = path.join(root, "apps", "desktop");
const out = path.join(repo, "prod", "desktop");

const result = spawnSync("pnpm", ["run", "tauri", "build"], {
  cwd: desktopDir,
  stdio: "inherit",
  shell: true,
});
if (result.status !== 0) {
  console.error("build-desktop: `tauri build` failed");
  process.exit(result.status ?? 1);
}

// Mirrors `apps/desktop/scripts/run-tauri.mjs`'s CARGO_TARGET_DIR override so we look in the
// same place it actually built to. Windows-only for now, matching the rest of this project.
const cargoTargetDir =
  platform() === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "limbo-desktop-cargo-target")
    : path.join(desktopDir, "src-tauri", "target");
const releaseDir = path.join(cargoTargetDir, "release");

// The repo lives in a Dropbox-synced folder; Dropbox can transiently hold an EPERM/EBUSY
// lock on files it's still indexing/uploading (e.g. right after the previous build wrote
// a large .exe here), so retry a few times instead of failing outright.
rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(out, { recursive: true });

const exeName = platform() === "win32" ? "limbo-desktop.exe" : "limbo-desktop";
const exePath = path.join(releaseDir, exeName);
if (existsSync(exePath)) {
  cpSync(exePath, path.join(out, exeName));
} else {
  // `tauri build` reported success but the exe isn't where we expect it — treat this as a hard
  // failure rather than silently shipping an empty prod/desktop/, which earlier only warned.
  console.error(`build-desktop: expected executable not found at ${exePath}`);
  process.exit(1);
}

const bundleDir = path.join(releaseDir, "bundle");
if (existsSync(bundleDir)) {
  cpSync(bundleDir, path.join(out, "bundle"), { recursive: true });
} else {
  console.warn(`build-desktop: expected bundle dir not found at ${bundleDir}`);
}

// Sidecars (yt-dlp/ffmpeg) aren't bundled by Tauri. `resolve_binary_path` in `ytdlp.rs`
// falls back to looking next to the running executable, so copy them alongside the exe
// here to keep `prod/desktop/` runnable standalone (e.g. on a machine without this repo).
const binDir = path.join(repo, "prod", "bin");
if (existsSync(binDir)) {
  for (const entry of readdirSync(binDir)) {
    if (entry.toLowerCase().endsWith(".exe")) {
      cpSync(path.join(binDir, entry), path.join(out, entry));
    }
  }
}

console.log("Wrote", out);
