//! Desktop integration: the tray icon, the window's life cycle and the login item.
//!
//! None of this is a *service*. A service takes a [`crate::platform::PlatformContext`] and is
//! testable without an application; everything here needs the live `AppHandle`, because a tray
//! menu, a window and a login item only exist inside a running process. Keeping it in its own
//! module is what lets `AppState` and the commands stay about agents and files.
//!
//! The three settings that drive it (`tray_icon`, `close_to_tray`, `start_minimized`, plus the
//! login item `launch_at_login`) all live in [`crate::services::Settings`], and one call —
//! [`sync`] — puts the desktop back in the shape they describe.

pub mod autostart;
pub mod tray;
pub mod window;

pub use tray::sync;
