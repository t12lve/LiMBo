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

        let res_candidate = exe_dir.join("resources").join(name);
        if res_candidate.is_file() {
            return Ok(res_candidate);
        }

        let bin_candidate = exe_dir.join("bin").join(name);
        if bin_candidate.is_file() {
            return Ok(bin_candidate);
        }
    }

    Err(format!(
        "{name} not found (looked in the repo's prod/bin/, next to the app executable, and in resources/); \
         run `node scripts/fetch-binaries.mjs` from dev/ to download it"
    ))
}

/// Locates a usable Node.js ≥20 for yt-dlp's YouTube JS challenges.
fn resolve_node_path() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();

    if let Some(p) = std::env::var_os("NODE_PATH").map(PathBuf::from) {
        candidates.push(p);
    }
    if let Some(p) = which_in_path("node.exe") {
        candidates.push(p);
    }
    if let Some(p) = which_in_path("node") {
        candidates.push(p);
    }
    if let Some(p) = which_via_where("node.exe") {
        candidates.push(p);
    }

    candidates.extend([
        PathBuf::from(r"C:\Program Files\nodejs\node.exe"),
        PathBuf::from(r"C:\Program Files (x86)\nodejs\node.exe"),
    ]);

    if let Some(home) = dirs::home_dir() {
        candidates.push(home.join(r"AppData\Local\Programs\node\node.exe"));
        candidates.push(home.join(r"AppData\Roaming\nvm"));
        // nvm-windows: …\nvm\<version>\node.exe — pick any version folder
        let nvm = home.join(r"AppData\Roaming\nvm");
        if nvm.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&nvm) {
                for entry in entries.flatten() {
                    let node = entry.path().join("node.exe");
                    if node.is_file() {
                        candidates.push(node);
                    }
                }
            }
        }
        let fnm = home.join(r"AppData\Local\fnm_multishells");
        if fnm.is_dir() {
            if let Ok(entries) = std::fs::read_dir(&fnm) {
                for entry in entries.flatten() {
                    let node = entry.path().join("node.exe");
                    if node.is_file() {
                        candidates.push(node);
                    }
                }
            }
        }
    }

    for candidate in candidates {
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

fn which_via_where(name: &str) -> Option<PathBuf> {
    let mut command = Command::new("where.exe");
    command.arg(name);
    hide_window(&mut command);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let first = stdout.lines().next()?.trim();
    if first.is_empty() {
        return None;
    }
    let path = PathBuf::from(first);
    path.is_file().then_some(path)
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
fn apply_common_args(
    command: &mut Command,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) {
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

    // Prefer an explicit Netscape cookie file (from the extension — works while the browser
    // stays open). Fall back to `--cookies-from-browser` only when no file is provided.
    if let Some(path) = cookies_file {
        command.arg("--cookies").arg(path);
    } else if let Some(browser) = cookies_browser {
        let b = browser.trim().to_ascii_lowercase();
        if !b.is_empty() && b != "none" {
            command.arg("--cookies-from-browser").arg(b);
        }
    }
}

/// Site-specific yt-dlp flags. TikTok currently rejects default Chrome 14x UA / impersonation
/// (see yt-dlp#17403); Chrome 139 sidesteps the challenge page.
fn apply_site_workarounds(command: &mut Command, url: &str) {
    let lower = url.to_ascii_lowercase();
    if lower.contains("tiktok.com") || lower.contains("tiktokv.com") {
        // Chrome 140–149 UA is blocked by TikTok; 139 works (yt-dlp#17403).
        command.arg("--user-agent").arg(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36",
        );
    }
}

/// Writes a Netscape cookie jar under the system temp dir. Caller should delete when done.
pub fn write_cookies_file(netscape: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("limbo-cookies-{}.txt", uuid::Uuid::new_v4()));
    std::fs::write(&path, netscape).map_err(|e| format!("failed to write cookies file: {e}"))?;
    Ok(path)
}

/// Public alias used when surfacing download stderr to the UI.
pub fn humanize_ytdlp_error(err: &str) -> String {
    crate::user_errors::humanize_ytdlp_error(err, resolve_node_path().is_some())
}

pub use crate::user_errors::{is_recoverable_cookie_error, is_youtube_decrypt_error};

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

pub struct VideoMeta {
    pub title: String,
    pub id: String,
    pub extractor: String,
}

pub fn fetch_meta(
    url: &str,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Result<VideoMeta, String> {
    fetch_meta_resilient(url, cookies_browser, cookies_file).map(|(meta, _)| meta)
}

fn fetch_meta_with_args(
    url: &str,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
    extra_args: &[&str],
) -> Result<VideoMeta, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;

    let mut command = Command::new(&ytdlp);
    apply_common_args(&mut command, cookies_browser, cookies_file);
    apply_site_workarounds(&mut command, url);
    for arg in extra_args {
        command.arg(arg);
    }
    command.args([
        "--skip-download",
        "--print",
        "%(title)s",
        "--print",
        "%(id)s",
        "--print",
        "%(extractor)s",
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
    let extractor = lines.next().unwrap_or("").trim().to_string();

    if id.is_empty() {
        return Err("yt-dlp did not return a video id".to_string());
    }

    Ok(VideoMeta {
        title: if title.is_empty() {
            "Untitled".to_string()
        } else {
            title
        },
        id,
        extractor,
    })
}

/// Fetch meta with automatic fallbacks: drop locked browser cookies, then alternate YT client.
pub fn fetch_meta_resilient(
    url: &str,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Result<(VideoMeta, MetaStrategy), String> {
    match fetch_meta_with_args(url, cookies_browser, cookies_file, &[]) {
        Ok(meta) => Ok((
            meta,
            MetaStrategy {
                cookies_browser: cookies_browser.map(str::to_string),
                extra_args: Vec::new(),
            },
        )),
        Err(err)
            if cookies_file.is_none()
                && cookies_browser.is_some()
                && is_recoverable_cookie_error(&err) =>
        {
            eprintln!("ytdlp: cookie lock — retry without browser cookies");
            match fetch_meta_with_args(url, None, None, &[]) {
                Ok(meta) => Ok((
                    meta,
                    MetaStrategy {
                        cookies_browser: None,
                        extra_args: Vec::new(),
                    },
                )),
                Err(err2) if is_youtube_decrypt_error(&err2) => {
                    try_android_player_client(url, None, None)
                }
                Err(err2) => Err(err2),
            }
        }
        Err(err) if is_youtube_decrypt_error(&err) => {
            eprintln!("ytdlp: decrypt failure — retry with android/tv client");
            match try_android_player_client(url, cookies_browser, cookies_file) {
                Ok(ok) => Ok(ok),
                Err(err2)
                    if cookies_file.is_none()
                        && cookies_browser.is_some()
                        && is_recoverable_cookie_error(&err2) =>
                {
                    try_android_player_client(url, None, None)
                }
                Err(err2) => Err(err2),
            }
        }
        Err(err) => Err(err),
    }
}

fn try_android_player_client(
    url: &str,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Result<(VideoMeta, MetaStrategy), String> {
    let extras = ["--extractor-args", "youtube:player_client=android,tv"];
    let meta = fetch_meta_with_args(url, cookies_browser, cookies_file, &extras)?;
    Ok((
        meta,
        MetaStrategy {
            cookies_browser: cookies_browser.map(str::to_string),
            extra_args: extras.iter().map(|s| (*s).to_string()).collect(),
        },
    ))
}

#[derive(Debug, Clone)]
pub struct MetaStrategy {
    pub cookies_browser: Option<String>,
    pub extra_args: Vec<String>,
}

fn decode_utf8(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).into_owned()
}

fn format_ytdlp_failure(output: &std::process::Output) -> String {
    let stderr = decode_utf8(&output.stderr);
    let trimmed = stderr.trim();
    let concise = trimmed
        .lines()
        .rev()
        .find(|l| l.contains("ERROR:") || l.contains("Errno"))
        .or_else(|| trimmed.lines().rev().find(|l| l.contains("WARNING:")))
        .unwrap_or(trimmed);
    let clipped: String = concise.chars().take(280).collect();
    let raw = format!("yt-dlp exited with {}: {clipped}", output.status);
    eprintln!("[LiMBo] yt-dlp failure (raw): {raw}");
    humanize_ytdlp_error(&raw)
}

fn seconds_to_section(sec: f64) -> String {
    let ms_total = (sec.max(0.0) * 1000.0).round() as u64;
    let hours = ms_total / 3_600_000;
    let minutes = (ms_total % 3_600_000) / 60_000;
    let seconds = (ms_total % 60_000) / 1000;
    let millis = ms_total % 1000;
    format!("{hours:02}:{minutes:02}:{seconds:02}.{millis:03}")
}

pub fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    let marker = "Duration: ";
    let idx = stderr.find(marker)?;
    let rest = &stderr[idx + marker.len()..];
    let time_str = rest.split(',').next()?.trim();
    let parts: Vec<&str> = time_str.split(':').collect();
    if parts.len() != 3 {
        return None;
    }
    let hours: f64 = parts[0].trim().parse().ok()?;
    let minutes: f64 = parts[1].trim().parse().ok()?;
    let seconds: f64 = parts[2].trim().parse().ok()?;
    Some(hours * 3600.0 + minutes * 60.0 + seconds)
}

pub fn probe_duration(file_path: &Path) -> Result<f64, String> {
    let ffmpeg = resolve_binary_path("ffmpeg.exe")?;
    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-i").arg(file_path);
    hide_window(&mut cmd);
    let output = cmd.output().map_err(|e| format!("failed to probe duration with ffmpeg: {e}"))?;
    let stderr = decode_utf8(&output.stderr);
    parse_ffmpeg_duration(&stderr)
        .ok_or_else(|| "could not determine media duration from ffmpeg".to_string())
}

pub fn compress_to_target_size(
    input_path: &Path,
    target_bytes: u64,
    known_duration: Option<f64>,
) -> Result<PathBuf, String> {
    let ffmpeg = resolve_binary_path("ffmpeg.exe")?;
    let duration = match known_duration.filter(|d| *d > 0.0) {
        Some(d) => d,
        None => probe_duration(input_path)?,
    };

    if duration <= 0.0 {
        return Err("invalid duration for target compression".to_string());
    }

    let target_bits = target_bytes as f64 * 8.0;
    let total_bitrate_bps = target_bits / duration;

    let audio_bitrate_bps = if total_bitrate_bps < 300_000.0 {
        64_000.0
    } else if total_bitrate_bps < 800_000.0 {
        96_000.0
    } else {
        128_000.0
    };

    let video_bitrate_bps = (total_bitrate_bps - audio_bitrate_bps).max(50_000.0);
    let v_bitrate_k = (video_bitrate_bps / 1000.0).round() as u64;
    let a_bitrate_k = (audio_bitrate_bps / 1000.0).round() as u64;

    let temp_output = input_path.with_extension("compressed_20mb.temp.mp4");

    let mut cmd = Command::new(&ffmpeg);
    cmd.arg("-y")
        .arg("-i")
        .arg(input_path)
        .arg("-c:v")
        .arg("libx264")
        .arg("-b:v")
        .arg(format!("{v_bitrate_k}k"))
        .arg("-maxrate")
        .arg(format!("{}k", (v_bitrate_k as f64 * 1.3).round() as u64))
        .arg("-bufsize")
        .arg(format!("{}k", v_bitrate_k * 2))
        .arg("-preset")
        .arg("fast")
        .arg("-c:a")
        .arg("aac")
        .arg("-b:a")
        .arg(format!("{a_bitrate_k}k"))
        .arg("-movflags")
        .arg("+faststart");

    if v_bitrate_k < 800 {
        cmd.arg("-vf").arg("scale='min(1280,iw)':-2");
    }

    cmd.arg(&temp_output);
    hide_window(&mut cmd);

    let output = cmd.output().map_err(|e| format!("failed to run ffmpeg compression: {e}"))?;
    if !output.status.success() {
        let _ = std::fs::remove_file(&temp_output);
        let stderr = decode_utf8(&output.stderr);
        return Err(format!("ffmpeg compression failed: {stderr}"));
    }

    let final_path = input_path.with_extension("mp4");
    if final_path != input_path && input_path.exists() {
        let _ = std::fs::remove_file(input_path);
    }
    if let Err(_) = std::fs::rename(&temp_output, &final_path) {
        let _ = std::fs::copy(&temp_output, &final_path);
        let _ = std::fs::remove_file(&temp_output);
    }

    Ok(final_path)
}

pub struct DownloadRequest<'a> {
    pub url: &'a str,
    pub format_id: &'a str,
    pub output_template: &'a str,
    pub trim: Option<(f64, f64)>,
    pub cookies_browser: Option<&'a str>,
    pub cookies_file: Option<&'a Path>,
    /// Extra CLI args (e.g. YouTube player_client fallback).
    pub extra_args: &'a [&'a str],
}

pub fn download(req: DownloadRequest) -> Result<Child, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;
    let ffmpeg = resolve_binary_path("ffmpeg.exe")?;
    let ffmpeg_dir = ffmpeg
        .parent()
        .ok_or_else(|| "could not resolve ffmpeg.exe's parent directory".to_string())?;

    let mut command = Command::new(&ytdlp);
    apply_common_args(&mut command, req.cookies_browser, req.cookies_file);
    apply_site_workarounds(&mut command, req.url);
    for arg in req.extra_args {
        command.arg(arg);
    }
    let (_mode, bare_format) = crate::paths::decode_format_id(req.format_id);
    let format_arg = if bare_format == "target_20mb" {
        "bv*[filesize_approx<=18M]+ba[filesize_approx<=2M]/b[filesize_approx<=20M]/bv*[height<=720]+ba/b[height<=720]/bv*+ba/b"
    } else {
        bare_format
    };
    command
        .arg("-f")
        .arg(format_arg)
        .arg("-o")
        .arg(req.output_template)
        .arg("--newline")
        .arg("--ffmpeg-location")
        .arg(ffmpeg_dir);

    if let Some((start, end)) = req.trim {
        // Re-encode at cut points so A/V stay in sync (avoids muted start with copy-cut).
        command.arg("--force-keyframes-at-cuts");
        command.arg("--download-sections").arg(format!(
            "*{}-{}",
            seconds_to_section(start),
            seconds_to_section(end)
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

pub fn list_formats(
    url: &str,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
) -> Result<FormatsPayload, String> {
    match list_formats_once(url, cookies_browser, cookies_file, &[]) {
        Ok(payload) => Ok(payload),
        Err(err)
            if cookies_file.is_none()
                && cookies_browser.is_some()
                && is_recoverable_cookie_error(&err) =>
        {
            eprintln!("ytdlp: cookie lock on formats.list — retry without browser cookies");
            list_formats_once(url, None, None, &[])
        }
        Err(err) if is_youtube_decrypt_error(&err) => {
            eprintln!("ytdlp: decrypt on formats.list — retry android/tv client");
            let extras = ["--extractor-args", "youtube:player_client=android,tv"];
            match list_formats_once(url, cookies_browser, cookies_file, &extras) {
                Ok(payload) => Ok(payload),
                Err(_) if cookies_file.is_none() && cookies_browser.is_some() => {
                    list_formats_once(url, None, None, &extras)
                }
                Err(err2) => Err(err2),
            }
        }
        Err(err) => Err(err),
    }
}

fn list_formats_once(
    url: &str,
    cookies_browser: Option<&str>,
    cookies_file: Option<&Path>,
    extra_args: &[&str],
) -> Result<FormatsPayload, String> {
    let ytdlp = resolve_binary_path("yt-dlp.exe")?;

    let mut command = Command::new(&ytdlp);
    apply_common_args(&mut command, cookies_browser, cookies_file);
    apply_site_workarounds(&mut command, url);
    for arg in extra_args {
        command.arg(arg);
    }
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
                    format_id: crate::paths::encode_format_id(
                        &format!("{}+{}", v.format_id, audio.format_id),
                        true,
                        true,
                    ),
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
                format_id: crate::paths::encode_format_id(&format_id, true, true),
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
            format_id: crate::paths::encode_format_id("bv*+ba/b", true, true),
            label: "Meilleure qualité avec son".to_string(),
            ext: "mp4".to_string(),
            height: None,
            has_audio: true,
            has_video: true,
        });
    }

    with_sound.push(VideoFormat {
        format_id: crate::paths::encode_format_id("target_20mb", true, true),
        label: "≤ 20 Mo mp4".to_string(),
        ext: "mp4".to_string(),
        height: None,
        has_audio: true,
        has_video: true,
    });

    let mut out = with_sound;

    if let Some(audio) = best_audio {
        out.push(to_video_format(audio, true));
    } else {
        out.push(VideoFormat {
            format_id: crate::paths::encode_format_id("ba/b", false, true),
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
        format_id: crate::paths::encode_format_id(&f.format_id, f.has_video, f.has_audio),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dpapi_is_cookie_error_not_youtube() {
        let err = "ERROR: Failed to decrypt with DPAPI. See https://github.com/yt-dlp/yt-dlp/issues/10927";
        assert!(is_recoverable_cookie_error(err));
        assert!(!is_youtube_decrypt_error(err));
        let msg = humanize_ytdlp_error(err);
        assert!(msg.to_ascii_lowercase().contains("cookie"));
        assert!(!msg.contains("YouTube bloque"));
        assert!(!msg.contains("DPAPI"));
    }

    #[test]
    fn nsig_is_youtube_not_cookie() {
        let err = "ERROR: nsig extraction failed: Some error";
        assert!(!is_recoverable_cookie_error(err));
        assert!(is_youtube_decrypt_error(err));
    }

    #[test]
    fn parse_ffmpeg_duration_works() {
        let stderr = "Input #0, mov,mp4...\n  Duration: 00:02:15.30, start: 0.000000, bitrate: 1240 kb/s\n";
        let d = parse_ffmpeg_duration(stderr).unwrap();
        assert!((d - 135.30).abs() < 0.001);
    }
}
