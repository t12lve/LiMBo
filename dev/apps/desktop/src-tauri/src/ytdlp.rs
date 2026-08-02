//! Sidecar wrapper around `yt-dlp` for metadata/format discovery (`formats.list`).
//!
//! Binary resolution: prefers the repo's `prod/bin/<name>` (baked in via `CARGO_MANIFEST_DIR`
//! at compile time, so this only resolves on the dev machine's checkout), then falls back to
//! a file named `<name>` next to the running executable (covers a packaged build where the
//! sidecar was copied alongside the app). Run `node scripts/fetch-binaries.mjs` to populate
//! `prod/bin/` locally — the `.exe`s themselves are gitignored.

use std::path::PathBuf;
use std::process::{Child, Command, Stdio};

use serde::Serialize;
use serde_json::Value;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Serialize)]
pub struct VideoFormat {
    #[serde(rename = "formatId")]
    pub format_id: String,
    pub label: String,
    pub ext: String,
    pub height: Option<i64>,
    #[serde(rename = "hasAudio")]
    pub has_audio: bool,
    #[serde(rename = "hasVideo")]
    pub has_video: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct FormatsPayload {
    pub title: String,
    pub duration: f64,
    pub thumbnail: String,
    pub formats: Vec<VideoFormat>,
}

/// Repo-relative `prod/bin/` directory as seen from this crate's manifest, i.e.
/// `dev/apps/desktop/src-tauri/../../../../prod/bin` = `<repo root>/prod/bin`.
fn repo_bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../prod/bin")
}

fn resolve_binary_path(name: &str) -> Result<PathBuf, String> {
    let repo_candidate = repo_bin_dir().join(name);
    if repo_candidate.is_file() {
        return Ok(repo_candidate);
    }

    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(PathBuf::from)) {
        let sidecar_candidate = exe_dir.join(name);
        if sidecar_candidate.is_file() {
            return Ok(sidecar_candidate);
        }
    }

    Err(format!(
        "{name} not found (looked in the repo's prod/bin/ and next to the app executable); \
         run `node scripts/fetch-binaries.mjs` from dev/ to download it"
    ))
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn run_hidden(command: &mut Command) -> std::io::Result<std::process::Output> {
    hide_window(command);
    command.output()
}

/// Runs a metadata-only query (`--skip-download`) to obtain a video's title and id without
/// pulling the full `-J` JSON payload. Used by the job runner to fill in `JobSnapshot.title`
/// and to name `.part` files for cleanup, since `download.create` only carries `url`/`formatId`.
pub fn fetch_title_and_id(url: &str) -> Result<(String, String), String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;

    let output = run_hidden(Command::new(&ytdlp).args([
        "--no-playlist",
        "--skip-download",
        "--print",
        "%(title)s",
        "--print",
        "%(id)s",
        url,
    ]))
    .map_err(|e| format!("failed to spawn yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let trimmed = stderr.trim();
        return Err(if trimmed.is_empty() {
            format!("yt-dlp exited with {}", output.status)
        } else {
            format!("yt-dlp exited with {}: {trimmed}", output.status)
        });
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let mut lines = stdout.lines();
    let title = lines.next().unwrap_or("").trim().to_string();
    let id = lines.next().unwrap_or("").trim().to_string();

    if id.is_empty() {
        return Err("yt-dlp did not return a video id".to_string());
    }

    Ok((if title.is_empty() { "Untitled".to_string() } else { title }, id))
}

fn seconds_to_timecode(sec: f64) -> String {
    let total = sec.max(0.0).floor() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

/// Parameters for [`download`]. Borrowed rather than owned since the caller (job runner) already
/// holds the owned strings for the duration of the blocking call.
pub struct DownloadRequest<'a> {
    pub url: &'a str,
    pub format_id: &'a str,
    pub output_dir: &'a str,
    /// `(startSec, endSec)`, forwarded to `yt-dlp --download-sections "*HH:MM:SS-HH:MM:SS"`.
    pub trim: Option<(f64, f64)>,
}

/// Spawns `yt-dlp` to download `format_id` from `url` into `output_dir` (optionally trimmed),
/// with stdout/stderr piped so the caller can stream `--newline` progress and capture failures.
/// The caller owns the returned [`Child`]: it must read `stdout`, and either `wait()` it to
/// completion or `kill()` it to cancel.
pub fn download(req: DownloadRequest) -> Result<Child, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;
    let ffmpeg = resolve_binary_path("ffmpeg.exe")?;
    let ffmpeg_dir = ffmpeg
        .parent()
        .ok_or_else(|| "could not resolve ffmpeg.exe's parent directory".to_string())?;

    let output_template = format!(
        "{}/%(title)s [%(id)s].%(ext)s",
        req.output_dir.trim_end_matches(['/', '\\'])
    );

    let mut command = Command::new(&ytdlp);
    command
        .arg("-f")
        .arg(req.format_id)
        .arg("--no-playlist")
        .arg("-o")
        .arg(&output_template)
        .arg("--newline")
        // Without this, yt-dlp silently skips (exit 0, no download) when a file already sits at
        // the output path — e.g. re-downloading the same video/format with a different trim range
        // would otherwise reuse the untrimmed file from a prior job instead of regenerating it.
        .arg("--force-overwrites")
        .arg("--ffmpeg-location")
        .arg(ffmpeg_dir);

    if let Some((start, end)) = req.trim {
        command.arg("--download-sections").arg(format!(
            "*{}-{}",
            seconds_to_timecode(start),
            seconds_to_timecode(end)
        ));
    }

    command.arg(req.url);
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    hide_window(&mut command);

    command.spawn().map_err(|e| format!("failed to spawn yt-dlp: {e}"))
}

