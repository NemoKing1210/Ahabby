//! Cloud sync commands.
//!
//! The read side (`status`, `items`, `remote`, `preview`) answers what the Sync screen and the
//! agent page render. The write side is small on purpose:
//!
//! * `set_sync_token` is the only place a credential is written, and it never comes back out;
//! * `push_sync_items` / `push_all_sync_items` upload what the *scan* says exists — the frontend
//!   sends item ids, never paths;
//! * `pull_sync_items` is the only one that writes local files, requires `confirm`, and goes
//!   through [`crate::services::SyncTarget`], which validates every destination against the
//!   surface the owner's manifest declared.

use tauri::State;

use crate::domain::{
    RemoteList, SyncAccount, SyncComparison, SyncContent, SyncItemList, SyncItemRef, SyncPreview,
    SyncProviderId, SyncPullTarget, SyncRun, SyncStatus,
};
use crate::error::Result;
use crate::state::AppState;

use super::MutationResult;

/// The connection, the last runs and the last error.
#[tauri::command]
pub async fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatus> {
    Ok(state.sync().status())
}

/// Check the stored token against the provider and name the account it belongs to.
#[tauri::command]
pub async fn verify_sync_connection(state: State<'_, AppState>) -> Result<SyncAccount> {
    state.sync().verify().await
}

/// Store (or clear, with an empty string) the provider token.
///
/// The token is written to its own file, never to the settings document: the settings are read
/// and written whole by the Settings page, and a token in them would cross the boundary on every
/// read. The UI only ever sees [`SyncStatus::token_hint`].
#[tauri::command]
pub async fn set_sync_token(
    state: State<'_, AppState>,
    provider: SyncProviderId,
    token: String,
) -> Result<SyncStatus> {
    state.sync().set_token(provider, &token)
}

/// Every item of this machine that cloud sync knows about, with what is already uploaded.
#[tauri::command]
pub async fn list_sync_items(
    state: State<'_, AppState>,
    owner_id: Option<String>,
) -> Result<SyncItemList> {
    let report = state.report()?;
    Ok(state.sync().local_items(&report, owner_id.as_deref()))
}

/// The copies the connected account holds.
#[tauri::command]
pub async fn list_remote_sync_items(
    state: State<'_, AppState>,
    refresh: bool,
) -> Result<RemoteList> {
    state.sync().remote_items(refresh).await
}

/// What restoring one copy would do — resolved against the scan, nothing written.
#[tauri::command]
pub async fn preview_sync_pull(
    state: State<'_, AppState>,
    remote_id: String,
    owner_id: String,
) -> Result<SyncPreview> {
    let report = state.report()?;
    state
        .sync()
        .preview(&report, &*state, &remote_id, &owner_id)
        .await
}

/// Upload the selected items.
#[tauri::command]
pub async fn push_sync_items(
    state: State<'_, AppState>,
    items: Vec<SyncItemRef>,
) -> Result<MutationResult<SyncRun>> {
    let report = state.report()?;
    let run = state.sync().push(&report, &items).await?;
    Ok(MutationResult::new(run, state.report()?))
}

/// Upload everything the automatic set covers — the screen's "save everything now".
#[tauri::command]
pub async fn push_all_sync_items(state: State<'_, AppState>) -> Result<MutationResult<SyncRun>> {
    let report = state.report()?;
    let run = state.sync().push_all(&report).await?;
    Ok(MutationResult::new(run, state.report()?))
}

/// Restore the selected copies. Refused without `confirm`, and always through the scan's own
/// destinations — a pull can only write where the owner's manifest declares a place for it.
#[tauri::command]
pub async fn pull_sync_items(
    state: State<'_, AppState>,
    targets: Vec<SyncPullTarget>,
    confirm: bool,
) -> Result<MutationResult<SyncRun>> {
    crate::commands::require_confirmation(confirm, "restore a cloud copy")?;
    let report = state.report()?;
    let run = state
        .sync()
        .pull(&report, &*state, &targets, confirm)
        .await?;
    let report = state.scan().await;
    Ok(MutationResult::new(run, report))
}

/// One item of this machine, as a reader shows it.
///
/// The item is resolved from the scan — the frontend sends an id, never a path — and the backend
/// reads it: text within the viewer's limit, a binary file by its size alone.
#[tauri::command]
pub async fn read_sync_item(
    state: State<'_, AppState>,
    owner_id: String,
    item_id: String,
) -> Result<SyncContent> {
    let report = state.report()?;
    state.sync().local_content(&report, &owner_id, &item_id)
}

/// One cloud copy, as a reader shows it.
#[tauri::command]
pub async fn read_remote_sync_item(
    state: State<'_, AppState>,
    remote_id: String,
) -> Result<SyncContent> {
    state.sync().remote_content(&remote_id).await
}

/// One item against its cloud copy: both sides read the same way, and how each file stands.
#[tauri::command]
pub async fn compare_sync_item(
    state: State<'_, AppState>,
    remote_id: String,
    owner_id: String,
) -> Result<SyncComparison> {
    let report = state.report()?;
    state.sync().compare(&report, &remote_id, &owner_id).await
}

/// Remove one cloud copy. The local files are left exactly as they are.
#[tauri::command]
pub async fn delete_remote_sync_item(
    state: State<'_, AppState>,
    remote_id: String,
    confirm: bool,
) -> Result<SyncRun> {
    state.sync().delete_remote(&remote_id, confirm).await
}
