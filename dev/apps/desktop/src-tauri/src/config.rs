use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use serde::{Deserialize, Serialize};

/// Persisted app configuration, stored as JSON at `%APPDATA%/LiMBo/config.json`
/// (or the platform equivalent via `dirs::config_dir`).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub token: String,
    pub output_dir: Option<String>,
}

/// Shared, mutex-guarded config state managed by Tauri. `Arc`-wrapped so the same instance can
/// also be handed to [`crate::job_runner::JobRunner`], which reads `output_dir` per job.
pub struct ConfigState(pub Arc<Mutex<AppConfig>>);

fn config_dir() -> Result<PathBuf, String> {
    dirs::config_dir()
        .map(|dir| dir.join("LiMBo"))
        .ok_or_else(|| "could not resolve platform config directory".to_string())
}

fn config_file_path() -> Result<PathBuf, String> {
    Ok(config_dir()?.join("config.json"))
}

/// Loads `config.json` if present, otherwise creates the config directory and
/// a fresh config (new UUID token, `output_dir: null`), persisting it to disk.
pub fn load_or_init() -> Result<AppConfig, String> {
    let dir = config_dir()?;
    let file = config_file_path()?;

    if file.exists() {
        let contents =
            fs::read_to_string(&file).map_err(|e| format!("failed to read config.json: {e}"))?;
        let config: AppConfig = serde_json::from_str(&contents)
            .map_err(|e| format!("failed to parse config.json: {e}"))?;
        return Ok(config);
    }

    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config directory: {e}"))?;

    let config = AppConfig {
        token: uuid::Uuid::new_v4().to_string(),
        output_dir: None,
    };
    save(&config)?;
    Ok(config)
}

/// Serializes and writes `config` to `config.json`, creating the parent
/// directory if needed.
pub fn save(config: &AppConfig) -> Result<(), String> {
    let dir = config_dir()?;
    fs::create_dir_all(&dir).map_err(|e| format!("failed to create config directory: {e}"))?;

    let file = config_file_path()?;
    let contents = serde_json::to_string_pretty(config)
        .map_err(|e| format!("failed to serialize config: {e}"))?;
    fs::write(&file, contents).map_err(|e| format!("failed to write config.json: {e}"))
}
