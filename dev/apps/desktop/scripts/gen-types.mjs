// Regenerates the shared TypeScript bindings from the Rust wire-contract types (ts-rs).
//
// `ts-rs` resolves its output directory from `.cargo/config.toml`, which cargo only discovers
// based on the *current working directory* — so this must run from `src-tauri/`, not from the
// repo root (a `--manifest-path` invocation would silently export to the wrong place).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const srcTauri = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri");

const result = spawnSync("cargo", ["test", "export_bindings"], {
  cwd: srcTauri,
  stdio: "inherit",
  shell: true,
});

process.exit(result.status ?? 1);
