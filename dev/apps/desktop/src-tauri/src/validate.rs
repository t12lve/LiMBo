//! Server-side validation for `download.create`, run before a job ever touches the queue or
//! spawns yt-dlp. Accepts any `http`/`https` URL (yt-dlp supports hundreds of sites); trim
//! ranges must still be well-formed (`startSec >= 0`, `endSec > startSec`).

use url::Url;

use crate::job_runner::TrimRange;

/// Accepts any absolute `http`/`https` URL with a host. Site-specific extraction is left to yt-dlp.
pub fn is_downloadable_url(raw_url: &str) -> bool {
    let Ok(url) = Url::parse(raw_url) else {
        return false;
    };

    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }

    url.host_str().is_some_and(|host| !host.is_empty())
}

/// `startSec >= 0` and `endSec > startSec`. Duration upper-bound is checked in the popup only.
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

pub fn validate_download_request(url: &str, trim: Option<&TrimRange>) -> Result<(), String> {
    if !is_downloadable_url(url) {
        return Err("url must be an http(s) link".to_string());
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
    fn accepts_http_https_urls() {
        assert!(is_downloadable_url("https://www.youtube.com/watch?v=jNQXAC9IVRw"));
        assert!(is_downloadable_url("https://vimeo.com/123456"));
        assert!(is_downloadable_url("http://example.com/video.mp4"));
    }

    #[test]
    fn rejects_non_http_and_malformed_urls() {
        assert!(!is_downloadable_url("not a url"));
        assert!(!is_downloadable_url("file:///etc/passwd"));
        assert!(!is_downloadable_url("ftp://example.com/a"));
        assert!(!is_downloadable_url("https://"));
    }

    #[test]
    fn trim_rejects_negative_start_and_non_positive_range() {
        assert!(validate_trim_range(&TrimRange {
            start_sec: -1.0,
            end_sec: 5.0
        })
        .is_err());
        assert!(validate_trim_range(&TrimRange {
            start_sec: 5.0,
            end_sec: 5.0
        })
        .is_err());
        assert!(validate_trim_range(&TrimRange {
            start_sec: 5.0,
            end_sec: 1.0
        })
        .is_err());
        assert!(validate_trim_range(&TrimRange {
            start_sec: 0.0,
            end_sec: 10.0
        })
        .is_ok());
    }
}
