//! The reader commands: the two things Ahabby's own browser asks the backend for.
//!
//! Both are reads through the same proxy as every other network call, and both are *content*
//! requests: the window never loads a remote origin, so a link can neither navigate the app
//! away nor run a third-party script next to the IPC bridge.

use tauri::State;

use crate::domain::{WebImage, WebPage};
use crate::error::Result;
use crate::state::AppState;

/// Read one page for the reader.
///
/// A refusal (a PDF, a type the reader cannot show, a scheme that is not `http(s)`) comes back
/// as an error code the UI turns into "open it in your browser instead" — never as an empty page.
#[tauri::command]
pub async fn fetch_web_page(state: State<'_, AppState>, url: String) -> Result<WebPage> {
    state.web().fetch_page(&url).await
}

/// Carry one image of a page into the reader as base64, which the frontend turns into a `data:` URL.
///
/// This is what keeps `img-src 'self' data:` in the CSP: the reader shows the pictures a page
/// declares without the window ever talking to the site that serves them.
#[tauri::command]
pub async fn fetch_web_image(state: State<'_, AppState>, url: String) -> Result<WebImage> {
    state.web().fetch_image(&url).await
}
