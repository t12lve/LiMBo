//! Output path helpers: per-video folders and dated mode filenames.

use std::path::{Path, PathBuf};

/// Strip characters illegal on Windows and collapse whitespace; truncate by Unicode chars.
pub fn sanitize_component(input: &str, max_chars: usize) -> String {
    let cleaned: String = input
        .chars()
        .map(|c| match c {
            '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' => ' ',
            c if c.is_control() => ' ',
            c => c,
        })
        .collect();
    let collapsed = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let trimmed = collapsed.trim();
    if trimmed.is_empty() {
        return "Untitled".to_string();
    }
    trimmed.chars().take(max_chars).collect()
}

/// Normalize yt-dlp extractor key to a display platform name.
pub fn normalize_platform(extractor: &str) -> String {
    let key = extractor.trim().to_ascii_lowercase();
    match key.as_str() {
        "instagram" => "Instagram".into(),
        "youtube" | "youtube:tab" => "Youtube".into(),
        "tiktok" => "TikTok".into(),
        "twitter" | "x" => "Twitter".into(),
        "vimeo" => "Vimeo".into(),
        "reddit" => "Reddit".into(),
        "" => "Video".into(),
        other => {
            let mut chars = other.chars();
            match chars.next() {
                Some(first) => {
                    let mut s = first.to_ascii_uppercase().to_string();
                    s.push_str(chars.as_str());
                    sanitize_component(&s, 32)
                }
                None => "Video".into(),
            }
        }
    }
}

/// Prefix curated format ids so naming stays correct even when clients omit hasAudio/hasVideo.
/// Example: `limbo:video:299` → yt-dlp gets `299`, filename mode is `video`.
const FORMAT_PREFIX: &str = "limbo:";

pub fn encode_format_id(raw_id: &str, has_video: bool, has_audio: bool) -> String {
    let mode = match (has_video, has_audio) {
        (true, true) => "combo",
        (false, true) => "son",
        (true, false) => "video",
        (false, false) => "combo",
    };
    format!("{FORMAT_PREFIX}{mode}:{raw_id}")
}

/// Returns `(mode_hint, yt_dlp_format_id)`.
pub fn decode_format_id(format_id: &str) -> (Option<&'static str>, &str) {
    let Some(rest) = format_id.strip_prefix(FORMAT_PREFIX) else {
        return (None, format_id);
    };
    let Some((mode, raw)) = rest.split_once(':') else {
        return (None, format_id);
    };
    let hint = match mode {
        "son" => Some("son"),
        "video" => Some("video"),
        "combo" => Some("combo"),
        _ => None,
    };
    if raw.is_empty() {
        return (None, format_id);
    }
    (hint, raw)
}

/// Derive download mode label from caps and/or format selector + trim flag.
/// Prefer explicit `(has_video, has_audio)` when known (curated formats use numeric ids).
pub fn download_mode(
    format_id: &str,
    trimmed: bool,
    caps: Option<(bool /* has_video */, bool /* has_audio */)>,
) -> String {
    let (prefix_mode, bare_id) = decode_format_id(format_id);

    let base = if let Some(mode) = prefix_mode {
        mode
    } else if let Some((has_video, has_audio)) = caps {
        match (has_video, has_audio) {
            (true, true) => "combo",
            (false, true) => "son",
            (true, false) => "video",
            (false, false) => infer_mode_from_format_id(bare_id),
        }
    } else {
        infer_mode_from_format_id(bare_id)
    };
    if trimmed {
        format!("{base}_trimmed")
    } else {
        base.to_string()
    }
}

fn infer_mode_from_format_id(format_id: &str) -> &'static str {
    let f = format_id.trim().to_ascii_lowercase();
    if is_audio_only(&f) {
        "son"
    } else if is_video_only(&f) {
        "video"
    } else {
        "combo"
    }
}

fn is_audio_only(f: &str) -> bool {
    if f == "ba" || f == "ba/b" || f == "bestaudio" || f.starts_with("bestaudio") {
        return true;
    }
    // Merge selectors like `bv*+ba/b` are combo, not audio-only.
    if f.contains('+') {
        return false;
    }
    let has_audio = f.contains("ba") || f.contains("audio");
    let has_video = f.contains("bv") || f.contains("video") || f.contains("wv");
    has_audio && !has_video
}

fn is_video_only(f: &str) -> bool {
    if f.contains('+') {
        return false;
    }
    let has_video = f.contains("bv") || f.starts_with("wv") || f.contains("video");
    let has_audio = f.contains("ba") || f.contains("audio");
    has_video && !has_audio
}

/// `{Platform} {title≤60} [{id}]`
pub fn job_subdir(platform: &str, title: &str, id: &str) -> String {
    let plat = sanitize_component(platform, 32);
    let title = sanitize_component(title, 60);
    let id = sanitize_component(id, 64);
    format!("{plat} {title} [{id}]")
}

