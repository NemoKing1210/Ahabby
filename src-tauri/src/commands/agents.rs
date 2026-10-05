//! Agent listing / scanning commands.

use serde::{Deserialize, Serialize};
use tauri::State;
use ts_rs::TS;

use crate::domain::{Agent, AgentRemoval, HiddenAgent, Manager};
use crate::error::{AppError, Result};
use crate::services::ScanReport;
use crate::state::AppState;

use super::MutationResult;

/// A package manager available on this machine (Settings page).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct PackageManagerInfo {
    pub manager: Manager,
    pub program: String,
    pub path: String,
}

/// Scan (or return the cached scan of) every agent.
#[tauri::command]
pub async fn list_agents(state: State<'_, AppState>, force: bool) -> Result<ScanReport> {
    if !force {
        if let Ok(report) = state.report() {
            return Ok(report);
        }
    }
    Ok(state.scan().await)
}

/// Rescan everything, ignoring the cache.
#[tauri::command]
pub async fn rescan(state: State<'_, AppState>) -> Result<ScanReport> {
    Ok(state.scan().await)
}

#[tauri::command]
pub async fn get_agent(state: State<'_, AppState>, agent_id: String) -> Result<Agent> {
    state.agent(&agent_id)
}

/// Remove an agent from Ahabby.
///
/// An agent that has its own manifest in the user catalog is deleted (the file is moved to
/// the OS trash); a shipped agent is only hidden and can be restored from Settings. Requires
/// `confirm: true`, like every other destructive command — the frontend shows a dialog first.
#[tauri::command]
pub async fn remove_agent(
    state: State<'_, AppState>,
    agent_id: String,
    confirm: bool,
) -> Result<MutationResult<AgentRemoval>> {
    crate::commands::require_confirmation(confirm, "removing an agent")?;
    let removal = state.remove_agent(&agent_id)?;
    let report = state.scan().await;
    Ok(MutationResult::new(removal, report))
}

/// Bring a hidden agent back into the list.
#[tauri::command]
pub async fn restore_agent(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<MutationResult<HiddenAgent>> {
    let restored = state.restore_agent(&agent_id)?;
    let report = state.scan().await;
    Ok(MutationResult::new(restored, report))
}

/// Package managers found on this machine, for the Settings page.
#[tauri::command]
pub async fn list_package_managers() -> Result<Vec<PackageManagerInfo>> {
    Ok(crate::platform::detect_managers()
        .into_iter()
        .map(|found| PackageManagerInfo {
            manager: found.manager,
            program: found.program,
            path: found.path,
        })
        .collect())
}

/// Open a path (config file, skill directory, backup) in the OS file manager.
#[tauri::command]
pub async fn reveal_path(state: State<'_, AppState>, path: String) -> Result<()> {
    if path.trim().is_empty() {
        return Err(AppError::InvalidInput("path must not be empty".to_string()));
    }
    state.reveal(&path)
}

/// Open a documentation or website link in the user's browser (`http`/`https` only).
#[tauri::command]
pub async fn open_url(url: String) -> Result<()> {
    crate::platform::open::open_url(&url)
}
