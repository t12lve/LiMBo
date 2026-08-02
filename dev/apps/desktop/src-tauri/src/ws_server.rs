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

use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

use crate::config::AppConfig;
use crate::job_runner::JobRunner;

const BIND_ADDR: &str = "127.0.0.1:4567";

/// Broadcast sender for job lifecycle events (`job.created`/`job.progress`/`job.done`/`job.error`).
/// Held by [`JobRunner`] to publish to every authenticated client.
pub type JobEventSender = broadcast::Sender<String>;

/// Spawns the WebSocket server on the current tokio runtime and returns the [`JobRunner`] used to
/// queue downloads / cancellations and to publish job events to all authenticated clients.
/// Intended to be called once from the Tauri `setup` hook, inside a tokio runtime.
pub fn spawn(token: String, config: Arc<Mutex<AppConfig>>) -> Arc<JobRunner> {
    let (job_tx, _keep_alive_rx) = broadcast::channel::<String>(64);
    let runner = JobRunner::new(job_tx.clone(), config);
    let accept_tx = job_tx;
    let accept_runner = runner.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(err) = listen(token, accept_tx, accept_runner).await {
            eprintln!("ws_server: fatal error: {err:?}");
        }
    });

    runner
}

async fn listen(token: String, job_tx: JobEventSender, runner: Arc<JobRunner>) -> anyhow::Result<()> {
    let listener = TcpListener::bind(BIND_ADDR).await?;
    println!("ws_server: listening on {BIND_ADDR}");

    loop {
        let (stream, addr) = listener.accept().await?;
        let token = token.clone();
        let job_rx = job_tx.subscribe();
        let runner = runner.clone();

        tauri::async_runtime::spawn(async move {
            if let Err(err) = handle_connection(stream, addr, token, job_rx, runner).await {
                eprintln!("ws_server: connection {addr} closed with error: {err:?}");
            }
        });
    }
}

async fn handle_connection(
    stream: TcpStream,
    addr: SocketAddr,
    token: String,
    mut job_rx: broadcast::Receiver<String>,
    runner: Arc<JobRunner>,
) -> anyhow::Result<()> {
    let ws_stream = tokio_tungstenite::accept_async(stream).await?;
    println!("ws_server: client connected from {addr}");
    let (mut write, mut read) = ws_stream.split();

    let Some(hello) = next_json(&mut read).await else {
        return Ok(());
    };
    if msg_type(&hello) != Some("hello") {
        return Ok(());
    }
    send_json(&mut write, json!({ "type": "hello.ok", "token": token })).await?;

    let Some(auth) = next_json(&mut read).await else {
        return Ok(());
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
        return Ok(());
    }

    send_json(&mut write, json!({ "type": "auth.ok" })).await?;
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
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
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
            let result = tokio::task::spawn_blocking(move || crate::ytdlp::list_formats(&url))
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
                Err(error) => json!({ "type": "formats.error", "error": error }),
            })
        }
        Some("download.create") => {
            let url = value.get("url").and_then(Value::as_str)?.to_string();
            let format_id = value.get("formatId").and_then(Value::as_str)?.to_string();
            let trim = match value.get("trim") {
                None | Some(Value::Null) => None,
                Some(raw) => serde_json::from_value(raw.clone()).ok()?,
            };

            runner.create_download(url, format_id, trim);
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
