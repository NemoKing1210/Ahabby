//! The login item behind `Settings::launch_at_login`.
//!
//! This is the one thing Ahabby describes that lives outside its own config directory — a `Run`
//! registry value on Windows, a LaunchAgent on macOS, an XDG autostart entry on Linux — and the
//! plugin handles all three. Like the folder picker it is used from Rust only: the webview is
//! given no permission for it, so a compromised renderer cannot register anything at login.

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, Result};

/// Make the OS match the setting: register Ahabby for the user's login, or take it back out.
///
/// Called for every settings save that changes the flag, and *before* the document is written —
/// the file has to describe the machine, so a registration the OS refused must not be persisted
/// as if it had worked. The error is the user's to see: the settings page turns it into a toast
/// and the draft stays unsaved.
pub fn apply(app: &AppHandle, enabled: bool) -> Result<()> {
    let autolaunch = app.autolaunch();
    let result = if enabled {
        autolaunch.enable()
    } else {
        autolaunch.disable()
    };
    result.map_err(|error| {
        let what = if enabled {
            "register Ahabby to start at login"
        } else {
            "remove Ahabby from the login items"
        };
        AppError::other(format!("could not {what}: {error}"))
    })
}

/// Whether the OS starts Ahabby at login right now, or `None` when it could not be asked.
///
/// `None` is deliberately not the same as `false`: a platform that cannot answer must leave the
/// setting alone rather than silently clear it.
pub fn is_enabled(app: &AppHandle) -> Option<bool> {
    app.autolaunch().is_enabled().ok()
}
