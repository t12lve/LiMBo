//! Job queue + lifecycle for `download.create` / `job.cancel`.
//!
//! Mirrors `@limbo/shared`'s `JobSnapshot`/`JobPhase` (`packages/shared/src/types.ts`) and the
//! `job.created` / `job.progress` / `job.done` / `job.error` / `jobs.snapshot` server messages
//! (`packages/shared/src/messages.ts`) so `ws_server.rs` can serialize `JobRunner` output directly.
//!
//! One job runs at a time (`RunnerState::active_id`); additional `download.create` calls are
//! queued FIFO and picked up by `dispatch_loop` as soon as the active job finishes. Phases follow
//! `queued -> fetching_meta -> downloading -> (merging|trimming) -> done|error`. `merging`/
//! `trimming` are best-effort, inferred from yt-dlp's stdout markers (see `handle_progress_line`),
//! since yt-dlp performs both internally within the same process.

use std::collections::VecDeque;
use std::process::Child;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::config::AppConfig;
use crate::progress_parse;
use crate::ws_server::JobEventSender;
use crate::ytdlp;

/// Tauri event name emitted to the desktop frontend on every job mutation, mirroring the WS
/// `job.*` broadcasts. Payload is a single [`JobSnapshot`].
pub const JOB_UPDATED_EVENT: &str = "job-updated";
/// Emitted when the queue becomes idle after at least one job finished in this cycle.
pub const QUEUE_IDLE_EVENT: &str = "queue-idle";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum JobPhase {
    Queued,
    FetchingMeta,
    Downloading,
    Merging,
    Trimming,
    Done,
    Error,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrimRange {
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobSnapshot {
    pub id: String,
    pub url: String,
    pub title: String,
    pub phase: JobPhase,
    pub percent: f64,
    pub speed: String,
    pub eta: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

struct QueuedJob {
    id: String,
    url: String,
    format_id: String,
    trim: Option<TrimRange>,
}

struct RunnerState {
    /// Every job created this session, in creation order (queued, active, and finished).
    jobs: Vec<JobSnapshot>,
    queue: VecDeque<QueuedJob>,
    active_id: Option<String>,
    active_child: Option<Child>,
    active_cancelled: bool,
}

pub struct JobRunner {
    state: Mutex<RunnerState>,
    events: JobEventSender,
    config: Arc<Mutex<AppConfig>>,
    notify: Notify,
    app_handle: AppHandle,
}

impl JobRunner {
    /// Builds the runner and spawns its dispatcher loop on the current tokio runtime.
    /// Must be called from within a tokio runtime (e.g. Tauri's `setup` hook).
    pub fn new(
        events: JobEventSender,
        config: Arc<Mutex<AppConfig>>,
        app_handle: AppHandle,
    ) -> Arc<JobRunner> {
        let runner = Arc::new(JobRunner {
            state: Mutex::new(RunnerState {
                jobs: Vec::new(),
                queue: VecDeque::new(),
                active_id: None,
                active_child: None,
                active_cancelled: false,
            }),
            events,
            config,
            notify: Notify::new(),
            app_handle,
        });

        let dispatcher = runner.clone();
        tauri::async_runtime::spawn(async move {
            dispatcher.dispatch_loop().await;
        });

        runner
    }

    /// Browser name for yt-dlp cookies, if configured.
    pub fn cookies_browser(&self) -> Option<String> {
        let cfg = self.config.lock().unwrap();
        let b = cfg.cookies_browser.trim().to_string();
        if b.is_empty() || b.eq_ignore_ascii_case("none") {
            None
        } else {
            Some(b)
        }
    }

    /// All known jobs for a freshly (re)connected client's `jobs.snapshot`.
    pub fn snapshot(&self) -> Vec<JobSnapshot> {
        self.state.lock().unwrap().jobs.clone()
    }

    /// Queues a new download, broadcasts `job.created`, and wakes the dispatcher. Returns the
    /// generated job id.
    pub fn create_download(&self, url: String, format_id: String, trim: Option<TrimRange>) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let snapshot = JobSnapshot {
            id: id.clone(),
            url: url.clone(),
            title: String::new(),
            phase: JobPhase::Queued,
            percent: 0.0,
            speed: String::new(),
            eta: String::new(),
            error: None,
        };

        {
            let mut state = self.state.lock().unwrap();
            state.jobs.push(snapshot.clone());
            state.queue.push_back(QueuedJob {
                id: id.clone(),
                url,
                format_id,
                trim,
            });
        }

        self.broadcast(json!({ "type": "job.created", "job": snapshot }));
        self.emit_job_updated(&snapshot);
        self.notify.notify_one();
        id
    }

    /// Rejects a `download.create` request that failed server-side validation (see
    /// `crate::validate`): records a single job already in the `Error` phase — so the requester
    /// sees *why* it was refused — without ever pushing it onto `queue`/running yt-dlp. Broadcasts
    /// only `job.error` (no `job.created`), returning the synthetic job's id.
    pub fn reject_download(&self, url: String, error: String) -> String {
        let id = uuid::Uuid::new_v4().to_string();
        let snapshot = JobSnapshot {
            id: id.clone(),
            url,
            title: String::new(),
            phase: JobPhase::Error,
            percent: 0.0,
            speed: String::new(),
            eta: String::new(),
            error: Some(error),
        };

        self.state.lock().unwrap().jobs.push(snapshot.clone());
        self.broadcast(json!({ "type": "job.error", "job": snapshot }));
        self.emit_job_updated(&snapshot);
        id
    }

    /// Kills the child process if `id` is the active job (its `.part` files are cleaned up by
    /// `run_job` once the killed process exits), or removes it from the queue if still pending.
    pub fn cancel(&self, id: &str) {
        let mut state = self.state.lock().unwrap();

        if state.active_id.as_deref() == Some(id) {
            if let Some(child) = state.active_child.as_mut() {
                kill_process_tree(child);
            }
            state.active_cancelled = true;
            return;
        }

        let before = state.queue.len();
        state.queue.retain(|job| job.id != id);
        let was_queued = state.queue.len() != before;
        drop(state);

        if was_queued {
            self.finish_error(id, "cancelled".to_string());
        }
    }

    fn broadcast(&self, value: Value) {
        let _ = self.events.send(value.to_string());
    }

    /// Mirrors WS `job.*` broadcasts to the native frontend as a single `job-updated` event.
    fn emit_job_updated(&self, snapshot: &JobSnapshot) {
        let _ = self.app_handle.emit(JOB_UPDATED_EVENT, snapshot);
    }

    fn update_job<F: FnOnce(&mut JobSnapshot)>(&self, id: &str, f: F) -> Option<JobSnapshot> {
        let mut state = self.state.lock().unwrap();
        let job = state.jobs.iter_mut().find(|job| job.id == id)?;
        f(job);
        Some(job.clone())
    }

    fn finish_error(&self, id: &str, error: String) {
        if let Some(snapshot) = self.update_job(id, |job| {
            job.phase = JobPhase::Error;
            job.error = Some(error.clone());
        }) {
            self.broadcast(json!({ "type": "job.error", "job": snapshot }));
            self.emit_job_updated(&snapshot);
        }
    }

    async fn dispatch_loop(self: Arc<Self>) {
        loop {
            let next = {
                let mut state = self.state.lock().unwrap();
                if state.active_id.is_some() {
                    None
                } else {
                    state.queue.pop_front()
                }
            };

            let Some(job) = next else {
                self.notify.notified().await;
                continue;
            };

            {
                let mut state = self.state.lock().unwrap();
                state.active_id = Some(job.id.clone());
                state.active_cancelled = false;
            }

            self.clone().run_job(job).await;

            let queue_empty = {
                let mut state = self.state.lock().unwrap();
                state.active_id = None;
                state.active_child = None;
                state.queue.is_empty()
            };

            if queue_empty {
                let (action, sound) = {
                    let cfg = self.config.lock().unwrap();
                    (cfg.post_queue_action, cfg.sound_on_finish)
                };
                let _ = self.app_handle.emit(
                    QUEUE_IDLE_EVENT,
                    serde_json::json!({ "soundOnFinish": sound }),
                );
                if action != crate::config::PostQueueAction::None {
                    if let Err(err) = crate::power::run_post_queue_action(action) {
                        eprintln!("post_queue_action failed: {err}");
                    }
                }
            }
        }
    }

    async fn run_job(self: Arc<Self>, job: QueuedJob) {
        let QueuedJob {
            id,
            url,
            format_id,
            trim,
        } = job;

        self.set_phase(&id, JobPhase::FetchingMeta);

        let cookies = self.config.lock().unwrap().cookies_browser.clone();
        let cookies_opt = if cookies.eq_ignore_ascii_case("none") || cookies.trim().is_empty() {
            None
        } else {
            Some(cookies)
        };

        let meta_url = url.clone();
        let meta_cookies = cookies_opt.clone();
        let meta = tokio::task::spawn_blocking(move || {
            ytdlp::fetch_title_and_id(&meta_url, meta_cookies.as_deref())
        })
        .await
        .unwrap_or_else(|join_err| Err(format!("internal error: {join_err}")));

        let (title, video_id) = match meta {
            Ok(pair) => pair,
            Err(error) => {
                self.finish_error(&id, error);
                return;
            }
        };
        self.update_job(&id, |job| job.title = title);

        if self.is_active_cancelled() {
            if let Some(output_dir) = self.config.lock().unwrap().output_dir.clone() {
                cleanup_partial_files(&output_dir, &video_id);
            }
            self.finish_error(&id, "cancelled".to_string());
            return;
        }

        let output_dir = match self.config.lock().unwrap().output_dir.clone() {
            Some(dir) if !dir.trim().is_empty() => dir,
            _ => {
                self.finish_error(&id, "no output directory configured".to_string());
                return;
            }
        };

        if self.is_active_cancelled() {
            cleanup_partial_files(&output_dir, &video_id);
            self.finish_error(&id, "cancelled".to_string());
            return;
        }

        self.set_phase(&id, JobPhase::Downloading);

        let runner = self.clone();
        let job_id = id.clone();
        let download_url = url;
        let download_output_dir = output_dir.clone();
        let trim_secs = trim.map(|t| (t.start_sec, t.end_sec));
        let result = tokio::task::spawn_blocking(move || {
            runner.run_download_process(
                &job_id,
                &download_url,
                &format_id,
                &download_output_dir,
                trim_secs,
            )
        })
        .await
        .unwrap_or_else(|join_err| Err(format!("internal error: {join_err}")));

        let cancelled = self.state.lock().unwrap().active_cancelled;

        if cancelled {
            cleanup_partial_files(&output_dir, &video_id);
            self.finish_error(&id, "cancelled".to_string());
            return;
        }

        match result {
            Ok(()) => {
                if let Some(snapshot) = self.update_job(&id, |job| {
                    job.phase = JobPhase::Done;
                    job.percent = 100.0;
                }) {
                    self.broadcast(json!({ "type": "job.done", "job": snapshot }));
                    self.emit_job_updated(&snapshot);
                }
            }
            Err(error) => self.finish_error(&id, error),
        }
    }

    fn is_active_cancelled(&self) -> bool {
        self.state.lock().unwrap().active_cancelled
    }

    fn set_phase(&self, id: &str, phase: JobPhase) {
        if let Some(snapshot) = self.update_job(id, |job| job.phase = phase) {
            self.broadcast(job_progress_payload(&snapshot));
            self.emit_job_updated(&snapshot);
        }
    }

    /// Blocking: spawns yt-dlp, streams its stdout into `job.progress` events, drains stderr for
    /// error reporting, and waits for exit. Stores the `Child` in shared state so `cancel()` can
    /// kill it from another task.
    fn run_download_process(
        &self,
        id: &str,
        url: &str,
        format_id: &str,
        output_dir: &str,
        trim: Option<(f64, f64)>,
    ) -> Result<(), String> {
        let (stdout, stderr) = {
            // Keep cancellation and process registration atomic: if cancellation happened while
            // metadata was fetched, do not spawn yt-dlp; otherwise `cancel()` can kill the
            // registered child before this lock is released.
            let mut state = self.state.lock().unwrap();
            if state.active_cancelled {
                return Err("cancelled".to_string());
            }

            let cookies = {
                let cfg = self.config.lock().unwrap();
                let b = cfg.cookies_browser.trim().to_string();
                if b.is_empty() || b.eq_ignore_ascii_case("none") {
                    None
                } else {
                    Some(b)
                }
            };

            let mut child = ytdlp::download(ytdlp::DownloadRequest {
                url,
                format_id,
                output_dir,
                trim,
                cookies_browser: cookies.as_deref(),
            })?;
            let stdout = child.stdout.take();
            let stderr = child.stderr.take();
            state.active_child = Some(child);
            (stdout, stderr)
        };

        let stderr_buf = Arc::new(Mutex::new(String::new()));
        let stderr_thread = stderr.map(|mut stderr| {
            let buf = stderr_buf.clone();
            std::thread::spawn(move || {
                use std::io::Read;
                let mut content = String::new();
                let _ = stderr.read_to_string(&mut content);
                *buf.lock().unwrap() = content;
            })
        });

        if let Some(stdout) = stdout {
            use std::io::{BufRead, BufReader};
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                self.handle_progress_line(id, &line, trim.is_some());
            }
        }

        if let Some(handle) = stderr_thread {
            let _ = handle.join();
        }

        let wait_result = {
            let mut state = self.state.lock().unwrap();
            state.active_child.as_mut().map(|child| child.wait())
        };

        match wait_result {
            Some(Ok(status)) if status.success() => Ok(()),
            Some(Ok(status)) => {
                let stderr_text = stderr_buf.lock().unwrap().clone();
                let trimmed = stderr_text.trim();
                Err(if trimmed.is_empty() {
                    format!("yt-dlp exited with {status}")
                } else {
                    format!("yt-dlp exited with {status}: {trimmed}")
                })
            }
            Some(Err(e)) => Err(format!("failed to wait for yt-dlp: {e}")),
            None => Err("yt-dlp process handle went missing".to_string()),
        }
    }

    /// Parses one line of yt-dlp stdout: updates+broadcasts `job.progress` on a percent match,
    /// or on a best-effort `merging`/`trimming` phase marker.
    fn handle_progress_line(&self, id: &str, line: &str, has_trim: bool) {
        if let Some((percent, speed, eta)) = progress_parse::parse_line(line) {
            if let Some(snapshot) = self.update_job(id, |job| {
                job.phase = JobPhase::Downloading;
                job.percent = percent;
                job.speed = speed;
                job.eta = eta;
            }) {
                self.broadcast(job_progress_payload(&snapshot));
                self.emit_job_updated(&snapshot);
            }
            return;
        }

        if line.contains("[Merger]") {
            self.set_phase(id, JobPhase::Merging);
        } else if has_trim && (line.contains("[VideoRemuxer]") || line.contains("ffmpeg")) {
            self.set_phase(id, JobPhase::Trimming);
        }
    }
}

/// Kills `child` and, on Windows, its whole descendant tree. `Child::kill()` alone only signals
/// the direct child; yt-dlp shells out to ffmpeg/ffprobe as separate child processes that it
/// otherwise leaves running (and holding the partial output file open) after being killed.
#[cfg(windows)]
fn kill_process_tree(child: &mut Child) {
    use std::os::windows::process::CommandExt;

    // Matches `ytdlp::CREATE_NO_WINDOW`: suppresses the console window `taskkill` would
    // otherwise briefly flash since this app has no console of its own.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    let pid = child.id();
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
    // Best-effort fallback (e.g. if `taskkill` is missing from PATH) — also reaps the direct
    // child so `child.wait()` in `run_download_process` doesn't block indefinitely.
    let _ = child.kill();
}

#[cfg(not(windows))]
fn kill_process_tree(child: &mut Child) {
    let _ = child.kill();
}

fn job_progress_payload(snapshot: &JobSnapshot) -> Value {
    json!({
        "type": "job.progress",
        "id": snapshot.id,
        "percent": snapshot.percent,
        "speed": snapshot.speed,
        "eta": snapshot.eta,
        "phase": snapshot.phase,
    })
}

/// Removes leftover partial-download artifacts (`*.part`, `*.ytdl`, fragment `.part-Frag*` files)
/// for `video_id` from `output_dir` after a cancelled job. Best-effort: a missing/unreadable
/// directory or file is silently ignored.
fn cleanup_partial_files(output_dir: &str, video_id: &str) {
    if video_id.is_empty() {
        return;
    }
    let marker = format!("[{video_id}]");

    let Ok(entries) = std::fs::read_dir(output_dir) else {
        return;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if !name.contains(&marker) {
            continue;
        }
        let is_partial =
            name.ends_with(".part") || name.ends_with(".ytdl") || name.contains(".part-Frag");
        if is_partial {
            let _ = std::fs::remove_file(&path);
        }
    }
}
