//! Handles the `limbo://` deep link protocol (see `PROTOCOL_URL` in `@limbo/shared`).
//!
//! `limbo://open` exists so the browser extension (or anything else) can bring the desktop app
//! to the foreground when it can't reach the local WebSocket server — typically because the app
//! is closed or minimized. On Windows/Linux the OS delivers the link as a CLI argument to a new
//! process; [`crate::lib::run`] wires the `single-instance` plugin's `deep-link` feature so that
//! new process immediately quits and forwards the URL to the already-running one instead.
//!
//! No payload beyond the scheme itself is defined yet — every recognized `limbo://` URL just
//! focuses the main window. Parsing an actual path/query (e.g. to deep-link into a specific job)
//! is out of scope for this task.

use tauri::{AppHandle, Manager};

const MAIN_WINDOW_LABEL: &str = "main";

/// Brings the main window to the foreground, restoring it if minimized.
/// Called on cold start (once the window exists) and whenever a `limbo://` URL is received,
/// whether via the OS `on_open_url` event (macOS) or a forwarded second-instance `argv` (Windows/Linux).
pub fn focus_main_window(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Handles a batch of incoming deep link URLs. Logs unrecognized ones instead of silently
/// dropping them, but any `limbo://` URL — recognized or not — still focuses the window.
pub fn handle_urls(app: &AppHandle, urls: &[String]) {
    for raw in urls {
        match raw.as_str() {
            "limbo://open" | "limbo://open/" => {}
            other => eprintln!("protocol: received unrecognized deep link: {other}"),
        }
    }
    if !urls.is_empty() {
        focus_main_window(app);
    }
}
