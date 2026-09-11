// Builds both Chromium and Firefox extension packages and copies outputs into:
// - `prod/extension/` (Chromium MV3: Chrome, Edge, Brave, etc.)
// - `prod/firefox/`   (Firefox MV3: unpacked + LiMBo-firefox.xpi)
// - `prod/extension/install-instructions.html` (interactive user installation guide)
//
// Usage: node scripts/build-extension.mjs (from `dev/`, or via `pnpm build`)

import { cpSync, existsSync, rmSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const distDir = path.join(root, "apps", "extension", "dist");
const outChromium = path.join(repo, "prod", "extension");
const outFirefox = path.join(repo, "prod", "firefox");
const tempZipPath = path.join(outFirefox, "LiMBo-firefox.zip");
const xpiPath = path.join(outFirefox, "LiMBo-firefox.xpi");
const guideSrc = path.join(root, "apps", "extension", "install-instructions.html");

const result = spawnSync("pnpm", ["--filter", "@limbo/extension", "build"], {
  cwd: root,
  stdio: "inherit",
  shell: true,
});
if (result.status !== 0) {
  console.error("build-extension: `pnpm --filter @limbo/extension build` failed");
  process.exit(result.status ?? 1);
}

if (!existsSync(distDir)) {
  console.error(`build-extension: expected build output not found at ${distDir}`);
  process.exit(1);
}

// 1. Output Chromium build (prod/extension)
rmSync(outChromium, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(outChromium, { recursive: true });
cpSync(distDir, outChromium, { recursive: true });

if (existsSync(guideSrc)) {
  cpSync(guideSrc, path.join(outChromium, "install-instructions.html"));
}
console.log("Wrote Chromium extension:", outChromium);

// 2. Output Firefox build (prod/firefox)
rmSync(outFirefox, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(outFirefox, { recursive: true });
cpSync(distDir, outFirefox, { recursive: true });

if (existsSync(guideSrc)) {
  cpSync(guideSrc, path.join(outFirefox, "install-instructions.html"));
}

// Adapt manifest specifically for Firefox MV3
const ffManifestPath = path.join(outFirefox, "manifest.json");
if (existsSync(ffManifestPath)) {
  const manifest = JSON.parse(readFileSync(ffManifestPath, "utf-8"));
  delete manifest.minimum_chrome_version;

  manifest.browser_specific_settings = {
    gecko: {
      id: "limbo@darkchylde.local",
      strict_min_version: "115.0",
    },
  };

  manifest.background = {
    scripts: ["service-worker-loader.js"],
    type: "module",
  };

  writeFileSync(ffManifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

// Pack .xpi for Firefox using Compress-Archive to .zip then rename to .xpi
const psZip = `
$src = '${outFirefox.replace(/'/g, "''")}'
$tempZip = '${tempZipPath.replace(/'/g, "''")}'
$finalXpi = '${xpiPath.replace(/'/g, "''")}'
if (Test-Path $tempZip) { Remove-Item $tempZip -Force }
if (Test-Path $finalXpi) { Remove-Item $finalXpi -Force }
Compress-Archive -Path (Get-ChildItem -Path $src -Exclude '*.xpi','*.zip' | Select-Object -ExpandProperty FullName) -DestinationPath $tempZip -Force
Move-Item -Path $tempZip -Destination $finalXpi -Force
`;

const zipResult = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-Command", psZip],
  { stdio: "inherit" },
);

if (zipResult.status === 0 && existsSync(xpiPath)) {
  console.log("Wrote Firefox extension (.xpi & unpacked):", outFirefox);
} else {
  console.warn("build-extension: failed to compress Firefox .xpi, unpacked folder is ready");
}
