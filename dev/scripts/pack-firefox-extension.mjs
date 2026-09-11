// Packs the built Firefox extension into an .xpi archive ready to load in Firefox:
// - prod/firefox/LiMBo-firefox.xpi -> Charger dans about:debugging ou about:addons
//
// Usage: node scripts/pack-firefox-extension.mjs (from dev/)

import { cpSync, existsSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const distDir = path.join(root, "apps", "extension", "dist");
const outFirefoxDir = path.join(repo, "prod", "firefox");
const tempZipPath = path.join(outFirefoxDir, "LiMBo-firefox.zip");
const xpiPath = path.join(outFirefoxDir, "LiMBo-firefox.xpi");
const guideSrc = path.join(root, "apps", "extension", "install-instructions.html");

if (!existsSync(path.join(distDir, "manifest.json"))) {
  console.log("pack-firefox: compiling extension first...");
  const build = spawnSync("pnpm", ["--filter", "@limbo/extension", "build"], {
    cwd: root,
    stdio: "inherit",
    shell: true,
  });
  if (build.status !== 0) {
    console.error("pack-firefox: extension build failed");
    process.exit(build.status ?? 1);
  }
}

rmSync(outFirefoxDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
mkdirSync(outFirefoxDir, { recursive: true });
cpSync(distDir, outFirefoxDir, { recursive: true });

if (existsSync(guideSrc)) {
  cpSync(guideSrc, path.join(outFirefoxDir, "install-instructions.html"));
}

// Adapt manifest specifically for Firefox MV3
const manifestPath = path.join(outFirefoxDir, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  delete manifest.minimum_chrome_version;

  manifest.browser_specific_settings = {
    gecko: {
      id: "limbo@darkchylde.local",
      strict_min_version: "115.0",
    },
  };

  // Firefox MV3 event page background script (supports ES modules)
  manifest.background = {
    scripts: ["service-worker-loader.js"],
    type: "module",
  };

  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");
}

// Build .xpi using PowerShell Compress-Archive to .zip then rename to .xpi
const psZip = `
$src = '${outFirefoxDir.replace(/'/g, "''")}'
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

if (zipResult.status !== 0 || !existsSync(xpiPath)) {
  console.error("pack-firefox: xpi compression failed");
  process.exit(zipResult.status ?? 1);
}

console.log("Wrote unpacked Firefox extension:", outFirefoxDir);
console.log("Wrote Firefox .xpi package:", xpiPath);
