//! Local WebSocket server exposed to the browser extension.
//!
//! Protocol (mirrors `@limbo/shared`'s `WsClientMessage`/`WsServerMessage`):
//! 1. Client sends `{ "type": "hello" }`.
//! 2. Server replies `{ "type": "hello.ok", "token": "..." }`.
//! 3. Client sends `{ "type": "auth", "token": "..." }`.
//! 4. On match, server replies `{ "type": "auth.ok" }` then `{ "type": "jobs.snapshot", "jobs": [...] }`
//!    (from [`crate::job_runner::JobRunner`]); otherwise `{ "type": "auth.fail", "error": "..." }` and
//!    the connection is closed.
//! 5. Once authenticated:
//!    - `{ "type": "formats.list", "url": "..." }` runs `yt-dlp -J` (via [`crate::ytdlp`]) and
//!      replies `formats.result` / `formats.error`.
//!    - `{ "type": "download.create", "url", "formatId", "trim"? }` queues a job on the
//!      [`crate::job_runner::JobRunner`]; `job.created`/`job.progress`/`job.done`/`job.error` are
//!      broadcast to every authenticated client (including the requester) as the job progresses.
//!    - `{ "type": "job.cancel", "id" }` kills the job if active, or drops it from the queue.
//!
//! Bound strictly to `127.0.0.1` — never `0.0.0.0` — so the server is unreachable off-box.
//!
//! ## Origin policy
//!
//! Binding to `127.0.0.1` stops off-box attackers, but any page loaded in the user's browser
//! can still open a WebSocket to `ws://127.0.0.1:4567` (there's no same-origin restriction on
//! WebSocket connections) and, once past `hello`/`auth`, could enqueue downloads on the victim's
//! behalf ("cross-site WebSocket hijacking"). The handshake is rejected up front (HTTP 403,
//! before `hello`) unless the request's `Origin` header is one of:
//!   - absent entirely — non-browser clients (our Node smoke scripts, `curl`, ...) don't send one;
//!   - `chrome-extension://<any-id>` — the extension's own service worker/offscreen document;
//!   - `http://127.0.0.1...` / `http://localhost...` (any port) — local dev tooling / test pages;
//!   - `null` / `file://...` — Adobe CEP panels (Premiere Pro) load as file-backed HTML.
//! Anything else (in particular any `https://` origin, i.e. a real website) is rejected, since a
//! legitimate extension or local script never presents one of those.
//!
//! ## Hardening
//!
//! - At most [`MAX_CONNECTIONS`] sockets are handled at once; excess connections are dropped
//!   immediately instead of each holding a task open forever.
//! - The `hello` + `auth` handshake must complete within [`HANDSHAKE_TIMEOUT`], so an idle
//!   connection can't squat a slot indefinitely.
//! - Incoming frames/messages are capped ([`MAX_MESSAGE_SIZE`] / [`MAX_FRAME_SIZE`]) so a
//!   hostile local client cannot force large allocations.
//! - If the port can't be bound (another LiMBo instance still releasing it, or another app),
//!   [`bind_with_retry`] retries with backoff and emits [`WS_STATUS_EVENT`] so the desktop UI
//!   can warn the user instead of silently failing to accept the extension.
//!
//! ## The auth token is NOT a secret against a local attacker
//!
//! `hello.ok` deliberately returns the token to *any* client that sends `hello`, because the
//! browser extension has no other bootstrap channel and the Node smoke scripts rely on the same
//! flow. The token therefore only prevents *accidental* cross-talk between LiMBo installs — it is
//! **not** an access boundary. The real boundary is the `Origin` policy above (which blocks web
//! pages) plus the loopback-only bind. Turning the token into a true secret would require
//! out-of-band provisioning (a native-messaging host or a manual pairing code), which is out of
//! scope here — documenting the limitation is the honest alternative to over-trusting it.

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tauri::Emitter;
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::{broadcast, Semaphore};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::http::StatusCode;
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

use crate::config::AppConfig;
use crate::job_runner::JobRunner;

const BIND_ADDR: &str = "127.0.0.1:4567";

/// Emitted to the desktop frontend when the local bridge could not be started, so the UI can
/// surface a banner instead of the extension silently never connecting.
pub const WS_STATUS_EVENT: &str = "ws-status";

