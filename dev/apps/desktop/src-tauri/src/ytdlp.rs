//! Sidecar wrapper around `yt-dlp` for metadata/format discovery and downloads.
//!
//! Binary resolution: prefers the repo's `prod/bin/<name>`, then a file next to the running
//! executable. YouTube now requires an external JS runtime (EJS); we pass `--js-runtimes node`
//! with an absolute path when Node is available on the machine.

use std::path::{Path, PathBuf};
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

fn repo_bin_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../prod/bin")
}

fn resolve_binary_path(name: &str) -> Result<PathBuf, String> {
    let repo_candidate = repo_bin_dir().join(name);
    if repo_candidate.is_file() {
        return Ok(repo_candidate);
    }

    if let Some(exe_dir) = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
    {
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

/// Locates a usable Node.js ≥20 for yt-dlp's YouTube JS challenges.
fn resolve_node_path() -> Option<PathBuf> {
    let candidates = [
        std::env::var_os("NODE_PATH").map(PathBuf::from),
        which_in_path("node.exe"),
        which_in_path("node"),
        Some(PathBuf::from(r"C:\Program Files\nodejs\node.exe")),
        Some(PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe")),
        dirs::home_dir().map(|h| h.join(r"AppData\Local\Programs\node\node.exe")),
    ];

    for candidate in candidates.into_iter().flatten() {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn which_in_path(name: &str) -> Option<PathBuf> {
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn hide_window(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

/// Shared flags for every yt-dlp invocation (encoding, Windows-safe names, JS runtime, cookies).
fn apply_common_args(command: &mut Command, cookies_browser: Option<&str>) {
    command.arg("--encoding").arg("utf-8");
    command.arg("--windows-filenames");
    command.arg("--no-playlist");

    if let Some(node) = resolve_node_path() {
        let runtime = format!("node:{}", node.display());
        command.arg("--js-runtimes").arg(runtime);
    }

    if let Some(node) = resolve_node_path() {
        if let Some(dir) = node.parent() {
            prepend_path_env(command, dir);
        }
    }

    if let Some(browser) = cookies_browser {
        let b = browser.trim().to_ascii_lowercase();
        if !b.is_empty() && b != "none" {
            // Needed for Instagram / some Twitter / logged-in sites.
            command.arg("--cookies-from-browser").arg(b);
        }
    }
}

fn prepend_path_env(command: &mut Command, dir: &Path) {
    let mut paths = vec![dir.to_path_buf()];
    if let Some(existing) = std::env::var_os("PATH") {
        paths.extend(std::env::split_paths(&existing));
    }
    if let Ok(joined) = std::env::join_paths(paths) {
        command.env("PATH", joined);
    }
}

fn run_hidden(command: &mut Command) -> std::io::Result<std::process::Output> {
    hide_window(command);
    command.output()
}

pub fn fetch_title_and_id(url: &str, cookies_browser: Option<&str>) -> Result<(String, String), String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;

    let mut command = Command::new(&ytdlp);
    apply_common_args(&mut command, cookies_browser);
    command.args([
        "--skip-download",
        "--print",
        "%(title)s",
        "--print",
        "%(id)s",
        url,
    ]);

    let output = run_hidden(&mut command).map_err(|e| format!("failed to spawn yt-dlp: {e}"))?;

    if !output.status.success() {
        return Err(format_ytdlp_failure(&output));
    }

    let stdout = decode_utf8(&output.stdout);
    let mut lines = stdout.lines();
    let title = lines.next().unwrap_or("").trim().to_string();
    let id = lines.next().unwrap_or("").trim().to_string();

    if id.is_empty() {
        return Err("yt-dlp did not return a video id".to_string());
    }

    Ok((
        if title.is_empty() {
            "Untitled".to_string()
        } else {
            title
        },
        id,
    ))
}

fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn format_ytdlp_failure(output: &std::process::Output) -> String {
    let stderr = decode_utf8(&output.stderr);
    let trimmed = stderr.trim();
    // Keep the message short for the UI — take the last ERROR line if present.
    let concise = trimmed
        .lines()
        .rev()
        .find(|l| l.contains("ERROR:") || l.contains("Errno"))
        .or_else(|| trimmed.lines().rev().find(|l| l.contains("WARNING:")))
        .unwrap_or(trimmed);
    let clipped: String = concise.chars().take(280).collect();
    format!("yt-dlp exited with {}: {clipped}", output.status)
}

fn seconds_to_timecode(sec: f64) -> String {
    let total = sec.max(0.0).floor() as u64;
    let hours = total / 3600;
    let minutes = (total % 3600) / 60;
    let seconds = total % 60;
    format!("{hours:02}:{minutes:02}:{seconds:02}")
}

pub struct DownloadRequest<'a> {
    pub url: &'a str,
    pub format_id: &'a str,
    pub output_dir: &'a str,
    pub trim: Option<(f64, f64)>,
    pub cookies_browser: Option<&'a str>,
}

pub fn download(req: DownloadRequest) -> Result<Child, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;
    let ffmpeg = resolve_binary_path("ffmpeg.exe")?;
    let ffmpeg_dir = ffmpeg
        .parent()
        .ok_or_else(|| "could not resolve ffmpeg.exe's parent directory".to_string())?;

    let output_template = format!(
        "{}/%(title).180B [%(id)s].%(ext)s",
        req.output_dir.trim_end_matches(['/', '\\'])
    );

    let mut command = Command::new(&ytdlp);
    apply_common_args(&mut command, req.cookies_browser);
    command
        .arg("-f")
        .arg(req.format_id)
        .arg("-o")
        .arg(&output_template)
        .arg("--newline")
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

    command
        .spawn()
        .map_err(|e| format!("failed to spawn yt-dlp: {e}"))
}

pub fn list_formats(url: &str, cookies_browser: Option<&str>) -> Result<FormatsPayload, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;

    let mut command = Command::new(&ytdlp);
    apply_common_args(&mut command, cookies_browser);
    command.args(["-J", url]);

    let output = run_hidden(&mut command).map_err(|e| format!("failed to spawn yt-dlp: {e}"))?;

    if !output.status.success() {
        return Err(format_ytdlp_failure(&output));
    }

    let raw: Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("failed to parse yt-dlp JSON output: {e}"))?;

    parse_formats_payload(&raw)
}

#[derive(Clone)]
struct RawFormat {
    format_id: String,
    ext: String,
    height: Option<i64>,
    abr: Option<f64>,
    has_audio: bool,
    has_video: bool,
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

    let raw_formats: Vec<RawFormat> = raw
        .get("formats")
        .and_then(Value::as_array)
        .map(|list| list.iter().filter_map(raw_format_from_value).collect())
        .unwrap_or_default();

    let formats = curate_formats(&raw_formats);

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

/// Picks the best options for the popup:
/// - up to 3 with video+audio (progressive or video+best-audio merge)
/// - 1 best audio-only
/// - up to 3 video-only
fn curate_formats(raw: &[RawFormat]) -> Vec<VideoFormat> {
    let mut progressive: Vec<&RawFormat> = raw
        .iter()
        .filter(|f| f.has_video && f.has_audio)
        .collect();
    let mut video_only: Vec<&RawFormat> = raw
        .iter()
        .filter(|f| f.has_video && !f.has_audio)
        .collect();
    let mut audio_only: Vec<&RawFormat> = raw
        .iter()
        .filter(|f| f.has_audio && !f.has_video)
        .collect();

    progressive.sort_by(|a, b| b.height.unwrap_or(-1).cmp(&a.height.unwrap_or(-1)));
    video_only.sort_by(|a, b| b.height.unwrap_or(-1).cmp(&a.height.unwrap_or(-1)));
    audio_only.sort_by(|a, b| {
        b.abr
            .unwrap_or(0.0)
            .partial_cmp(&a.abr.unwrap_or(0.0))
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    dedup_by_height(&mut progressive);
    dedup_by_height(&mut video_only);

    let best_audio = audio_only.first().copied();

    let mut with_sound: Vec<VideoFormat> = Vec::new();
    let mut used_heights = std::collections::HashSet::new();

    for f in progressive.iter().take(3) {
        if let Some(h) = f.height {
            used_heights.insert(h);
        }
        with_sound.push(to_video_format(f, false));
    }

    if with_sound.len() < 3 {
        if let Some(audio) = best_audio {
            for v in video_only.iter() {
                if with_sound.len() >= 3 {
                    break;
                }
                if let Some(h) = v.height {
                    if !used_heights.insert(h) {
                        continue;
                    }
                }
                with_sound.push(VideoFormat {
                    format_id: format!("{}+{}", v.format_id, audio.format_id),
                    label: match v.height {
                        Some(h) => format!("{h}p {}+audio", v.ext),
                        None => format!("{}+audio", v.ext),
                    },
                    ext: "mp4".to_string(),
                    height: v.height,
                    has_audio: true,
                    has_video: true,
                });
            }
        }
    }

    // Sites like Twitter often expose only video tracks in -J; fall back to yt-dlp selectors
    // that merge best video + best audio at download time.
    if with_sound.is_empty() && !video_only.is_empty() {
        for v in video_only.iter().take(3) {
            let (format_id, label) = match v.height {
                Some(h) => (
                    format!("bv*[height<={h}]+ba/b"),
                    format!("{h}p avec son"),
                ),
                None => ("bv*+ba/b".to_string(), "Meilleure qualité avec son".to_string()),
            };
            with_sound.push(VideoFormat {
                format_id,
                label,
                ext: "mp4".to_string(),
                height: v.height,
                has_audio: true,
                has_video: true,
            });
        }
    }

    if with_sound.is_empty() {
        with_sound.push(VideoFormat {
            format_id: "bv*+ba/b".to_string(),
            label: "Meilleure qualité avec son".to_string(),
            ext: "mp4".to_string(),
            height: None,
            has_audio: true,
            has_video: true,
        });
    }

    let mut out = with_sound;

    if let Some(audio) = best_audio {
        out.push(to_video_format(audio, true));
    } else {
        out.push(VideoFormat {
            format_id: "ba/b".to_string(),
            label: "Meilleur audio seul".to_string(),
            ext: "m4a".to_string(),
            height: None,
            has_audio: true,
            has_video: false,
        });
    }

    for v in video_only.iter().take(3) {
        out.push(to_video_format(v, false));
    }

    out
}

fn dedup_by_height(list: &mut Vec<&RawFormat>) {
    let mut seen = std::collections::HashSet::new();
    list.retain(|f| match f.height {
        Some(h) => seen.insert(h),
        None => true,
    });
}

fn to_video_format(f: &RawFormat, prefer_audio_label: bool) -> VideoFormat {
    let label = if f.has_video && f.has_audio {
        match f.height {
            Some(h) => format!("{h}p {}", f.ext),
            None => format!("video+audio {}", f.ext),
        }
    } else if f.has_video {
        match f.height {
            Some(h) => format!("{h}p {} (video only)", f.ext),
            None => format!("video {}", f.ext),
        }
    } else if prefer_audio_label || f.has_audio {
        match f.abr {
            Some(abr) if abr > 0.0 => format!("audio {abr:.0}kbps {}", f.ext),
            _ => format!("audio {}", f.ext),
        }
    } else {
        f.ext.clone()
    };

    VideoFormat {
        format_id: f.format_id.clone(),
        label,
        ext: f.ext.clone(),
        height: f.height,
        has_audio: f.has_audio,
        has_video: f.has_video,
    }
}

fn raw_format_from_value(value: &Value) -> Option<RawFormat> {
    let format_id = value.get("format_id").and_then(Value::as_str)?.to_string();
    let ext = value
        .get("ext")
        .and_then(Value::as_str)
        .unwrap_or("mp4")
        .to_string();

    if ext == "mhtml" {
        return None;
    }

    let vcodec = value.get("vcodec").and_then(Value::as_str).unwrap_or("none");
    let acodec = value.get("acodec").and_then(Value::as_str).unwrap_or("none");
    let has_video = !vcodec.is_empty() && vcodec != "none";
    let has_audio = !acodec.is_empty() && acodec != "none";

    if !has_video && !has_audio {
        return None;
    }

    Some(RawFormat {
        format_id,
        ext,
        height: value.get("height").and_then(Value::as_i64),
        abr: value.get("abr").and_then(Value::as_f64),
        has_audio,
        has_video,
    })
}
