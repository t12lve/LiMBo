//! Mirrors `@limbo/shared`'s `parseYtDlpProgressLine` (`packages/shared/src/progress.ts`).
//!
//! Parses a single line of `yt-dlp --newline` stdout into `(percent, speed, eta)`. Called by
//! `job_runner`'s stdout reader to turn lines into `job.progress` events.

use std::sync::LazyLock;

use regex::Regex;

static PROGRESS_RE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+.+?\s+at\s+(\S+)\s+ETA\s+(\S+)")
        .expect("progress regex is valid")
});

pub fn parse_line(line: &str) -> Option<(f64, String, String)> {
    let caps = PROGRESS_RE.captures(line)?;
    let percent: f64 = caps.get(1)?.as_str().parse().ok()?;
    let speed = caps.get(2)?.as_str().to_string();
    let eta = caps.get(3)?.as_str().to_string();
    Some((percent, speed, eta))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_a_typical_yt_dlp_progress_line() {
        let line = "[download]  45.2% of  10.00MiB at  1.25MiB/s ETA 00:04";
        assert_eq!(
            parse_line(line),
            Some((45.2, "1.25MiB/s".to_string(), "00:04".to_string()))
        );
    }

    #[test]
    fn returns_none_for_unrelated_lines() {
        assert_eq!(parse_line("[info] Downloading"), None);
    }
}
