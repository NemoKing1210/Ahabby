//! The main window's life cycle: showing it, hiding it, and what its close button does.

use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

use crate::state::AppState;

use super::tray::TRAY_ID;

/// The label of Ahabby's one window (`tauri.conf.json`).
pub const MAIN: &str = "main";

/// The window itself, when it is still open.
pub fn main<R: Runtime>(app: &AppHandle<R>) -> Option<WebviewWindow<R>> {
    app.get_webview_window(MAIN)
}

/// Bring the window in front of the user: restore it, show it and focus it.
///
/// Every tray entry that opens a screen goes through this, so the window is never left minimized
/// or behind another one — and a window that was hidden in the tray comes back exactly where it
/// was, because hiding a window does not touch the webview inside it.
pub fn show<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main(app) else {
        return;
    };
    let _ = window.unminimize();
    let _ = window.show();
    let _ = window.set_focus();
}

/// Put the window away without closing it.
pub fn hide<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = main(app) {
        let _ = window.hide();
    }
}

/// What a click on the tray icon does: put the window away when it is already the window the user
/// is looking at, and bring it back in every other case — hidden, minimized, or simply behind
/// another application.
pub fn toggle<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main(app) else {
        return;
    };
    let in_front = !window.is_minimized().unwrap_or(false)
        && window.is_visible().unwrap_or(false)
        && window.is_focused().unwrap_or(false);
    if in_front {
        let _ = window.hide();
    } else {
        show(app);
    }
}

/// What the window's close button does: hide Ahabby in the tray, or close it for real.
///
/// Returns `true` when the close was turned into a hide, which is the caller's cue to cancel it
/// (`api.prevent_close()`). The setting alone is not enough: without a tray icon on screen a
/// hidden window has no way back, so the icon is checked as well — whatever a hand-edited file
/// may say, Ahabby never disappears into a process with no surface.
pub fn close_to_tray<R: Runtime>(app: &AppHandle<R>) -> bool {
    let keeps_running = app.state::<AppState>().settings().keeps_running_in_tray();
    if !keeps_running || app.tray_by_id(TRAY_ID).is_none() {
        return false;
    }
    hide(app);
    true
}