/// Maximum simultaneous WebSocket connections (extension + a few CEP panels / dev clients).
const MAX_CONNECTIONS: usize = 8;
/// Largest incoming WebSocket *message* we accept. Cookie jars (Netscape) are the biggest
/// legitimate payload and stay well under this. Tungstenite's default is 64 MiB.
const MAX_MESSAGE_SIZE: usize = 8 * 1024 * 1024;
/// Largest single incoming *frame*. Must be ≤ [`MAX_MESSAGE_SIZE`]. Default is 16 MiB.
const MAX_FRAME_SIZE: usize = 4 * 1024 * 1024;
/// A client must finish `hello` + `auth` within this window or it is disconnected.
const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(10);
/// Bind attempts before giving up (a previous LiMBo instance may still be releasing the port).
const BIND_MAX_ATTEMPTS: u32 = 5;
/// Linear backoff unit between bind attempts.
const BIND_RETRY_BASE_MS: u64 = 400;

/// Broadcast sender for job lifecycle events (`job.created`/`job.progress`/`job.done`/`job.error`).
/// Held by [`JobRunner`] to publish to every authenticated client.
pub type JobEventSender = broadcast::Sender<String>;

/// Spawns the WebSocket server on the current tokio runtime and returns the [`JobRunner`] used to
/// queue downloads / cancellations and to publish job events to all authenticated clients.
/// Intended to be called once from the Tauri `setup` hook, inside a tokio runtime.
pub fn spawn(
    token: String,
    config: Arc<Mutex<AppConfig>>,
    app_handle: tauri::AppHandle,
) -> Arc<JobRunner> {
    let (job_tx, _keep_alive_rx) = broadcast::channel::<String>(64);
    let runner = JobRunner::new(job_tx.clone(), config, app_handle.clone());
    let accept_tx = job_tx;
    let accept_runner = runner.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(err) = listen(token, accept_tx, accept_runner, app_handle).await {
            eprintln!("ws_server: fatal error: {err:?}");
        }
    });

    runner
}

async fn listen(
    token: String,
    job_tx: JobEventSender,
    runner: Arc<JobRunner>,
    app_handle: tauri::AppHandle,
) -> anyhow::Result<()> {
    let listener = bind_with_retry(&app_handle).await?;
    let connections = Arc::new(Semaphore::new(MAX_CONNECTIONS));

    loop {
        let (stream, addr) = listener.accept().await?;

        // `try_acquire_owned` (non-blocking): if we're saturated, drop this connection instead of
        // queuing an unbounded number of pending tasks.
        let permit = match Arc::clone(&connections).try_acquire_owned() {
            Ok(permit) => permit,
            Err(_) => {
                eprintln!(
                    "ws_server: refusing {addr} — {MAX_CONNECTIONS} connections already open"
                );
                drop(stream);
                continue;
            }
        };

        let token = token.clone();
        let job_rx = job_tx.subscribe();
        let runner = runner.clone();

        tauri::async_runtime::spawn(async move {
            // Held for the connection's lifetime; released (freeing the slot) on drop.
            let _permit = permit;
            if let Err(err) = handle_connection(stream, addr, token, job_rx, runner).await {
                eprintln!("ws_server: connection {addr} closed with error: {err:?}");
            }
        });
    }
}

/// Binds the loopback listener, retrying with linear backoff. A previous LiMBo instance that is
/// still shutting down (or another program) can keep the port busy for a moment; on definitive
/// failure we emit [`WS_STATUS_EVENT`] so the UI can tell the user the local bridge is down.
async fn bind_with_retry(app_handle: &tauri::AppHandle) -> anyhow::Result<TcpListener> {
    let mut last_err: Option<std::io::Error> = None;

    for attempt in 1..=BIND_MAX_ATTEMPTS {
        match TcpListener::bind(BIND_ADDR).await {
            Ok(listener) => {
                println!("ws_server: listening on {BIND_ADDR}");
                emit_ws_status(app_handle, true, None);
                return Ok(listener);
            }
            Err(err) => {
                eprintln!(
                    "ws_server: bind attempt {attempt}/{BIND_MAX_ATTEMPTS} on {BIND_ADDR} failed: {err}"
                );
                last_err = Some(err);
                if attempt < BIND_MAX_ATTEMPTS {
                    let delay = BIND_RETRY_BASE_MS * u64::from(attempt);
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                }
            }
        }
    }

    let message = last_err
        .map(|e| e.to_string())
        .unwrap_or_else(|| "unknown bind error".to_string());
    emit_ws_status(app_handle, false, Some(message.clone()));
    Err(anyhow::anyhow!("could not bind {BIND_ADDR}: {message}"))
}

