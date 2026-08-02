//! Windows startup registration (HKCU Run) and `--minimized` argv helper.

use std::path::PathBuf;

const RUN_SUBKEY: &str = r"Software\Microsoft\Windows\CurrentVersion\Run";
const VALUE_NAME: &str = "LiMBo";

/// True when the process was launched with `--minimized`.
pub fn args_request_minimized() -> bool {
    std::env::args().any(|a| a == "--minimized")
}

/// Enable or disable launching LiMBo at Windows logon (current user).
pub fn set_launch_at_startup(enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        use winreg::enums::{HKEY_CURRENT_USER, KEY_READ, KEY_SET_VALUE};
        use winreg::RegKey;

        let hkcu = RegKey::predef(HKEY_CURRENT_USER);
        let (key, _) = hkcu
            .create_subkey(RUN_SUBKEY)
            .map_err(|e| format!("failed to open Run key: {e}"))?;

        if enabled {
            let exe = std::env::current_exe().map_err(|e| format!("current_exe: {e}"))?;
            let value = format!("\"{}\" --minimized", path_as_string(&exe)?);
            key.set_value(VALUE_NAME, &value)
                .map_err(|e| format!("failed to set Run value: {e}"))?;
        } else {
            // Ignore missing value.
            let _ = key.delete_value(VALUE_NAME);
            let _ = KEY_READ;
            let _ = KEY_SET_VALUE;
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = enabled;
        Err("launch at startup is only supported on Windows".into())
    }
}

#[cfg(windows)]
fn path_as_string(path: &PathBuf) -> Result<String, String> {
    path.to_str()
        .map(str::to_string)
        .ok_or_else(|| "exe path is not valid UTF-8".into())
}
