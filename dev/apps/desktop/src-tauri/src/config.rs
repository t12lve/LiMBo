use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

fn default_true() -> bool {
    true
}

fn default_cookies_browser() -> String {
    // Prefer none: `--cookies-from-browser` fails while Chrome/Edge is open ("Could not copy").
    // Authenticated downloads should use the extension's Netscape cookie jar.
    "none".to_string()
}

fn default_quality() -> String {
    "best_image".to_string()
}

/// What to do when the download queue becomes idle (last job finished).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum PostQueueAction {
    #[default]
    None,
    Sleep,
    Shutdown,
    ForceShutdown,
}

/// Persisted app configuration, stored as JSON at `%APPDATA%/LiMBo/config.json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub token: String,
    pub output_dir: Option<String>,
    /// Play a short sound in the UI when a job finishes successfully.
    #[serde(default = "default_true")]
    pub sound_on_finish: bool,
    /// Power action after the queue drains (Windows).
    #[serde(default)]
    pub post_queue_action: PostQueueAction,
    /// Browser name for `yt-dlp --cookies-from-browser` (`chrome`/`edge`/`brave`/`none`).
    #[serde(default = "default_cookies_browser")]
    pub cookies_browser: String,
    /// Default quality preference for batch + extension preselect.
    #[serde(default = "default_quality")]
    pub default_quality: String,
    /// Launch LiMBo minimized when Windows starts (recommended: extension no longer opens limbo://).
    #[serde(default = "default_true")]
    pub launch_at_startup: bool,
}

pub struct ConfigState(pub Arc<Mutex<AppConfig>>);

fn config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|dir| dir.join("LiMBo"))
        .ok_or_else(|| "could not resolve platform config directory".to_string())
}

fn config_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

pub fn load_or_init() -> Result<AppConfig, String> {
    let dir = config_dir()?;
    let file = config_file_path()?;

    if file.exists() {
        let contents =
            fs::read_to_string(&file).map_err(|e| format!("failed to read config.json: {e}"))?;
        let config: AppConfig = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse config.json: {e}"))?;
        // Re-save so newly added fields get written with defaults.
        let _ = save(&config);
        return Ok(config);
    }

    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config directory: {e}"))?;

    let config = AppConfig {
        token: uuid::Uuid::new_v4().to_string(),
        output_dir: None,
        sound_on_finish: true,
        post_queue_action: PostQueueAction::None,
        cookies_browser: default_cookies_browser(),
        default_quality: default_quality(),
        launch_at_startup: true,
    };
    save(&config)?;
    Ok(config)
}

pub fn save(config: &AppConfig) -> Result<(), String> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config directory: {e}"))?;

    let file = config_file_path()?;
    let contents = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    fs::write(&file, contents).map_err(|e| format!("failed to write config.json: {e}"))
}
