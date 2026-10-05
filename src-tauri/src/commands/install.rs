//! Install / update / uninstall commands.
//!
//! The frontend sends an **agent id** and a **method id** — never a command line. The
//! command is resolved from the manifest inside the backend, shown to the user for
//! confirmation, and only then executed.

use serde::Deserialize;
use tauri::State;

use crate::domain::{InstallAction, InstallPlan};
use crate::error::{AppError, Result};
use crate::state::AppState;

/// What the user asked for. Deserialized from a plain string.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ActionRequest {
    Install,
    Update,
    Uninstall,
}

impl From<ActionRequest> for InstallAction {
    fn from(request: ActionRequest) -> Self {
        match request {
            ActionRequest::Install => InstallAction::Install,
            ActionRequest::Update => InstallAction::Update,
            ActionRequest::Uninstall => InstallAction::Uninstall,
        }
    }
}

/// Resolve the exact command that would run, without running it.
#[tauri::command]
pub async fn plan_install(
    state: State<'_, AppState>,
    agent_id: String,
    action: ActionRequest,
    method_id: Option<String>,
) -> Result<InstallPlan> {
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter
        .install_plan(&context, action.into(), method_id.as_deref())
        .await
}

/// Resolve and start a job. Returns the job id; output arrives through `job://output`.
///
/// Requires `confirm` to be `true`: the frontend shows the resolved command first, and the
/// backend refuses to execute anything that was not explicitly confirmed.
#[tauri::command]
pub async fn run_install(
    state: State<'_, AppState>,
    agent_id: String,
    action: ActionRequest,
    method_id: Option<String>,
    confirm: bool,
) -> Result<String> {
    let action = InstallAction::from(action);
    super::require_confirmation(
        confirm,
        match action {
            InstallAction::Install => "installing an agent",
            InstallAction::Update => "updating an agent",
            InstallAction::Uninstall => "uninstalling an agent",
        },
    )?;

    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    let plan = adapter
        .install_plan(&context, action, method_id.as_deref())
        .await?;

    if plan.manager == crate::domain::Manager::Manual {
        return Err(AppError::NoInstallMethod {
            agent: plan.agent_name.clone(),
        });
    }
    state.jobs().start(plan, state.proxy()).await
}

#[tauri::command]
pub async fn cancel_job(state: State<'_, AppState>, job_id: String) -> Result<bool> {
    state.jobs().cancel(&job_id).await
}

#[tauri::command]
pub async fn running_jobs(state: State<'_, AppState>) -> Result<Vec<String>> {
    Ok(state.jobs().running().await)
}

/// Refresh the scan after a job finished (the frontend calls this from the `job://done`
/// handler so the new version shows up immediately).
#[tauri::command]
pub async fn rescan_after_job(state: State<'_, AppState>) -> Result<crate::services::ScanReport> {
    Ok(state.scan().await)
}
