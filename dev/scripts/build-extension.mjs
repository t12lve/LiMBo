// Builds the Chrome extension and copies the Vite output into `prod/extension/`, ready to
// be loaded via `chrome://extensions` → "Charger l'extension non empaquetée".
//
// Usage: node scripts/build-extension.mjs (from `dev/`, or via `pnpm build`)

import { cpSync, existsSync, rmSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const repo = path.resolve(root, "..");
const distDir = path.join(root, "apps", "extension", "dist");
const out = path.join(repo, "prod", "extension");

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

// The repo lives in a Dropbox-synced folder; Dropbox can transiently hold an EPERM/EBUSY
// lock on files it's still indexing/uploading, so retry a few times instead of failing.
rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
mkdirSync(out, { recursive: true });
cpSync(distDir, out, { recursive: true });

console.log("Wrote", out);
