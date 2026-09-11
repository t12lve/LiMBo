mod browser_detect;
mod config;
mod job_runner;
mod paths;
mod power;
mod progress_parse;
mod protocol;
mod startup;
mod user_errors;
mod validate;
mod ws_server;
mod ytdlp;

use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use config::{AppConfig, ConfigState, PostQueueAction};
use job_runner::JobRunner;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Manager, State, WindowEvent};
use tauri_plugin_deep_link::DeepLinkExt;

/// When false, window close (✕ / Alt+F4 / taskbar Close) hides to the tray instead of exiting.
static ALLOW_EXIT: AtomicBool = AtomicBool::new(false);

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn get_app_config(state: State<ConfigState>) -> AppConfig {
    state.0.lock().unwrap().clone()
}

/// Browser id yt-dlp would use right now for `cookies_browser: auto` (or null if none found).
#[tauri::command]
fn detect_cookies_browser() -> Option<String> {
    browser_detect::detect_preferred_browser()
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
        return Err("Choisis un dossier de téléchargement.".to_string());
    }

    std::fs::create_dir_all(Path::new(trimmed)).map_err(|e| {
        format!("Impossible de créer le dossier de téléchargement : {e}")
    })?;

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
            "auto" | "vivaldi" | "chrome" | "edge" | "brave" | "firefox" | "opera" | "chromium"
            | "none" => b,
            _ => "auto".to_string(),
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

#[derive(Debug, Clone, serde::Serialize)]
pub struct ExtensionPaths {
    pub chromium_dir: String,
    pub firefox_dir: String,
    pub firefox_xpi: String,
    pub premiere_dir: String,
    pub guide_path: String,
}

fn resolve_extension_paths() -> ExtensionPaths {
    let mut chromium_dir = None;
    let mut firefox_dir = None;
    let mut firefox_xpi = None;
    let mut premiere_dir = None;
    let mut guide_path = None;

    if let Some(exe_dir) = std::env::current_exe().ok().and_then(|p| p.parent().map(std::path::PathBuf::from)) {
        let inst_cr = exe_dir.join("extension").join("chromium");
        let inst_ff = exe_dir.join("extension").join("firefox");
        let inst_pr = exe_dir.join("extension").join("premiere");
        let inst_guide = exe_dir.join("extension").join("install-instructions.html");
        if inst_cr.is_dir() {
            chromium_dir = Some(inst_cr.to_string_lossy().to_string());
        }
        if inst_ff.is_dir() {
            let xpi = inst_ff.join("LiMBo-firefox.xpi");
            if xpi.is_file() {
                firefox_xpi = Some(xpi.to_string_lossy().to_string());
            }
            firefox_dir = Some(inst_ff.to_string_lossy().to_string());
        }
        if inst_pr.is_dir() {
            premiere_dir = Some(inst_pr.to_string_lossy().to_string());
        }
        if inst_guide.is_file() {
            guide_path = Some(inst_guide.to_string_lossy().to_string());
        }
    }

    if let Some(appdata) = std::env::var_os("APPDATA") {
        let cep_dir = std::path::PathBuf::from(appdata)
            .join("Adobe")
            .join("CEP")
            .join("extensions")
            .join("LiMBO-premiere");
        if cep_dir.is_dir() {
            premiere_dir = Some(cep_dir.to_string_lossy().to_string());
        }
    }

    let repo_root = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..");
    let repo_cr = repo_root.join("prod").join("extension");
    let repo_ff = repo_root.join("prod").join("firefox");
    let repo_pr = repo_root.join("prod").join("premiere");
    let repo_guide = repo_cr.join("install-instructions.html");

    if chromium_dir.is_none() && repo_cr.is_dir() {
        chromium_dir = Some(repo_cr.to_string_lossy().to_string());
    }
    if firefox_dir.is_none() && repo_ff.is_dir() {
        let xpi = repo_ff.join("LiMBo-firefox.xpi");
        if xpi.is_file() {
            firefox_xpi = Some(xpi.to_string_lossy().to_string());
        }
        firefox_dir = Some(repo_ff.to_string_lossy().to_string());
    }
    if premiere_dir.is_none() && repo_pr.is_dir() {
        premiere_dir = Some(repo_pr.to_string_lossy().to_string());
    }
    if guide_path.is_none() && repo_guide.is_file() {
        guide_path = Some(repo_guide.to_string_lossy().to_string());
    }

    ExtensionPaths {
        chromium_dir: chromium_dir.unwrap_or_default(),
        firefox_dir: firefox_dir.unwrap_or_default(),
        firefox_xpi: firefox_xpi.unwrap_or_default(),
        premiere_dir: premiere_dir.unwrap_or_default(),
        guide_path: guide_path.unwrap_or_default(),
    }
}

#[tauri::command]
fn get_extension_paths() -> ExtensionPaths {
    resolve_extension_paths()
}

#[tauri::command]
fn open_extension_dir(browser: String) -> Result<(), String> {
    let paths = resolve_extension_paths();
    let target = match browser.to_ascii_lowercase().as_str() {
        "firefox" => paths.firefox_dir,
        "premiere" => paths.premiere_dir,
        _ => paths.chromium_dir,
    };
    if target.is_empty() || !std::path::Path::new(&target).exists() {
        return Err("Dossier d'extension introuvable. Veuillez exécuter le build de l'extension.".to_string());
    }
    #[cfg(windows)]
    {
        let _ = std::process::Command::new("explorer.exe")
            .arg(&target)
            .spawn();
    }
    Ok(())
}

#[tauri::command]
fn open_extension_guide() -> Result<(), String> {
    let paths = resolve_extension_paths();
    if !paths.guide_path.is_empty() && std::path::Path::new(&paths.guide_path).exists() {
        #[cfg(windows)]
        {
            let _ = std::process::Command::new("cmd")
                .args(["/c", "start", "", &paths.guide_path])
                .spawn();
        }
        return Ok(());
    }
    Err("Guide d'installation introuvable.".to_string())
}

#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    ALLOW_EXIT.store(true, Ordering::SeqCst);
    app.exit(0);
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
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if !ALLOW_EXIT.load(Ordering::SeqCst) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
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
            if config.launch_at_startup {
                if let Err(err) = startup::set_launch_at_startup(true) {
                    eprintln!("failed to sync launch_at_startup: {err}");
                }
            }
            let token = config.token.clone();
            let config_state = Arc::new(Mutex::new(config));
            app.manage(ConfigState(config_state.clone()));
            let runner = ws_server::spawn(token, config_state, app.handle().clone());
            app.manage(runner);

            let show_item = MenuItem::with_id(app, "show", "Afficher LiMBo", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_item, &quit_item])?;
            let tray_icon = app
                .default_window_icon()
                .cloned()
                .ok_or_else(|| "missing default window icon for tray".to_string())?;

            TrayIconBuilder::new()
                .icon(tray_icon)
                .menu(&tray_menu)
                .tooltip("LiMBo")
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => protocol::focus_main_window(app),
                    "quit" => {
                        ALLOW_EXIT.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        protocol::focus_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

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
            detect_cookies_browser,
            ensure_token,
            set_output_dir,
            get_jobs_snapshot,
            cancel_job,
            enqueue_urls,
            update_prefs,
            quit_app,
            get_extension_paths,
            open_extension_dir,
            open_extension_guide
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
