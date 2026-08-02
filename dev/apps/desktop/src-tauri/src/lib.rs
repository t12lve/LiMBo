mod config;

use std::path::Path;
use std::sync::Mutex;

use config::{AppConfig, ConfigState};
use tauri::{Manager, State};

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let config = config::load_or_init().expect("failed to load or init app config");
            app.manage(ConfigState(Mutex::new(config)));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            get_app_config,
            ensure_token,
            set_output_dir
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
