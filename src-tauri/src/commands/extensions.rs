//! Extensions of one agent. Listing them is part of the scan — these commands change them.
//!
//! Two kinds of change exist, and they are deliberately different:
//!
//! * a **local module** is Ahabby's to touch, so it is moved to the OS trash (with a
//!   confirmation) or renamed aside to switch it off;
//! * a **package** belongs to the agent's own CLI — it put the files where it wanted them — so it
//!   is updated and removed by a command resolved from the manifest, resolved first (seen by the
//!   user) and then run as a job exactly like an install. The frontend sends an extension id and
//!   an action, never a command line.

use tauri::State;

use crate::domain::{ExtensionAction, InstallPlan};
use crate::error::Result;
use crate::state::AppState;

use super::{require_confirmation, ExtensionRemoval, ExtensionToggle, MutationResult};

/// Delete a local extension by moving its files to the OS trash.
///
/// Requires `confirm` to be `true`, like every other destructive command: the frontend shows the
/// path it is about to remove first, and the backend refuses what was not confirmed.
#[tauri::command]
pub async fn delete_extension(
    state: State<'_, AppState>,
    agent_id: String,
    extension_id: String,
    confirm: bool,
) -> Result<MutationResult<ExtensionRemoval>> {
    require_confirmation(confirm, "deleting an extension")?;
    let extension = state.extension(&agent_id, &extension_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter.remove_extension(&context, &extension).await?;

    let report = state.scan().await;
    Ok(MutationResult::new(
        ExtensionRemoval {
            removed_extension_id: extension_id,
            name: extension.name,
            path: extension.path.clone().unwrap_or_default(),
            trashed: true,
        },
        report,
    ))
}

/// Switch a local extension off (or back on) by renaming its entry file.
///
/// Nothing is deleted and nothing inside the file changes, so — like the skill switch — no
/// confirmation is required: the switch itself undoes the operation.
#[tauri::command]
pub async fn set_extension_enabled(
    state: State<'_, AppState>,
    agent_id: String,
    extension_id: String,
    enabled: bool,
) -> Result<MutationResult<ExtensionToggle>> {
    let extension = state.extension(&agent_id, &extension_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter
        .set_extension_enabled(&context, &extension, enabled)
        .await?;

    let report = state.scan().await;
    Ok(MutationResult::new(
        ExtensionToggle {
            extension_id,
            name: extension.name,
            enabled,
            path: extension.path.clone().unwrap_or_default(),
        },
        report,
    ))
}

/// Resolve the command that would run, without running it.
///
/// The user sees this exact line in the confirmation dialog — the frontend cannot construct one.
#[tauri::command]
pub async fn plan_extension_action(
    state: State<'_, AppState>,
    agent_id: String,
    extension_id: String,
    action: ExtensionAction,
) -> Result<InstallPlan> {
    let extension = state.extension(&agent_id, &extension_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter.extension_plan(&context, &extension, action).await
}

/// Resolve and start a job for one package. Returns the job id; output arrives on `job://output`.
#[tauri::command]
pub async fn run_extension_action(
    state: State<'_, AppState>,
    agent_id: String,
    extension_id: String,
    action: ExtensionAction,
    confirm: bool,
) -> Result<String> {
    require_confirmation(confirm, "running an extension command")?;
    let extension = state.extension(&agent_id, &extension_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    let plan = adapter.extension_plan(&context, &extension, action).await?;
    state.jobs().start(plan, state.proxy()).await
}
