//! Server-side validation for `download.create`, run before a job ever touches the queue or
//! spawns yt-dlp. Mirrors `@limbo/shared`'s `extractYoutubeVideoUrl` (`youtube.ts`) for the URL
//! check and `validateTrim` (`trim.ts`) for the trim range, so a client that skips (or has a
//! buggy/malicious copy of) the shared TS validation still can't make the desktop app shell out
//! to yt-dlp with an arbitrary URL or an inverted/negative trim range.

use url::Url;

use crate::job_runner::TrimRange;

const YOUTUBE_HOSTS: &[&str] = &["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"];

/// Accepts only `youtube.com`/`youtu.be` `/watch?v=...` or `/shorts/<id>` URLs.
pub fn is_youtube_video_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else {
        return false;
    };

    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }

    let host = url.host_str().unwrap_or("");

    if host == "youtu.be" || host == "www.youtu.be" {
        return url
            .path_segments()
            .and_then(|mut segments| segments.next())
            .is_some_and(|id| !id.is_empty());
    }

    if YOUTUBE_HOSTS.contains(&host) {
        if url.path() == "/watch" {
            return url.query_pairs().any(|(key, value)| key == "v" && !value.is_empty());
        }

        let mut segments = url.path_segments().into_iter().flatten();
        return segments.next() == Some("shorts") && segments.next().is_some_and(|id| !id.is_empty());
    }

    false
}

/// `startSec >= 0` and `endSec > startSec`. The video's duration isn't known at this point (only
/// `formats.list` fetches it), so unlike the shared TS `validateTrim` there's no upper-bound check.
pub fn validate_trim_range(trim: &TrimRange) -> Result<(), String> {
    if !trim.start_sec.is_finite() || !trim.end_sec.is_finite() {
        return Err("trim: startSec/endSec must be finite numbers".to_string());
    }
    if trim.start_sec < 0.0 {
        return Err("trim: startSec must be >= 0".to_string());
    }
    if trim.end_sec <= trim.start_sec {
        return Err("trim: endSec must be after startSec".to_string());
    }
    Ok(())
}

/// Full validation for a `download.create` request; `Err` carries a human-readable reason
/// suitable for a `job.error`.
pub fn validate_download_request(url: &str, trim: Option<&TrimRange>) -> Result<(), String> {
    if !is_youtube_video_url(url) {
        return Err("url must be a youtube.com or youtu.be watch/shorts link".to_string());
    }
    if let Some(trim) = trim {
        validate_trim_range(trim)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_watch_urls() {
        assert!(is_youtube_video_url("https://www.youtube.com/watch?v=jNQXAC9IVRw"));
        assert!(is_youtube_video_url("https://youtube.com/watch?v=abc123"));
        assert!(is_youtube_video_url("http://m.youtube.com/watch?v=abc123"));
    }

    #[test]
    fn accepts_short_and_shorts_urls() {
        assert!(is_youtube_video_url("https://youtu.be/jNQXAC9IVRw"));
        assert!(is_youtube_video_url("https://www.youtube.com/shorts/abc123"));
    }

    #[test]
    fn rejects_non_youtube_and_malformed_urls() {
        assert!(!is_youtube_video_url("https://evil.example.com/watch?v=abc123"));
        assert!(!is_youtube_video_url("https://youtube.com.evil.example.com/watch?v=abc123"));
        assert!(!is_youtube_video_url("not a url"));
        assert!(!is_youtube_video_url("https://www.youtube.com/watch"));
        assert!(!is_youtube_video_url("file:///etc/passwd"));
    }

    #[test]
    fn trim_rejects_negative_start_and_non_positive_range() {
        assert!(validate_trim_range(&TrimRange { start_sec: -1.0, end_sec: 5.0 }).is_err());
        assert!(validate_trim_range(&TrimRange { start_sec: 5.0, end_sec: 5.0 }).is_err());
        assert!(validate_trim_range(&TrimRange { start_sec: 5.0, end_sec: 1.0 }).is_err());
        assert!(validate_trim_range(&TrimRange { start_sec: 0.0, end_sec: 10.0 }).is_ok());
    }
}
