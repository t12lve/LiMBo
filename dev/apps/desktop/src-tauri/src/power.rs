//! Windows power actions after the download queue goes idle.

use std::os::windows::process::CommandExt;
use std::process::Command;

use crate::config::PostQueueAction;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Runs the configured post-queue action. No-op for [`PostQueueAction::None`].
pub fn run_post_queue_action(action: PostQueueAction) -> Result<(), String> {
    match action {
        PostQueueAction::None => Ok(()),
        PostQueueAction::Sleep => {
            // Hibernate/sleep via PowerRequest-less classic API.
            let mut cmd = Command::new("rundll32.exe");
            cmd.args(["powrprof.dll,SetSuspendState", "0,1,0"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
                .map_err(|e| format!("failed to request sleep: {e}"))?;
            Ok(())
        }
        PostQueueAction::Shutdown => {
            let mut cmd = Command::new("shutdown");
            cmd.args(["/s", "/t", "60", "/c", "LiMBo: arrêt dans 60s (shutdown /a pour annuler)"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
                .map_err(|e| format!("failed to schedule shutdown: {e}"))?;
            Ok(())
        }
        PostQueueAction::ForceShutdown => {
            let mut cmd = Command::new("shutdown");
            cmd.args(["/s", "/f", "/t", "0"]);
            cmd.creation_flags(CREATE_NO_WINDOW);
            cmd.spawn()
                .map_err(|e| format!("failed to force shutdown: {e}"))?;
            Ok(())
        }
    }
}