/// Filename stem without extension: `{title}_{stamp}_{mode}` (+ optional short job id).
pub fn output_filename_stem(
    title: &str,
    timestamp: &str,
    mode: &str,
    job_id_short: Option<&str>,
) -> String {
    let title = sanitize_component(title, 80);
    let mode = sanitize_component(mode, 32);
    let stamp = sanitize_component(timestamp, 32);
    match job_id_short {
        Some(short) if !short.is_empty() => {
            format!("{title}_{stamp}_{mode}_{}", sanitize_component(short, 8))
        }
        _ => format!("{title}_{stamp}_{mode}"),
    }
}

/// yt-dlp `-o` template writing into `job_dir` with a fixed stem.
pub fn build_output_template(job_dir: &str, stem: &str) -> String {
    let dir = job_dir.trim_end_matches(['/', '\\']);
    let stem = sanitize_component(stem, 180);
    format!("{dir}/{stem}.%(ext)s")
}

/// Join output root + subdir.
pub fn job_dir(output_root: &Path, subdir: &str) -> PathBuf {
    output_root.join(subdir)
}

/// After yt-dlp finishes, find the media file matching `stem` (largest non-partial).
pub fn resolve_output_file(job_dir: &Path, stem: &str) -> Option<PathBuf> {
    let Ok(entries) = std::fs::read_dir(job_dir) else {
        return None;
    };
    let mut matches: Vec<(u64, PathBuf)> = entries
        .flatten()
        .map(|e| e.path())
        .filter(|p| p.is_file())
        .filter(|p| {
            let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
            name.starts_with(stem)
                && !name.ends_with(".part")
                && !name.ends_with(".ytdl")
                && !name.contains(".part-Frag")
                && !name.ends_with(".temp")
        })
        .map(|p| {
            let len = p.metadata().map(|m| m.len()).unwrap_or(0);
            (len, p)
        })
        .collect();
    matches.sort_by(|a, b| b.0.cmp(&a.0));
    matches.into_iter().next().map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_from_prefixed_format_id() {
        assert_eq!(download_mode("limbo:video:299", false, None), "video");
        assert_eq!(download_mode("limbo:son:251", false, None), "son");
        assert_eq!(download_mode("limbo:combo:137+140", false, None), "combo");
    }

    #[test]
    fn decode_strips_prefix() {
        assert_eq!(decode_format_id("limbo:video:299"), (Some("video"), "299"));
        assert_eq!(decode_format_id("ba/b"), (None, "ba/b"));
    }

    #[test]
    fn encode_roundtrip() {
        let id = encode_format_id("299", true, false);
        assert_eq!(id, "limbo:video:299");
        assert_eq!(decode_format_id(&id), (Some("video"), "299"));
    }

    #[test]
    fn mode_trimmed_combo() {
        assert_eq!(download_mode("bv*+ba/b", true, None), "combo_trimmed");
        assert_eq!(
            download_mode("137+140", true, Some((true, true))),
            "combo_trimmed"
        );
    }

    #[test]
    fn mode_video_only() {
        assert_eq!(download_mode("bv*", false, None), "video");
        assert_eq!(download_mode("299", false, Some((true, false))), "video");
    }

    #[test]
    fn subdir_shape() {
        let s = job_subdir(
            "Instagram",
            "Focus - FR FLASH | Au Cap d'Agde, un commerçant se plaint",
            "Da5KpoeBE7W",
        );
        assert!(s.starts_with("Instagram "));
        assert!(s.ends_with(" [Da5KpoeBE7W]"));
        assert!(!s.contains('|'));
        assert!(s.len() < 200);
    }

    #[test]
    fn sanitize_strips_illegal() {
        assert_eq!(sanitize_component("a:b*c?", 80), "a b c");
    }

    #[test]
    fn platform_normalize() {
        assert_eq!(normalize_platform("instagram"), "Instagram");
        assert_eq!(normalize_platform("youtube"), "Youtube");
        assert_eq!(normalize_platform(""), "Video");
    }

    #[test]
    fn template_uses_stem() {
        let t = build_output_template(r"C:\Downloads\Instagram Foo [id]", "Foo_20260802-190000_combo");
        assert!(t.ends_with(r"\Foo_20260802-190000_combo.%(ext)s") || t.contains("Foo_20260802-190000_combo.%(ext)s"));
    }

    #[test]
    fn resolve_picks_largest_matching_file() {
        let dir = std::env::temp_dir().join(format!(
            "limbo_resolve_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let stem = "clip_20260101-120000_combo";
        std::fs::write(dir.join(format!("{stem}.mp4.part")), b"tiny").unwrap();
        std::fs::write(dir.join(format!("{stem}.mp4")), b"0123456789abcdef").unwrap();
        let found = resolve_output_file(&dir, stem).unwrap();
        assert_eq!(found.file_name().unwrap(), format!("{stem}.mp4").as_str());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
