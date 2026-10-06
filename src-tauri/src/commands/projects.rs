//! Project commands: the folders the user adds, and the native picker that chooses one.
//!
//! Everything *inside* a project — its skills, MCP servers and documents — is read, edited,
//! created and deleted through the commands that already serve an agent, addressed by the
//! project's owner id (`project:<hash>`). Only the folder list itself needs commands of its own.

use tauri::{Manager, State};
use tauri_plugin_dialog::DialogExt;

use crate::domain::ProjectFolder;
use crate::error::{AppError, Result};
use crate::state::AppState;

use super::MutationResult;

/// Add a folder to the Projects screen.
///
/// The folder is resolved and checked to exist; Ahabby then looks for projects inside it (the
/// folder itself counts when it holds none). The answer carries the fresh scan report, whose
/// `projects` field is what the page paints, so the new folder is on screen when it returns.
#[tauri::command]
pub async fn add_project_folder(
    state: State<'_, AppState>,
    path: String,
) -> Result<MutationResult<ProjectFolder>> {
    let folder = state.add_project_folder(&path)?;
    let report = state.scan().await;
    Ok(MutationResult::new(folder, report))
}

/// Forget a folder. Nothing on disk is touched — the projects under it simply stop being
/// scanned — so no confirmation is required, unlike every destructive command.
#[tauri::command]
pub async fn remove_project_folder(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<MutationResult<ProjectFolder>> {
    let folder = state.remove_project_folder(&folder_id)?;
    let report = state.scan().await;
    Ok(MutationResult::new(folder, report))
}

/// Open the operating system's own folder picker and hand back what the user chose.
///
/// The dialog is the OS's: Ahabby passes no program, reads no file and remembers nothing here —
/// it only gets a path back. `Ok(None)` means the user cancelled, which is not an error. The
/// path is validated and remembered by [`add_project_folder`], so a picked folder and a typed
/// one take exactly the same route.
///
/// The dialog is modal to the window that asked for it, starts in the user's home directory and
/// carries no title of its own: the OS labels it in the user's own language.
#[tauri::command]
pub async fn pick_project_folder(
    state: State<'_, AppState>,
    window: tauri::WebviewWindow,
) -> Result<Option<String>> {
    let app = window.app_handle().clone();
    let start = state.platform_context().home;

    // The picker blocks until the user answers, so it never runs on the async runtime's threads.
    let picked = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .file()
            .set_parent(&window)
            .set_directory(start)
            .blocking_pick_folder()
    })
    .await
    .map_err(|error| AppError::other(format!("the folder picker failed: {error}")))?;

    let Some(picked) = picked else {
        return Ok(None);
    };
    let path = picked
        .into_path()
        .map_err(|error| AppError::other(format!("the folder picker failed: {error}")))?;
    Ok(Some(path.to_string_lossy().to_string()))
}
