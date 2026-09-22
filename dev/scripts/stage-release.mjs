import { cpSync, existsSync, mkdirSync, rmSync, readdirSync, statSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir, platform } from "node:os";
import path from "node:path";

const scriptsDir = import.meta.dirname;
const repo = path.resolve(scriptsDir, "..", "..");
const releaseDir = path.join(repo, ".release-assets");

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const pkg = JSON.parse(readFileSync(path.join(repo, "dev", "apps", "desktop", "package.json"), "utf-8"));
const version = pkg.version;

const cargoTargetDir =
  platform() === "win32"
    ? path.join(process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"), "limbo-desktop-cargo-target")
    : path.join(repo, "dev", "apps", "desktop", "src-tauri", "target");

const releaseTarget = path.join(cargoTargetDir, "release");
const nsisTarget = path.join(releaseTarget, "bundle", "nsis");

// 1. Setup installer
const setupExe = path.join(nsisTarget, `LiMBo_${version}_x64-setup.exe`);
if (existsSync(setupExe)) {
  cpSync(setupExe, path.join(releaseDir, `LiMBo_${version}_x64-setup.exe`));
} else {
  // fallback to prod/desktop/LiMBo-Installer.exe
  cpSync(path.join(repo, "prod", "desktop", "LiMBo-Installer.exe"), path.join(releaseDir, `LiMBo_${version}_x64-setup.exe`));
}

// 2. Portable desktop zip
const portableDir = path.join(homedir(), "AppData", "Local", "Temp", "limbo-portable-staging-" + Date.now());
mkdirSync(portableDir, { recursive: true });
cpSync(path.join(releaseTarget, "limbo-desktop.exe"), path.join(portableDir, "limbo-desktop.exe"));
cpSync(path.join(repo, "prod", "bin", "yt-dlp.exe"), path.join(portableDir, "yt-dlp.exe"));
cpSync(path.join(repo, "prod", "bin", "ffmpeg.exe"), path.join(portableDir, "ffmpeg.exe"));

const portableZip = path.join(releaseDir, `LiMBo-desktop-portable-${version}.zip`);
const psPortable = `Compress-Archive -Path '${path.join(portableDir, "*")}' -DestinationPath '${portableZip}' -Force`;
spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psPortable], { stdio: "inherit" });
try {
  rmSync(portableDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
} catch {}

// 3. Chrome CRX
const crxSrc = path.join(repo, "prod", "chrome", "LiMBo-chrome.crx");
if (existsSync(crxSrc)) {
  cpSync(crxSrc, path.join(releaseDir, `LiMBo-chrome-${version}.crx`));
}

// 4. Extension zip
const extZipSrc = path.join(repo, "prod", "chrome", "LiMBo-chrome.zip");
if (existsSync(extZipSrc)) {
  cpSync(extZipSrc, path.join(releaseDir, `LiMBo-extension-${version}.zip`));
}

// 5. Firefox XPI
const ffXpiSrc = path.join(repo, "prod", "firefox", "LiMBo-firefox.xpi");
if (existsSync(ffXpiSrc)) {
  cpSync(ffXpiSrc, path.join(releaseDir, `LiMBo-firefox-${version}.xpi`));
}

// 6. Premiere CEP zip
const premiereZip = path.join(releaseDir, `LiMBo-premiere-${version}.zip`);
const premiereSrc = path.join(repo, "prod", "premiere", "*");
const psPremiere = `Compress-Archive -Path '${premiereSrc}' -DestinationPath '${premiereZip}' -Force`;
spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", psPremiere], { stdio: "inherit" });

console.log("Release assets ready in:", releaseDir);
for (const file of readdirSync(releaseDir)) {
  const s = statSync(path.join(releaseDir, file));
  console.log(`- ${file} (${(s.size / (1024 * 1024)).toFixed(2)} MB)`);
}
