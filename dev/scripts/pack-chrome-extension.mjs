// Packs the built Chromium extension for Google Chrome:
// - LiMBo-chrome.zip  → charger décompressé / Chrome Web Store (manifest à la racine)
// - LiMBo-chrome.crx  → extension compressée Chrome (comme « Compresser l'extension »)
//
// Usage (from dev/): node scripts/pack-chrome-extension.mjs
// Prerequisite: prod/extension built (build-extension.mjs)

import { cpSync, existsSync, mkdirSync, rmSync, renameSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const built = path.join(repo, "prod", "extension");
const outDir = path.join(repo, "prod", "chrome");
const packDir = path.join(outDir, "LiMBo");
const zipPath = path.join(outDir, "LiMBo-chrome.zip");
const crxPath = path.join(outDir, "LiMBo-chrome.crx");
const pemPath = path.join(outDir, "LiMBo-chrome.pem");

function findChrome() {
  const candidates = [
    path.join(process.env.PROGRAMFILES || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env["PROGRAMFILES(X86)"] || "", "Google", "Chrome", "Application", "chrome.exe"),
    path.join(process.env.LOCALAPPDATA || "", "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.find((p) => p && existsSync(p)) ?? null;
}

if (!existsSync(path.join(built, "manifest.json"))) {
  console.error("pack-chrome: prod/extension manquant — lance d'abord build-extension.mjs");
  process.exit(1);
}

rmSync(outDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 300 });
mkdirSync(packDir, { recursive: true });
cpSync(built, packDir, { recursive: true });

// ZIP with manifest at archive root (Chrome / CWS)
const psZip = `
$src = '${packDir.replace(/'/g, "''")}'
$dest = '${zipPath.replace(/'/g, "''")}'
if (Test-Path $dest) { Remove-Item $dest -Force }
Compress-Archive -Path (Join-Path $src '*') -DestinationPath $dest -Force
`;
const zipResult = spawnSync(
  "powershell.exe",
  ["-NoProfile", "-NonInteractive", "-Command", psZip],
  { stdio: "inherit" },
);
if (zipResult.status !== 0) {
  console.error("pack-chrome: zip failed");
  process.exit(zipResult.status ?? 1);
}

const chrome = findChrome();
if (!chrome) {
  console.warn("pack-chrome: Chrome introuvable — zip OK, .crx non généré");
  console.log("Wrote", zipPath);
  process.exit(0);
}

// Pack .crx via Chrome (same as Edge « Compresser l'extension »)
const existingPem = existsSync(pemPath) ? pemPath : null;
const packArgs = [`--pack-extension=${packDir}`];
if (existingPem) {
  packArgs.push(`--pack-extension-key=${existingPem}`);
}

const pack = spawnSync(chrome, packArgs, { stdio: "inherit", windowsHide: true });
if (pack.status !== 0 && pack.status !== null) {
  // Chrome --pack-extension often exits 0; treat missing crx as failure
}

const generatedCrx = path.join(outDir, "LiMBo.crx");
const generatedPem = path.join(outDir, "LiMBo.pem");

if (existsSync(generatedCrx)) {
  if (existsSync(crxPath)) rmSync(crxPath, { force: true });
  renameSync(generatedCrx, crxPath);
}
if (existsSync(generatedPem) && !existsSync(pemPath)) {
  renameSync(generatedPem, pemPath);
}

if (!existsSync(crxPath)) {
  console.warn("pack-chrome: .crx non produit (Chrome a peut-être besoin d'une UI). Zip disponible.");
} else {
  console.log("Wrote", crxPath);
}
console.log("Wrote", zipPath);
if (existsSync(pemPath)) {
  console.log("Key ", pemPath, "(ne pas committer — signature des mises à jour .crx)");
}
