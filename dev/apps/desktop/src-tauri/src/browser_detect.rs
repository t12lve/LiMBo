//! Detect which browser to use for `yt-dlp --cookies-from-browser`.
//!
//! Picks the Chromium/Firefox profile whose cookie DB was written most recently
//! (proxy for "the browser you actually use").

use std::path::{Path, PathBuf};
use std::time::SystemTime;

const BROWSERS: &[&str] = &["vivaldi", "chrome", "edge", "brave", "firefox", "opera"];

/// Resolve a user preference (`auto` / `none` / browser name) to a yt-dlp browser id.
pub fn resolve_cookies_browser(pref: &str) -> Option<String> {
    let p = pref.trim().to_ascii_lowercase();
    match p.as_str() {
        "" | "none" => None,
        "auto" => detect_preferred_browser(),
        "vivaldi" | "chrome" | "edge" | "brave" | "firefox" | "opera" | "chromium" => Some(p),
        _ => detect_preferred_browser(),
    }
}

/// Most recently used installed browser among those yt-dlp supports, if any.
pub fn detect_preferred_browser() -> Option<String> {
    let mut best: Option<(SystemTime, &'static str)> = None;

    for &name in BROWSERS {
        let Some(mtime) = browser_cookies_mtime(name) else {
            continue;
        };
        match best {
            None => best = Some((mtime, name)),
            Some((prev, _)) if mtime > prev => best = Some((mtime, name)),
            _ => {}
        }
    }

    best.map(|(_, name)| name.to_string())
}

fn browser_cookies_mtime(name: &str) -> Option<SystemTime> {
    let roots = browser_user_data_roots(name);
    let mut best: Option<SystemTime> = None;
    for root in roots {
        if !root.is_dir() {
            continue;
        }
        if name == "firefox" {
            for m in firefox_cookies_mtimes(&root) {
                best = max_time(best, Some(m));
            }
        } else {
            best = max_time(best, chromium_cookies_mtime(&root));
        }
    }
    best
}

fn browser_user_data_roots(name: &str) -> Vec<PathBuf> {
    let local = dirs::data_local_dir();
    let roaming = dirs::config_dir();
    let mut out = Vec::new();

    match name {
        "vivaldi" => {
            if let Some(l) = &local {
                out.push(l.join(r"Vivaldi\User Data"));
            }
        }
        "chrome" => {
            if let Some(l) = &local {
                out.push(l.join(r"Google\Chrome\User Data"));
            }
        }
        "edge" => {
            if let Some(l) = &local {
                out.push(l.join(r"Microsoft\Edge\User Data"));
            }
        }
        "brave" => {
            if let Some(l) = &local {
                out.push(l.join(r"BraveSoftware\Brave-Browser\User Data"));
            }
        }
        "opera" => {
            if let Some(r) = &roaming {
                out.push(r.join(r"Opera Software\Opera Stable"));
            }
        }
        "firefox" => {
            if let Some(r) = &roaming {
                out.push(r.join(r"Mozilla\Firefox\Profiles"));
            }
        }
        _ => {}
    }

    out
}

fn chromium_cookies_mtime(user_data: &Path) -> Option<SystemTime> {
    let mut best: Option<SystemTime> = None;
    let Ok(entries) = std::fs::read_dir(user_data) else {
        return None;
    };

    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Default, Profile 1, Guest Profile, etc.
        if !(name == "Default" || name.starts_with("Profile")) {
            continue;
        }
        let profile = entry.path();
        for rel in ["Network/Cookies", "Cookies"] {
            let cookies = profile.join(rel);
            best = max_time(best, file_mtime(&cookies));
        }
    }

    best
}

fn firefox_cookies_mtimes(profiles_root: &Path) -> Vec<SystemTime> {
    let mut out = Vec::new();
    let Ok(entries) = std::fs::read_dir(profiles_root) else {
        return out;
    };
    for entry in entries.flatten() {
        let cookies = entry.path().join("cookies.sqlite");
        if let Some(t) = file_mtime(&cookies) {
            out.push(t);
        }
    }
    out
}

fn file_mtime(path: &Path) -> Option<SystemTime> {
    path.metadata().ok()?.modified().ok()
}

fn max_time(a: Option<SystemTime>, b: Option<SystemTime>) -> Option<SystemTime> {
    match (a, b) {
        (None, x) | (x, None) => x,
        (Some(a), Some(b)) => Some(a.max(b)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_none_and_known() {
        assert_eq!(resolve_cookies_browser("none"), None);
        assert_eq!(resolve_cookies_browser("Vivaldi").as_deref(), Some("vivaldi"));
        assert_eq!(resolve_cookies_browser("CHROME").as_deref(), Some("chrome"));
    }

    #[test]
    fn resolve_auto_does_not_panic() {
        let _ = resolve_cookies_browser("auto");
    }
}
