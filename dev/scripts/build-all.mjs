// Full `/dev` → `/prod` pipeline: ensures the yt-dlp/ffmpeg sidecar binaries are present,
// then builds the extension and the desktop app. This is what `pnpm build` (run from `dev/`)
// invokes; run the individual `build-extension.mjs` / `build-desktop.mjs` scripts directly
// if you only need one of the two.

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const scriptsDir = import.meta.dirname;
const repo = path.resolve(scriptsDir, "..", "..");

function run(script) {
  const result = spawnSync(process.execPath, [path.join(scriptsDir, script)], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    console.error(`build-all: ${script} failed`);
    process.exit(result.status ?? 1);
  }
}

const binDir = path.join(repo, "prod", "bin");
const haveBinaries = ["yt-dlp.exe", "ffmpeg.exe"].every((name) => existsSync(path.join(binDir, name)));
if (haveBinaries) {
  console.log("build-all: sidecar binaries already present, skipping fetch-binaries.mjs");
} else {
  run("fetch-binaries.mjs");
}

run("build-extension.mjs");
run("build-premiere.mjs");
run("build-desktop.mjs");

console.log("build-all: done");
