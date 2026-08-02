//! Local WebSocket server exposed to the browser extension.
//!
//! Protocol (mirrors `@limbo/shared`'s `WsClientMessage`/`WsServerMessage`):
//! 1. Client sends `{ "type": "hello" }`.
//! 2. Server replies `{ "type": "hello.ok", "token": "..." }`.
//! 3. Client sends `{ "type": "auth", "token": "..." }`.
//! 4. On match, server replies `{ "type": "auth.ok" }` then `{ "type": "jobs.snapshot", "jobs": [] }`
//!    (stub until the job runner lands); otherwise `{ "type": "auth.fail", "error": "..." }` and the
//!    connection is closed.
//! 5. Once authenticated, `{ "type": "formats.list", "url": "..." }` runs `yt-dlp -J` (via
//!    [`crate::ytdlp`]) and replies `formats.result` / `formats.error`. `download.create` /
//!    `job.cancel` are parsed-but-ignored until Task 7's job runner lands.
//!
//! Bound strictly to `127.0.0.1` — never `0.0.0.0` — so the server is unreachable off-box.

use std::net::SocketAddr;

use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::broadcast;
use tokio_tungstenite::tungstenite::Message;

const BIND_ADDR: &str = "127.0.0.1:4567";

/// Broadcast sender for job lifecycle events (`job.created`/`job.progress`/`job.done`/`job.error`).
/// Held by Tauri-managed state so future tasks (job runner) can publish to every authenticated client.
pub type JobEventSender = broadcast::Sender<String>;

/// Spawns the WebSocket server on the current tokio runtime and returns the broadcast sender
/// used to publish job events to all authenticated clients. Intended to be called once from
/// the Tauri `setup` hook, inside a tokio runtime (e.g. `tauri::async_runtime::spawn`).
pub fn spawn(token: String) -> JobEventSender {
    let (job_tx, _keep_alive_rx) = broadcast::channel::<String>(64);
    let accept_tx = job_tx.clone();

    tauri::async_runtime::spawn(async move {
        if let Err(err) = listen(token, accept_tx).await {
            eprintln!("ws_server: fatal error: {err:?}");
        }
    });

    job_tx
}

async fn listen(token: String, job_tx: JobEventSender) -> anyhow::Result<()> {
    let listener = TcpListener::bind(BIND_ADDR).await?;
    println!("ws_server: listening on {BIND_ADDR}");

    loop {
        let (stream, addr) = listener.accept().await?;
        let token = token.clone();
        let job_rx = job_tx.subscribe();

        tauri::async_runtime::spawn(async move {
            if let Err(err) = handle_connection(stream, addr, token, job_rx).await {
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
    // Stub: no job runner yet (Tasks 6-7), so a freshly authenticated client always sees an empty list.
    send_json(&mut write, json!({ "type": "jobs.snapshot", "jobs": [] })).await?;

    loop {
        tokio::select! {
            incoming = read.next() => {
                match incoming {
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(Message::Text(text))) => {
                        if let Some(response) = handle_command(text.as_str()).await {
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
/// `download.create` / `job.cancel` are intentionally unhandled here (Task 7's job runner).
async fn handle_command(text: &str) -> Option<Value> {
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
