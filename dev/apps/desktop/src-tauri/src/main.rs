// Prevents console window on Windows (in both debug and release builds)
#![windows_subsystem = "windows"]

#[cfg(windows)]
extern "system" {
    fn FreeConsole() -> i32;
}

fn main() {
    #[cfg(windows)]
    unsafe {
        FreeConsole();
    }
    #[cfg(windows)]
    {
        const ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,AudioServiceSandbox,WASAPIRawAudioCapture --disable-gpu --disable-gpu-compositing --disable-audio-output --mute-audio";
        let existing = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").unwrap_or_default();
        if existing.is_empty() {
            std::env::set_var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", ARGS);
        } else if !existing.contains("--disable-gpu") {
            std::env::set_var(
                "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
                format!("{existing} {ARGS}"),
            );
        }
    }

    limbo_desktop_lib::run()
}
