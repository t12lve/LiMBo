// Downloads the yt-dlp and ffmpeg sidecar binaries used by the Desktop app into `prod/bin/`.
// These binaries are large and platform-specific, so they are never committed to git —
// `prod/bin/` only tracks a `.gitkeep`; run this script to (re)populate it locally.
//
// Usage: node scripts/fetch-binaries.mjs [--force]
//   --force  re-download even if the binary already exists.
//
// Windows-only for now (matches the rest of the project); relies on Node's global `fetch`
// (stable since Node 18) and on PowerShell's `Expand-Archive` to unzip the ffmpeg build,
// avoiding a new npm dependency just for this one-off setup script.

import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BIN_DIR = path.join(REPO_ROOT, "prod", "bin");

const YTDLP_URL = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
const FFMPEG_ZIP_URL = "https://www.gyan.dev/ffmpeg/builds/ffmpeg-release-essentials.zip";

const FORCE = process.argv.includes("--force");

async function downloadFile(url, destPath) {
  console.log(`downloading ${url}`);
  const response = await fetch(url, { redirect: "follow" });
  if (!response.ok) {
    throw new Error(`failed to download ${url}: HTTP ${response.status}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(destPath, buffer);
  console.log(`wrote ${destPath} (${buffer.length} bytes)`);
}

function findFileRecursive(dir, fileName) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(full, fileName);
      if (found) return found;
    } else if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) {
      return full;
    }
  }
  return null;
}

async function fetchYtDlp() {
  const dest = path.join(BIN_DIR, "yt-dlp.exe");
  if (existsSync(dest) && !FORCE) {
    console.log("yt-dlp.exe already present, skipping (use --force to re-download)");
    return;
  }
  await downloadFile(YTDLP_URL, dest);
}

async function fetchFfmpeg() {
  const dest = path.join(BIN_DIR, "ffmpeg.exe");
  if (existsSync(dest) && !FORCE) {
    console.log("ffmpeg.exe already present, skipping (use --force to re-download)");
    return;
  }

  const tmpDir = mkdtempSync(path.join(os.tmpdir(), "limbo-ffmpeg-"));
  try {
    const zipPath = path.join(tmpDir, "ffmpeg.zip");
    await downloadFile(FFMPEG_ZIP_URL, zipPath);

    console.log("extracting ffmpeg.zip...");
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmpDir}' -Force`,
    ]);

    const extracted = findFileRecursive(tmpDir, "ffmpeg.exe");
    if (!extracted) {
      throw new Error("could not locate ffmpeg.exe inside the extracted ffmpeg-release-essentials.zip");
    }
    copyFileSync(extracted, dest);
    console.log(`wrote ${dest}`);
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function main() {
  mkdirSync(BIN_DIR, { recursive: true });
  await fetchYtDlp();
  await fetchFfmpeg();
  console.log(`done. binaries in ${BIN_DIR}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