/// Runs `yt-dlp -J --no-playlist <url>` and turns the resulting JSON into a `FormatsPayload`.
pub fn list_formats(url: &str) -> Result<FormatsPayload, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;

    let output = run_hidden(Command::new(&ytdlp).args(["-J", "--no-playlist", url]))
        .map_err(|e| format!("failed to spawn yt-dlp: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let trimmed = stderr.trim();
        return Err(if trimmed.is_empty() {
            format!("yt-dlp exited with {}", output.status)
        } else {
            format!("yt-dlp exited with {}: {trimmed}", output.status)
        });
    }

    let raw: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("failed to parse yt-dlp JSON output: {e}"))?;

    parse_formats_payload(&raw)
}

fn parse_formats_payload(raw: &Value) -> Result<FormatsPayload, String> {
    let title = raw
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Untitled")
        .to_string();
    let duration = raw.get("duration").and_then(Value::as_f64).unwrap_or(0.0);
    let thumbnail = raw
        .get("thumbnail")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();

    let mut formats: Vec<VideoFormat> = raw
        .get("formats")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(format_from_value).collect())
        .unwrap_or_default();

    // Highest quality first; among equal heights, prefer the ones that already include audio
    // (no FFmpeg merge required to play/download them standalone).
    formats.sort_by(|a, b| {
        b.height
            .unwrap_or(-1)
            .cmp(&a.height.unwrap_or(-1))
            .then(b.has_audio.cmp(&a.has_audio))
    });
    formats.dedup_by(|a, b| {
        a.height == b.height
            && a.ext == b.ext
            && a.has_audio == b.has_audio
            && a.has_video == b.has_video
    });

    if formats.is_empty() {
        return Err("yt-dlp returned no usable formats for this URL".to_string());
    }

    Ok(FormatsPayload {
        title,
        duration,
        thumbnail,
        formats,
    })
}

/// Builds a `VideoFormat` from one entry of yt-dlp's `formats` array, or `None` if the entry
/// isn't a useful downloadable format (storyboards, formats with neither audio nor video, ...).
fn format_from_value(value: &Value) -> Option<VideoFormat> {
    let format_id = value.get("format_id").and_then(Value::as_str)?.to_string();
    let ext = value
        .get("ext")
        .and_then(Value::as_str)
        .unwrap_or("mp4")
        .to_string();

    if ext == "mhtml" {
        return None; // storyboard thumbnail sprite, not a downloadable format
    }

    let vcodec = value.get("vcodec").and_then(Value::as_str).unwrap_or("none");
    let acodec = value.get("acodec").and_then(Value::as_str).unwrap_or("none");
    let has_video = !vcodec.is_empty() && vcodec != "none";
    let has_audio = !acodec.is_empty() && acodec != "none";

    if !has_video && !has_audio {
        return None;
    }

    let height = value.get("height").and_then(Value::as_i64);

    let label = if has_video {
        match height {
            Some(h) if has_audio => format!("{h}p {ext}"),
            Some(h) => format!("{h}p {ext} (video only)"),
            None => {
                let note = value
                    .get("format_note")
                    .and_then(Value::as_str)
                    .unwrap_or("video");
                format!("{note} {ext}")
            }
        }
    } else {
        match value.get("abr").and_then(Value::as_f64) {
            Some(abr) if abr > 0.0 => format!("audio {abr:.0}kbps {ext}"),
            _ => format!("audio {ext}"),
        }
    };

    Some(VideoFormat {
        format_id,
        label,
        ext,
        height,
        has_audio,
        has_video,
    })
}
