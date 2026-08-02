mod config;
mod job_runner;
mod progress_parse;
mod protocol;
mod ws_server;
mod ytdlp;

use std::path::Path;
use std::sync::{Arc, Mutex};

use config::{AppConfig, ConfigState};
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_config,
            ensure_token,
            set_output_dir,
            get_jobs_snapshot,
            cancel_job
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
