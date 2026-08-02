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

/// Derive download mode label from format selector + trim flag.
pub fn download_mode(format_id: &str, trimmed: bool) -> String {
    let f = format_id.trim().to_ascii_lowercase();
    let base = if is_audio_only(&f) {
        "son"
    } else if is_video_only(&f) {
        "sans-son"
    } else {
        "combo"
    };
    if trimmed {
        format!("{base}_trimmed")
    } else {
        base.to_string()
    }
}

fn is_audio_only(f: &str) -> bool {
    if f == "ba" || f == "ba/b" || f == "bestaudio" || f.starts_with("bestaudio") {
        return true;
    }
    let has_audio = f.contains("ba") || f.contains("audio");
    let has_video = f.contains("bv") || f.contains("video") || f.contains("wv");
    has_audio && !has_video
}

fn is_video_only(f: &str) -> bool {
    if f.contains('+') {
        return false;
    }
    let has_video = f.contains("bv") || f.starts_with("wv");
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mode_audio_only() {
        assert_eq!(download_mode("ba/b", false), "son");
        assert_eq!(download_mode("bestaudio", false), "son");
    }

    #[test]
    fn mode_trimmed_combo() {
        assert_eq!(download_mode("bv*+ba/b", true), "combo_trimmed");
    }

    #[test]
    fn mode_sans_son() {
        assert_eq!(download_mode("bv*", false), "sans-son");
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
}
