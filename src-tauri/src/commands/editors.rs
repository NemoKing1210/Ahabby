//! Opening a document in an editor installed on this machine.
//!
//! The frontend names an *editor id* and a document; the editor's own command line comes from
//! `platform::editors`, never from the webview, and the path has to be one the scan declared for
//! this owner — the same seam every other document command goes through. Which paths qualify is
//! decided by `AppState::document_target`.

use tauri::State;

use crate::domain::ExternalEditor;
use crate::error::{AppError, Result};
use crate::state::AppState;

/// The editors found on this machine, in table order. Nothing that is not installed is offered.
#[tauri::command]
pub async fn list_external_editors(state: State<'_, AppState>) -> Result<Vec<ExternalEditor>> {
    let context = state.platform_context();
    Ok(crate::platform::editors::detect(&context)
        .into_iter()
        .map(|editor| ExternalEditor {
            id: editor.id.to_string(),
            name: editor.name.to_string(),
            path: editor.path.to_string_lossy().to_string(),
        })
        .collect())
}

/// Open one declared document in one detected editor.
///
/// Read-only documents are openable too: Ahabby is not writing anything here, and the user may
/// well want to read a plugin-managed file in their own editor.
#[tauri::command]
pub async fn open_in_editor(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    editor_id: String,
) -> Result<()> {
    let target = state.document_target(&agent_id, &path)?;
    if !target.path.is_file() {
        return Err(AppError::NotFound(path));
    }
    crate::platform::editors::launch(&state.platform_context(), &editor_id, &target.path)
}
