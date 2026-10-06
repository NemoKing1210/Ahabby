//! Document reading / editing / backup commands.
//!
//! "Document" is anything the scan declared addressable for an agent: a config file, another
//! resource file (instructions, commands, hooks, rules) or a skill's entry file. Which paths
//! qualify — and which are writable — is decided by `AppState::document_target`.

use std::path::PathBuf;

use tauri::State;

use crate::adapters::mcp_parse;
use crate::domain::secrets as domain_secrets;
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
    let target = state.document_target(&agent_id, &path)?;
    if !target.editable {
        return Err(AppError::NotSupported(format!("{path} is read-only")));
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
    let target = state.document_target(&agent_id, &path)?;
    if !target.editable {
        return Err(AppError::NotSupported(format!("{path} is read-only")));
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
    let target = state.document_target(&agent_id, &path)?;
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
    let target = state.document_target(&agent_id, &path)?;
    if !target.editable {
        return Err(AppError::NotSupported(format!("{path} is read-only")));
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

/// Read one credential out of a config file the user explicitly asked to see.
///
/// The quick-info panel only ever receives a masked value, so this is the *only* way real
/// secret text crosses the IPC boundary — and it is limited, like `reveal_mcp_secret`, to a
/// single key that looks like a secret inside a document the scan already declared.
#[tauri::command]
pub async fn reveal_config_fact(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    key: String,
) -> Result<String> {
    let target = state.document_target(&agent_id, &path)?;
    if !target.format.is_structured() {
        return Err(AppError::NotSupported(
            "this format does not hold structured data".to_string(),
        ));
    }

    let content = crate::platform::read_text(&target.path)?;
    let document = mcp_parse::document_to_value(target.format, &content)?;
    let segments: Vec<String> = key.split('.').map(str::to_string).collect();
    let value = mcp_parse::value_at(&document, &segments)
        .ok_or_else(|| AppError::NotFound(format!("{key} in {path}")))?;
    let text = match value {
        serde_json::Value::String(text) => text.clone(),
        other => other.to_string(),
    };

    // The key must look like a secret, or the value itself must carry a credential (a proxy
    // URL with a password): anything else is not something the quick-info panel ever masked.
    let last = key.rsplit('.').next().unwrap_or_default();
    if !domain_secrets::is_secret_key(last) && !domain_secrets::has_url_credentials(&text) {
        return Err(AppError::InvalidInput(format!(
            "'{key}' is not a secret field"
        )));
    }
    Ok(text)
}
