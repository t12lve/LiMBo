// WS wire-contract types. The runtime source of truth is the Rust desktop backend: these are
// generated from it by `ts-rs` (see `#[ts(export)]` in `src-tauri/src/job_runner.rs` /
// `ytdlp.rs`, and `src-tauri/.cargo/config.toml` for the output directory), so the TS and Rust
// sides can no longer drift apart silently.
//
// Regenerate after changing a Rust type: `pnpm --filter @limbo/desktop gen:types`
// (or `cargo test export_bindings` from `src-tauri/`). Never hand-edit `./generated/*`.
export type { JobPhase } from "./generated/JobPhase";
export type { TrimRange } from "./generated/TrimRange";
export type { VideoFormat } from "./generated/VideoFormat";
// `JobSnapshot.error` / `outputPath` / `mode` are optional (`#[ts(optional_fields)]`): the Rust
// side omits them entirely (`skip_serializing_if`), so treat them as *absent*, not `null`.
//   - `outputPath`: absolute path of the finished file (when `phase` is `done`);
//   - `mode`: download mode used in the filename — `combo | son | video | *_trimmed`.
export type { JobSnapshot } from "./generated/JobSnapshot";

/** Desktop default quality preference synced to the extension via prefs.snapshot. */
export type DefaultQuality = "best_image" | "best_sound";
