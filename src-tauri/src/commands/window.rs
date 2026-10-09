//! The window's own commands: the header Ahabby draws where the OS frame is gone.
//!
//! Nothing here resolves a path or touches the disk — these are the four things a window can do
//! to itself, and they go through `desktop::window` for the same reason the tray does: the
//! webview is given no window permission of its own (`capabilities/default.json` grants the event
//! bus and nothing else), so the header's buttons reach the OS through the backend.

use tauri::WebviewWindow;

use crate::desktop;
use crate::domain::WindowChrome;
use crate::error::Result;

/// What the header renders from: whether the app draws one at all, and where the window is.
#[tauri::command]
pub async fn window_chrome(window: WebviewWindow) -> WindowChrome {
    desktop::window::chrome(&window)
}

/// Follow the cursor with the window — the header's drag region on a mouse down.
#[tauri::command]
pub async fn window_start_drag(window: WebviewWindow) -> Result<()> {
    desktop::window::start_drag(&window)
}

/// The header's minimize button.
#[tauri::command]
pub async fn window_minimize(window: WebviewWindow) -> Result<()> {
    desktop::window::minimize(&window)
}

/// The header's middle button, answering the state the button is drawn from next.
#[tauri::command]
pub async fn window_toggle_maximize(window: WebviewWindow) -> Result<WindowChrome> {
    desktop::window::toggle_maximize(&window)
}

/// The header's close button: the OS's own close request, so the tray setting decides the rest.
#[tauri::command]
pub async fn window_close(window: WebviewWindow) -> Result<()> {
    desktop::window::close(&window)
}
