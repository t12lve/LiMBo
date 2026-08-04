// Copies the CEP panel sources into `prod/premiere/` (loadable / installable as LiMBO-premiere).
//
// Usage: node scripts/build-premiere.mjs (from `dev/`, or via `pnpm --filter @limbo/premiere build`)

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const src = path.join(root, "apps", "premiere");
const out = path.join(repo, "prod", "premiere");

const required = [
  "CSXS/manifest.xml",
  "index.html",
  "css/panel.css",
  "js/CSInterface.js",
  "js/panel.js",
  "jsx/host.jsx",
  "icons/logo.png",
  ".debug",
];

for (const rel of required) {
  if (!existsSync(path.join(src, rel))) {
    console.error(`build-premiere: missing ${rel}`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(out, { recursive: true });
cpSync(src, out, {
  recursive: true,
  filter: (p) => !p.endsWith("package.json") && !p.endsWith("node_modules"),
});

writeFileSync(
  path.join(out, "INSTALL.txt"),
  [
    "LiMBO-premiere — installation Windows",
    "",
    "1. Lance LiMBo Desktop (doit écouter ws://127.0.0.1:4567).",
    "2. Depuis dev/:  pnpm --filter @limbo/premiere install:cep",
    "   (copie vers %APPDATA%\\Adobe\\CEP\\extensions\\LiMBO-premiere",
    "    et active PlayerDebugMode pour CSXS.9–12).",
    "3. Redémarre Premiere Pro.",
    "4. Fenêtre → Extensions → LiMBO-premiere",
    "",
    "Source build: " + out,
    "",
  ].join("\r\n"),
);

console.log("Wrote", out);
