mod config;
mod job_runner;
mod paths;
mod power;
mod progress_parse;
mod protocol;
mod startup;
mod validate;
mod ws_server;
mod ytdlp;

use std::path::Path;
use std::sync::{Arc, Mutex};

use config::{AppConfig, ConfigState, PostQueueAction};
use job_runner::JobRunner;
use tauri::{Manager, State};
use tauri_plugin_deep_link::DeepLinkExt;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_app_config(state: State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap().clone()
}

#[tauri::command]
fn ensure_token(state: State<ConfigState>) -> Result<String, String> {
    let mut config = state.0.lock().unwrap();
    if config.token.is_empty() {
        config.token = uuid::Uuid::new_v4().to_string();
        config::save(&config)?;
    }
    Ok(config.token.clone())
}

#[tauri::command]
fn set_output_dir(state: State<ConfigState>, path: String) -> Result<(), String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("output_dir path must not be empty".to_string());
    }

    std::fs::create_dir_all(Path::new(trimmed))
        .map_err(|e| format!("failed to create output directory: {e}"))?;

    let mut config = state.0.lock().unwrap();
    config.output_dir = Some(trimmed.to_string());
    config::save(&config)?;
    Ok(())
}

/// Full snapshot of every job known this session, for the UI's initial render / reconnect.
/// Live updates afterwards arrive via `job-updated` events (see [`job_runner::JOB_UPDATED_EVENT`]).
#[tauri::command]
fn get_jobs_snapshot(runner: State<Arc<JobRunner>>) -> Vec<job_runner::JobSnapshot> {
    runner.snapshot()
}

#[tauri::command]
fn cancel_job(runner: State<Arc<JobRunner>>, id: String) {
    runner.cancel(&id);
}

/// Enqueue many http(s) URLs with a shared format selector (default: best video+audio).
#[tauri::command]
fn enqueue_urls(
    runner: State<Arc<JobRunner>>,
    urls: Vec<String>,
    format_id: Option<String>,
) -> Result<usize, String> {
    let format = encode_batch_format_id(&format_id.unwrap_or_else(|| "bv*+ba/b".to_string()));
    let mut count = 0usize;
    for raw in urls {
        let url = raw.trim().to_string();
        if url.is_empty() {
            continue;
        }
        match validate::validate_download_request(&url, None) {
            Ok(()) => {
                let caps = caps_from_format_id(&format);
                runner.create_download(url, format.clone(), None, None, caps);
                count += 1;
            }
            Err(error) => {
                runner.reject_download(url, error);
            }
        }
    }
    if count == 0 {
        return Err("aucun lien http(s) valide".to_string());
    }
    Ok(count)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrefsUpdate {
    sound_on_finish: Option<bool>,
    post_queue_action: Option<String>,
    cookies_browser: Option<String>,
    default_quality: Option<String>,
    launch_at_startup: Option<bool>,
}

#[tauri::command]
fn update_prefs(state: State<ConfigState>, prefs: PrefsUpdate) -> Result<AppConfig, String> {
    let mut config = state.0.lock().unwrap();
    if let Some(v) = prefs.sound_on_finish {
        config.sound_on_finish = v;
    }
    if let Some(raw) = prefs.post_queue_action {
        config.post_queue_action = match raw.as_str() {
            "sleep" => PostQueueAction::Sleep,
            "shutdown" => PostQueueAction::Shutdown,
            "force_shutdown" => PostQueueAction::ForceShutdown,
            _ => PostQueueAction::None,
        };
    }
    if let Some(browser) = prefs.cookies_browser {
        let b = browser.trim().to_ascii_lowercase();
        config.cookies_browser = match b.as_str() {
            "edge" | "brave" | "firefox" | "none" | "chrome" => b,
            _ => "chrome".to_string(),
        };
    }
    if let Some(q) = prefs.default_quality {
        config.default_quality = match q.as_str() {
            "best_sound" => "best_sound".to_string(),
            _ => "best_image".to_string(),
        };
    }
    if let Some(v) = prefs.launch_at_startup {
        config.launch_at_startup = v;
        startup::set_launch_at_startup(v)?;
    }
    config::save(&config)?;
    Ok(config.clone())
}

fn caps_from_format_id(format_id: &str) -> Option<(bool, bool)> {
    // Prefer limbo: mode prefix, then path heuristics.
    let mode = paths::download_mode(format_id, false, None);
    match mode.as_str() {
        "son" => Some((false, true)),
        "video" => Some((true, false)),
        "combo" => Some((true, true)),
        _ => None,
    }
}

/// Encode batch selectors so filenames get the right mode suffix.
fn encode_batch_format_id(format_id: &str) -> String {
    let (hint, bare) = paths::decode_format_id(format_id);
    if hint.is_some() {
        return format_id.to_string();
    }
    match paths::download_mode(bare, false, None).as_str() {
        "son" => paths::encode_format_id(bare, false, true),
        "video" => paths::encode_format_id(bare, true, false),
        _ => paths::encode_format_id(bare, true, true),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Must be the first plugin registered. On Windows/Linux, `limbo://open` spawns a brand new
    // process with the URL as its only CLI arg; the `deep-link` feature on this plugin forwards
    // that argv straight to the already-running instance's deep-link plugin (triggering
    // `on_open_url` below) instead of us needing to parse `argv` by hand.
    #[cfg(any(windows, target_os = "linux"))]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            protocol::focus_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Dev builds aren't installed, so the OS doesn't know about the `limbo` scheme yet;
            // register it at runtime. Release builds get this for free from the bundler/installer.
            #[cfg(any(target_os = "linux", all(debug_assertions, windows)))]
            app.deep_link().register_all()?;

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                let urls: Vec<String> = event.urls().iter().map(ToString::to_string).collect();
                protocol::handle_urls(&handle, &urls);
            });

            // Cold start via `limbo://open`: the deep-link plugin parses `std::env::args()` on
            // init, before this `setup` hook runs, so the URL is already available here.
            if let Some(urls) = app.deep_link().get_current()? {
                let urls: Vec<String> = urls.iter().map(ToString::to_string).collect();
                protocol::handle_urls(app.handle(), &urls);
            }

            let config = config::load_or_init().expect("failed to load or init app config");
            let token = config.token.clone();
            let config_state = Arc::new(Mutex::new(config));
            app.manage(ConfigState(config_state.clone()));
            let runner = ws_server::spawn(token, config_state, app.handle().clone());
            app.manage(runner);

            if startup::args_request_minimized() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.minimize();
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_config,
            ensure_token,
            set_output_dir,
            get_jobs_snapshot,
            cancel_job,
            enqueue_urls,
            update_prefs
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
