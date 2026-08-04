// Installs LiMBO-premiere into the Adobe CEP extensions folder and enables PlayerDebugMode
// so unsigned CEP panels load in Premiere Pro (Windows).
//
// Usage: node scripts/install-premiere.mjs

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const built = path.join(repo, "prod", "premiere");
const src = existsSync(path.join(built, "CSXS", "manifest.xml"))
  ? built
  : path.join(root, "apps", "premiere");

if (!existsSync(path.join(src, "CSXS", "manifest.xml"))) {
  console.error("install-premiere: sources introuvables — lance d'abord build-premiere.mjs");
  process.exit(1);
}

if (process.platform !== "win32") {
  console.error("install-premiere: Windows uniquement pour l'instant");
  process.exit(1);
}

const dest = path.join(os.homedir(), "AppData", "Roaming", "Adobe", "CEP", "extensions", "LiMBO-premiere");
mkdirSync(path.dirname(dest), { recursive: true });
rmSync(dest, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(dest, { recursive: true });
cpSync(src, dest, {
  recursive: true,
  filter: (p) => !p.endsWith("package.json") && !p.endsWith("INSTALL.txt") && !p.endsWith("node_modules"),
});

const versions = ["9.0", "10.0", "11.0", "12.0"];
for (const v of versions) {
  const key = `HKCU\\Software\\Adobe\\CSXS.${v}`;
  spawnSync("reg", ["add", key, "/v", "PlayerDebugMode", "/t", "REG_SZ", "/d", "1", "/f"], {
    stdio: "ignore",
  });
}

console.log("install-premiere: installé →", dest);
console.log("install-premiere: PlayerDebugMode activé (CSXS.9–12)");
console.log("Redémarre Premiere Pro, puis: Fenêtre → Extensions → LiMBO-premiere");