/// Notifies the desktop UI that the local WS bridge is (un)available.
fn emit_ws_status(app_handle: &tauri::AppHandle, available: bool, error: Option<String>) {
    let _ = app_handle.emit(
        WS_STATUS_EVENT,
        json!({ "available": available, "error": error }),
    );
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    token: String,
    mut job_rx: broadcast::Receiver<String>,
    runner: Arc<JobRunner>,
) -> anyhow::Result<()> {
    let ws_config = WebSocketConfig {
        max_message_size: Some(MAX_MESSAGE_SIZE),
        max_frame_size: Some(MAX_FRAME_SIZE),
        ..Default::default()
    };
    let ws_stream =
        tokio_tungstenite::accept_hdr_async_with_config(stream, check_origin, Some(ws_config))
            .await?;
    println!("ws_server: client connected from {addr}");
    let (mut write, mut read) = ws_stream.split();

    // Bound the unauthenticated phase: a client that connects but never completes `hello`/`auth`
    // would otherwise hold a connection slot (and a task) forever.
    let handshake = async {
        let Some(hello) = next_json(&mut read).await else {
            return Ok::<bool, anyhow::Error>(false);
        };
        if msg_type(&hello) != Some("hello") {
            return Ok(false);
        }
        send_json(&mut write, json!({ "type": "hello.ok", "token": token })).await?;

        let Some(auth) = next_json(&mut read).await else {
            return Ok(false);
        };
        let provided_token = (msg_type(&auth) == Some("auth"))
            .then(|| auth.get("token").and_then(Value::as_str))
            .flatten();

        if provided_token != Some(token.as_str()) {
            send_json(
                &mut write,
                json!({ "type": "auth.fail", "error": "invalid or missing token" }),
            )
            .await?;
            return Ok(false);
        }
        Ok(true)
    };

    match tokio::time::timeout(HANDSHAKE_TIMEOUT, handshake).await {
        Ok(Ok(true)) => {}
        Ok(Ok(false)) => return Ok(()),
        Ok(Err(err)) => return Err(err),
        Err(_) => {
            eprintln!("ws_server: handshake timed out for {addr}");
            return Ok(());
        }
    }

    send_json(&mut write, json!({ "type": "auth.ok" })).await?;
    let default_quality = runner.default_quality();
    send_json(
        &mut write,
        json!({ "type": "prefs.snapshot", "defaultQuality": default_quality }),
    )
    .await?;
    send_json(
        &mut write,
        json!({ "type": "jobs.snapshot", "jobs": runner.snapshot() }),
    )
    .await?;

    loop {
        tokio::select! {
            incoming = read.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        if let Some(response) = handle_command(text.as_str(), &runner).await {
                            if send_json(&mut write, response).await.is_err() {
                                break;
                            }
                        }
                    }
                    Some(Ok(_)) => {
                        // Ping/Pong/Binary frames carry no command; ignored.
                    }
                    Some(Err(_)) => break,
                }
            }
            job_event = job_rx.recv() => {
                match job_event {
                    Ok(payload) => {
                        if write.send(Message::text(payload)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(skipped)) => {
                        // A slow client missed `skipped` job events (e.g. the MV3 service worker
                        // was suspended mid-download). A bare `continue` would leave its UI stuck
                        // on a stale phase (a `job.done` it never saw), so re-send a full snapshot.
                        eprintln!(
                            "ws_server: client lagged by {skipped} events — resyncing jobs.snapshot"
                        );
                        let snapshot =
                            json!({ "type": "jobs.snapshot", "jobs": runner.snapshot() });
                        if send_json(&mut write, snapshot).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    Ok(())
}

/// Dispatches a post-auth command frame. Returns the single response to send back, if any.
/// `download.create` / `job.cancel` reply via broadcast job events, not a direct response, so
/// they return `None` here even on success.
async fn handle_command(text: &str, runner: &JobRunner) -> Option<Value> {
    let value: Value = serde_json::from_str(text).ok()?;

    match msg_type(&value) {
        Some("formats.list") => {
            let url = value.get("url").and_then(Value::as_str)?.to_string();
            let cookies_netscape = value
                .get("cookies")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|s| !s.trim().is_empty());
            let browser = runner.cookies_browser();
            let result = tokio::task::spawn_blocking(move || {
                let cookies_file = cookies_netscape
                    .as_ref()
                    .and_then(|c| crate::ytdlp::write_cookies_file(c).ok());
                let use_browser = cookies_file.is_none();
                let out = crate::ytdlp::list_formats(
                    &url,
                    if use_browser { browser.as_deref() } else { None },
                    cookies_file.as_deref(),
                );
                if let Some(path) = cookies_file {
                    let _ = std::fs::remove_file(path);
                }
                out
            })
            .await
            .unwrap_or_else(|join_err| Err(format!("internal error: {join_err}")));

            Some(match result {
                Ok(payload) => json!({
                    "type": "formats.result",
                    "formats": payload.formats,
                    "title": payload.title,
                    "duration": payload.duration,
                    "thumbnail": payload.thumbnail,
                }),
                Err(error) => {
                    eprintln!("[LiMBo] formats.error (raw): {error}");
                    json!({
                        "type": "formats.error",
                        "error": crate::ytdlp::humanize_ytdlp_error(&error),
                    })
                },
            })
        }
        Some("download.create") => {
            let url = value.get("url").and_then(Value::as_str)?.to_string();
            let format_id = value.get("formatId").and_then(Value::as_str)?.to_string();
            let trim = match value.get("trim") {
                None | Some(Value::Null) => None,
                Some(raw) => serde_json::from_value(raw.clone()).ok()?,
            };
            let cookies = value
                .get("cookies")
                .and_then(Value::as_str)
                .map(str::to_string)
                .filter(|s| !s.trim().is_empty());
            let has_audio = value.get("hasAudio").and_then(Value::as_bool);
            let has_video = value.get("hasVideo").and_then(Value::as_bool);
            let caps = match (has_video, has_audio) {
                (Some(v), Some(a)) => Some((v, a)),
                _ => None,
            };

            // Reject before touching the queue: require http(s) + sane trim (see `crate::validate`).
            match crate::validate::validate_download_request(&url, trim.as_ref()) {
                Ok(()) => {
                    runner.create_download(url, format_id, trim, cookies, caps);
                }
                Err(error) => {
                    runner.reject_download(url, error);
                }
            }
            None
        }
        Some("job.cancel") => {
            let id = value.get("id").and_then(Value::as_str)?.to_string();
            runner.cancel(&id);
            None
        }
        _ => None,
    }
}

async fn next_json(
    read: &mut (impl StreamExt<Item = tokio_tungstenite::tungstenite::Result<Message>> + Unpin),
) -> Option<Value> {
    loop {
        match read.next().await {
            Some(Ok(Message::Text(text))) => return serde_json::from_str(text.as_str()).ok(),
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => continue,
            _ => return None,
        }
    }
}

async fn send_json(
    write: &mut (impl SinkExt<Message, Error = tokio_tungstenite::tungstenite::Error> + Unpin),
    value: Value,
) -> anyhow::Result<()> {
    write.send(Message::text(value.to_string())).await?;
    Ok(())
}

fn msg_type(value: &Value) -> Option<&str> {
    value.get("type").and_then(Value::as_str)
}

/// `accept_hdr_async` callback enforcing the module-level origin policy: rejects the WS upgrade
/// with `403 Forbidden` before any `hello`/`auth` frames are exchanged.
fn check_origin(request: &Request, response: Response) -> Result<Response, ErrorResponse> {
    let origin = request
        .headers()
        .get("origin")
        .and_then(|value| value.to_str().ok());

    if is_allowed_origin(origin) {
        return Ok(response);
    }

    eprintln!("ws_server: rejected connection with disallowed Origin: {origin:?}");
    let rejection = Response::builder()
        .status(StatusCode::FORBIDDEN)
        .body(Some("origin not allowed".to_string()))
        .expect("static response builder call cannot fail");
    Err(rejection)
}

/// See the module doc's "Origin policy" section for the rationale.
fn is_allowed_origin(origin: Option<&str>) -> bool {
    match origin {
        None => true,
        // CEP panels often send the literal string "null" (opaque origin).
        Some("null") => true,
        Some(origin) => {
            origin.starts_with("chrome-extension://")
                || origin.starts_with("moz-extension://")
                || origin.starts_with("http://127.0.0.1")
                || origin.starts_with("http://localhost")
                || origin.starts_with("file://")
        }
    }
}

#[cfg(test)]
mod tests {
    use super::is_allowed_origin;

    #[test]
    fn allows_missing_origin() {
        assert!(is_allowed_origin(None));
    }

    #[test]
    fn allows_any_chrome_extension_id() {
        assert!(is_allowed_origin(Some("chrome-extension://abcdefghijklmnop")));
    }

    #[test]
    fn allows_any_firefox_extension_id() {
        assert!(is_allowed_origin(Some("moz-extension://b822d5db-b27b-4fc6-b7f7-5bfaadce167a")));
    }

    #[test]
    fn allows_localhost_and_loopback_with_any_port() {
        assert!(is_allowed_origin(Some("http://127.0.0.1:5173")));
        assert!(is_allowed_origin(Some("http://localhost:5173")));
    }

    #[test]
    fn rejects_random_https_website_origins() {
        assert!(!is_allowed_origin(Some("https://evil.example.com")));
        assert!(!is_allowed_origin(Some("https://youtube.com")));
    }

    #[test]
    fn allows_cep_null_and_file_origins() {
        assert!(is_allowed_origin(Some("null")));
        assert!(is_allowed_origin(Some("file:///C:/extensions/panel.html")));
    }

    #[test]
    fn rejects_other_extension_schemes_and_https_loopback() {
        assert!(!is_allowed_origin(Some("safari-extension://abcdefgh")));
        assert!(!is_allowed_origin(Some("https://127.0.0.1")));
    }
}
