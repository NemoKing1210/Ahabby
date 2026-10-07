//! Settings commands.

use tauri::State;

use crate::error::{AppError, Result};
use crate::services::{Settings, Theme};
use crate::state::AppState;

#[tauri::command]
pub async fn get_settings(state: State<'_, AppState>) -> Result<Settings> {
    Ok(state.settings())
}

/// Pin an agent to the top of the list (and to the sidebar), or unpin it.
#[tauri::command]
pub async fn set_agent_favorite(
    state: State<'_, AppState>,
    agent_id: String,
    favorite: bool,
) -> Result<Settings> {
    state.set_agent_favorite(&agent_id, favorite)
}

/**
 * Remember that the sidebar rail is collapsed (or open again).
 *
 * The shell owns this: the Settings page never edits it, and `save_settings` keeps whatever the
 * last toggle wrote, so the two can never disagree.
 */
#[tauri::command]
pub async fn set_sidebar_collapsed(
    state: State<'_, AppState>,
    collapsed: bool,
) -> Result<Settings> {
    state.set_sidebar_collapsed(collapsed)
}

/// Remember the screen the window is on, so the next launch opens there.
#[tauri::command]
pub async fn set_last_route(state: State<'_, AppState>, route: Option<String>) -> Result<Settings> {
    state.set_last_route(route.as_deref())
}

/// Persist the settings document the Settings page edited.
///
/// Two of its fields describe the machine rather than Ahabby's own files, and both are applied
/// here, around the write:
///
/// * the login item, *before* the document is stored — the file has to describe what the OS
///   really does, so a registration the OS refused must not be saved as if it had worked (the
///   error reaches the user as a toast and the draft stays unsaved);
/// * the tray, after: the icon appears or goes away, and the menu is rebuilt in the language the
///   document may have just changed.
#[tauri::command]
pub async fn save_settings(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    mut settings: Settings,
) -> Result<Settings> {
    for path in &settings.extra_scan_paths {
        let trimmed = path.trim();
        if !trimmed.is_empty() && !std::path::Path::new(trimmed).exists() {
            return Err(crate::error::AppError::InvalidInput(format!(
                "scan path does not exist: {trimmed}"
            )));
        }
    }
    let current = state.settings().launch_at_login;
    if let Some(enabled) = crate::desktop::autostart::is_enabled(&app) {
        if settings.launch_at_login != current {
            // The user moved the switch, so the OS follows — and a refusal is theirs to see:
            // nothing is written, which is what keeps the document from claiming something the
            // machine does not do.
            crate::desktop::autostart::apply(&app, settings.launch_at_login)?;
        } else if enabled != current {
            // The switch was not touched, yet the machine disagrees (a login item removed in the
            // OS's own startup settings, say): the document is corrected, never the OS — the same
            // rule the launch itself applies.
            settings.launch_at_login = enabled;
        }
    }
    let saved = state.save_settings(settings)?;
    crate::desktop::sync(&app);
    Ok(saved)
}

/// Paints the native window chrome to match the theme the webview is rendering.
///
/// `dark` is the *resolved* theme (what the webview actually shows), `caption`/`text` are
/// the resolved `--ah-background` / `--ah-foreground` colours. `theme` is only needed by
/// the platforms that take an OS-level appearance instead of explicit colours.
#[tauri::command]
pub async fn set_window_theme(
    window: tauri::Window,
    theme: Theme,
    dark: bool,
    caption: String,
    text: String,
) -> Result<()> {
    apply_window_theme(&window, theme, dark, &caption, &text)
}

/// Paints the chrome for the theme the app is about to render, before the webview can say.
///
/// `run()`'s setup calls this just before it shows the window — the window is created hidden for
/// exactly that reason. The webview cannot colour the caption first: the splash is painted from
/// `index.html` before the bundle, the stylesheet or the settings round-trip that
/// `set_window_theme` needs, so a window shown earlier would wear the OS caption over a themed
/// splash. The palette and the OS preference (`system`) are answered here because the webview has
/// neither yet.
pub(crate) fn paint_startup_window_theme(window: &tauri::Window, theme: Theme) -> Result<()> {
    let dark = match theme {
        Theme::Light => false,
        Theme::Dark => true,
        // The same answer `prefers-color-scheme` gives the webview once it loads.
        Theme::System => window
            .theme()
            .map(|system| system == tauri::Theme::Dark)
            .unwrap_or(false),
    };
    let (caption, text) = crate::platform::chrome_tokens(dark);
    apply_window_theme(window, theme, dark, caption, text)
}

#[cfg(windows)]
fn apply_window_theme(
    window: &tauri::Window,
    _theme: Theme,
    dark: bool,
    caption: &str,
    text: &str,
) -> Result<()> {
    // `Window::set_theme` is deliberately not used on Windows: tao reacts to it by emitting
    // a theme change that `tauri-runtime-wry` forwards to *our own* webview, flipping the
    // `prefers-color-scheme` that a `system` theme is resolved from — the app would then
    // fight its own native call. DWM sets the whole chrome directly, and it also pins the
    // caption that Windows 11 would otherwise tint with the system accent.
    let hwnd = window
        .hwnd()
        .map_err(|error| AppError::Other(format!("window has no handle: {error}")))?;
    crate::platform::set_window_chrome(hwnd.0 as isize, dark, caption, text)
}

#[cfg(not(windows))]
fn apply_window_theme(
    window: &tauri::Window,
    theme: Theme,
    _dark: bool,
    _caption: &str,
    _text: &str,
) -> Result<()> {
    // macOS and Linux expose a system appearance instead; their title bars are flat.
    window
        .set_theme(match theme {
            Theme::System => None,
            Theme::Light => Some(tauri::Theme::Light),
            Theme::Dark => Some(tauri::Theme::Dark),
        })
        .map_err(|error| AppError::Other(format!("cannot set window theme: {error}")))
}
