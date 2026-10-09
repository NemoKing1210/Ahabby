use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// The state of Ahabby's one window, for the header it draws itself.
///
/// The header is the app's own only where the OS frame is gone (`custom`); elsewhere the
/// window wears the frame macOS or Linux gives it and this model is read but not drawn.
/// `maximized` and `focused` are pushed as they change — by the window's own event handler,
/// never polled — because a maximized window is what turns the middle button into a restore,
/// and the OS dims an inactive window's controls.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct WindowChrome {
    /// The window has no OS frame, so the app draws its own header.
    pub custom: bool,
    /// The window is maximized (restore is what the header's middle button then does).
    pub maximized: bool,
    /// The window is the active one.
    pub focused: bool,
}
