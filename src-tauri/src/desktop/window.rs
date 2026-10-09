//! The main window's life cycle — showing it, hiding it, whether the close button quits — and
//! the header the app draws itself where the OS frame is gone.

use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

use crate::domain::WindowChrome;
use crate::error::{AppError, Result};
use crate::state::{events, AppState};

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

/// Whether Ahabby draws the window's header itself instead of wearing the OS frame.
///
/// Windows only, and for the same reason the caption is painted there: DWM gives a caption that
/// cannot follow the palette — its buttons, its font and its shadow are the system's, and the
/// app has no system menu for it to open. macOS and Linux keep their own frame, which is not a
/// matter of taste: tao drops the traffic lights entirely from a window that has no decorations
/// (`NSWindowStyleMask::Borderless`), and an undecorated Linux window loses its resize borders
/// (and, with them, its shadow on the compositors that key one off the other).
pub const fn custom_chrome() -> bool {
    cfg!(windows)
}

/// Takes the OS frame off the window, before it is ever shown.
///
/// `setup` calls this while the window is still hidden, so the caption is never painted at all.
/// Dropping the decorations keeps the resizable style and the shadow tao draws for an undecorated
/// window — which is also what keeps the native resize borders, the snap behaviour of a caption
/// drag and the drop shadow in place.
#[cfg(windows)]
pub fn apply_chrome<R: Runtime>(window: &tauri::Window<R>) {
    let _ = window.set_decorations(false);
}

#[cfg(not(windows))]
pub fn apply_chrome<R: Runtime>(_window: &tauri::Window<R>) {}

/// What the frontend's own header is drawn from.
pub fn chrome<R: Runtime>(window: &WebviewWindow<R>) -> WindowChrome {
    WindowChrome {
        custom: custom_chrome(),
        maximized: window.is_maximized().unwrap_or(false),
        focused: window.is_focused().unwrap_or(false),
    }
}

/// The state the last `window://state` carried.
///
/// A resize drag emits an event per step, and every one of them would otherwise be pushed at the
/// webview for the header to re-render; only a state the header does not already have is worth
/// sending. The cache is one value for the one window Ahabby has, and it starts empty, so the
/// first report after a launch always happens.
static REPORTED: Mutex<Option<WindowChrome>> = Mutex::new(None);

/// Marks `chrome` as reported, answering whether it is news.
fn is_news(chrome: WindowChrome) -> bool {
    let mut reported = REPORTED
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if *reported == Some(chrome) {
        return false;
    }
    *reported = Some(chrome);
    true
}

/// Publishes the window's chrome when it changed.
///
/// Called from the window's own event handler for the events that can move it: a maximize, a
/// restore, a snap and a focus change all arrive as a resize or a focus event, and the header
/// cannot ask the OS about them itself.
pub fn report<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = main(app) else {
        return;
    };
    let chrome = chrome(&window);
    if is_news(chrome) {
        let _ = app.emit(events::WINDOW_STATE, chrome);
    }
}

/// Start moving the window, following the cursor — the header's drag region on a mouse down.
pub fn start_drag<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    window.start_dragging().map_err(window_error)
}

/// The header's minimize button.
pub fn minimize<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    window.minimize().map_err(window_error)
}

/// The header's middle button: maximize a windowed window, restore a maximized one.
pub fn toggle_maximize<R: Runtime>(window: &WebviewWindow<R>) -> Result<WindowChrome> {
    if window.is_maximized().unwrap_or(false) {
        window.unmaximize().map_err(window_error)?;
    } else {
        window.maximize().map_err(window_error)?;
    }
    Ok(chrome(window))
}

/// The header's close button, which is the OS's close button: the very same request that the
/// title bar would send, so `close_to_tray` decides what happens to it.
pub fn close<R: Runtime>(window: &WebviewWindow<R>) -> Result<()> {
    window.close().map_err(window_error)
}

fn window_error(error: tauri::Error) -> AppError {
    AppError::Other(format!("window: {error}"))
}

#[cfg(test)]
mod tests {
    use super::{is_news, WindowChrome};

    /// The header is told about a change once, however many window events it makes: a resize
    /// drag is a burst of them, and re-sending the same state would re-render the header for
    /// each step of the mouse.
    #[test]
    fn only_a_changed_chrome_is_news() {
        let windowed = WindowChrome {
            custom: true,
            maximized: false,
            focused: true,
        };
        let maximized = WindowChrome {
            maximized: true,
            ..windowed
        };
        let inactive = WindowChrome {
            focused: false,
            ..windowed
        };

        assert!(is_news(windowed));
        assert!(!is_news(windowed));
        assert!(is_news(maximized));
        assert!(is_news(inactive));
        assert!(!is_news(inactive));
    }
}
