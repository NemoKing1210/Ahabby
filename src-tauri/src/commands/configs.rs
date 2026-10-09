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
use crate::state::{AppState, DocumentTarget};

use super::{require_confirmation, MutationResult};

/// Refuse a document the manifest marks read-only, for every write path alike.
///
/// The frontend lowers its own affordance from the same `editable` flag, but the check has to
/// live here: a call that skips the UI must be refused, not write a file Ahabby was told not to
/// touch. One code for all four writers — an editor save, a restore, and the two single-value
/// writes of the quick-settings panel — so the frontend never has to know which one answered.
pub(crate) fn require_editable(target: &DocumentTarget, path: &str) -> Result<()> {
    if !target.editable {
        return Err(AppError::CommandNotAllowed(format!("{path} is read-only")));
    }
    Ok(())
}

/// Resolve a backup path the frontend sent, refusing anything that is not a backup of this
/// exact file.
///
/// The frontend only ever gets paths out of `list_backups`, but this is what makes the backup
/// commands safe for a caller that skips the UI: nothing outside the document's own backup
/// directory can be read or deleted through them.
fn require_backup_of(
    state: &AppState,
    target: &DocumentTarget,
    backup_path: &str,
) -> Result<(PathBuf, PathBuf)> {
    let backup_root = state.backup_root();
    let backup = PathBuf::from(backup_path);
    let expected = services::list_backups(&backup_root, &target.path)?;
    if !expected.iter().any(|entry| entry.path == backup) {
        return Err(AppError::CommandNotAllowed(format!(
            "{backup_path} is not a backup of {}",
            target.path.display()
        )));
    }
    Ok((backup_root, backup))
}

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
    require_editable(&target, &path)?;
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
    require_editable(&target, &path)?;
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

/// Validate one in-place edit of a single value and show what would change.
///
/// The frontend sends a dotted key and a new value, never a document: the backend reads the
/// file, changes that one value and diffs the result, so the quick-settings row is a write
/// through the same checks as the editor, not a second write path.
#[tauri::command]
pub async fn preview_config_fact(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    key: String,
    value: String,
    base_sha256: String,
) -> Result<DiffPreview> {
    let target = state.document_target(&agent_id, &path)?;
    require_editable(&target, &path)?;
    services::preview_fact(&target.path, target.format, &key, &value, &base_sha256)
}

/// Write one value in place: validation, backup and atomic replacement included.
#[tauri::command]
pub async fn save_config_fact(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    key: String,
    value: String,
    base_sha256: String,
) -> Result<MutationResult<SaveResult>> {
    let target = state.document_target(&agent_id, &path)?;
    require_editable(&target, &path)?;
    let backup_root = state.backup_root();
    let result = services::save_fact(
        &target.path,
        target.format,
        &key,
        &value,
        &base_sha256,
        &backup_root,
    )?;
    let report = state.scan().await;
    Ok(MutationResult::new(result, report))
}

/// Delete one value from a config file.
///
/// Removing a setting is destructive, so it takes `confirm` exactly like `remove_skill`: the
/// card's dialog is the UI half, and this is the half a caller that skips it cannot bypass.
#[tauri::command]
pub async fn remove_config_fact(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    key: String,
    base_sha256: String,
    confirm: bool,
) -> Result<MutationResult<SaveResult>> {
    crate::commands::require_confirmation(confirm, "removing a config value")?;
    let target = state.document_target(&agent_id, &path)?;
    require_editable(&target, &path)?;
    let backup_root = state.backup_root();
    let result = services::remove_fact(
        &target.path,
        target.format,
        &key,
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
    require_editable(&target, &path)?;

    let (backup_root, backup) = require_backup_of(&state, &target, &backup_path)?;
    let result = services::restore(&backup, &target.path, target.format, &backup_root)?;
    let report = state.scan().await;
    Ok(MutationResult::new(result, report))
}

/// Read a backup as text so the frontend can diff it against the file it came from.
///
/// Same ownership check as a restore: only a backup `list_backups` reports for this document
/// can be read, so the comparison view cannot be turned into a reader of arbitrary files.
#[tauri::command]
pub async fn read_backup(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    backup_path: String,
) -> Result<String> {
    let target = state.document_target(&agent_id, &path)?;
    let (_root, backup) = require_backup_of(&state, &target, &backup_path)?;
    services::read_backup(&backup)
}

/// Delete one backup of a document.
///
/// Removing it is destructive and irreversible, so it takes `confirm` exactly like
/// `remove_skill` and answers with the backups that remain, so the panel never has to guess.
#[tauri::command]
pub async fn delete_backup(
    state: State<'_, AppState>,
    agent_id: String,
    path: String,
    backup_path: String,
    confirm: bool,
) -> Result<Vec<BackupEntry>> {
    require_confirmation(confirm, "deleting a backup")?;
    let target = state.document_target(&agent_id, &path)?;
    let (backup_root, backup) = require_backup_of(&state, &target, &backup_path)?;
    services::delete_backup(&backup_root, &target.path, &backup)?;
    services::list_backups(&backup_root, &target.path)
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::ConfigFormat;
    use std::path::PathBuf;

    fn target(editable: bool) -> DocumentTarget {
        DocumentTarget {
            path: PathBuf::from("/home/u/.codex/config.toml"),
            format: ConfigFormat::Toml,
            editable,
        }
    }

    #[test]
    fn a_read_only_document_is_refused_by_every_write_path() {
        // The same guard serves `preview_config_save` / `save_config` / `restore_backup` and the
        // quick-settings pair, so a call that skips the UI is refused whatever it tried to write.
        let error = require_editable(&target(false), "/home/u/.codex/config.toml").unwrap_err();
        assert_eq!(error.code(), "command_not_allowed");
        assert!(require_editable(&target(true), "/home/u/.codex/config.toml").is_ok());
    }
}
