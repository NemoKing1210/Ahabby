//! Config reading / editing / backup commands.

use std::path::PathBuf;

use tauri::State;

use crate::domain::{BackupEntry, ConfigSnapshot, DiffPreview, SaveResult};
use crate::error::{AppError, Result};
use crate::services;
use crate::state::AppState;

use super::MutationResult;

#[tauri::command]
pub async fn read_config(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
) -> Result<ConfigSnapshot> {
    state.read_config(&agent_id, &path)
}

/// Validate the edited text and show the user exactly what would change.
#[tauri::command]
pub async fn preview_config_save(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    content: String,
    base_sha256: String,
) -> Result<DiffPreview> {
    let target = state.config_target(&agent_id, &path)?;
    if !target.editable {
        return Err(AppError::NotSupported(format!(
            "{path} is declared read-only by the manifest of {agent_id}"
        )));
    }
    services::preview(&target.path, target.format, &content, &base_sha256)
}

/// Write the edited config: validation, backup and atomic replacement included.
#[tauri::command]
pub async fn save_config(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    content: String,
    base_sha256: String,
) -> Result<MutationResult<SaveResult>> {
    let target = state.config_target(&agent_id, &path)?;
    if !target.editable {
        return Err(AppError::NotSupported(format!(
            "{path} is declared read-only by the manifest of {agent_id}"
        )));
    }
    let backup_root = state.backup_root();
    let result = services::save(
        &target.path,
        target.format,
        &content,
        &base_sha256,
        &backup_root,
    )?;
    let report = state.scan().await;
    Ok(MutationResult::new(result, report))
}

#[tauri::command]
pub async fn list_backups(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
) -> Result<Vec<BackupEntry>> {
    let target = state.config_target(&agent_id, &path)?;
    services::list_backups(&state.backup_root(), &target.path)
}

/// Restore a backup. The current content is backed up first, so this is reversible too.
#[tauri::command]
pub async fn restore_backup(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    backup_path: String,
) -> Result<MutationResult<SaveResult>> {
    let target = state.config_target(&agent_id, &path)?;
    if !target.editable {
        return Err(AppError::NotSupported(format!(
            "{path} is declared read-only by the manifest of {agent_id}"
        )));
    }

    // The backup must belong to this exact file: the frontend only ever gets paths that
    // came out of `list_backups`, but the check is cheap insurance.
    let backup_root = state.backup_root();
    let backup = PathBuf::from(&backup_path);
    let expected = services::list_backups(&backup_root, &target.path)?;
    if !expected.iter().any(|entry| entry.path == backup) {
        return Err(AppError::CommandNotAllowed(format!(
            "{backup_path} is not a backup of {path}"
        )));
    }

    let result = services::restore(&backup, &target.path, target.format, &backup_root)?;
    let report = state.scan().await;
    Ok(MutationResult::new(result, report))
}

/// Where backups are written (shown in Settings).
#[tauri::command]
pub async fn backup_root(state: State<'_, AppState>) -> Result<String> {
    Ok(state.backup_root().to_string_lossy().to_string())
}

/// Directory the user can drop extra manifests into.
#[tauri::command]
pub async fn user_catalog_dir(state: State<'_, AppState>) -> Result<String> {
    Ok(state.user_catalog_dir().to_string_lossy().to_string())
}
