//! Library (aggregated skills / MCP / other resources) and skill deletion commands.

use tauri::State;

use crate::domain::{Library, Skill};
use crate::error::Result;
use crate::services;
use crate::state::AppState;

use super::{MutationResult, SkillRemoval};

/// Aggregated view across every installed agent.
#[tauri::command]
pub async fn list_library(state: State<'_, AppState>) -> Result<Library> {
    let report = match state.report() {
        Ok(report) => report,
        Err(_) => state.scan().await,
    };
    Ok(services::aggregate(&report))
}

/// Skills of one agent (used by the agent page, which does not need the whole library).
#[tauri::command]
pub async fn list_agent_skills(state: State<'_, AppState>, agent_id: String) -> Result<Vec<Skill>> {
    Ok(state.agent(&agent_id)?.skills)
}

/// Delete a skill by moving its directory to the OS trash.
///
/// Requires `confirm` to be `true`: the frontend shows a confirmation dialog first, and the
/// backend refuses destructive actions that were not explicitly confirmed.
#[tauri::command]
pub async fn delete_skill(
    state: State<'_, AppState>,
    agent_id: String,
    skill_id: String,
    confirm: bool,
) -> Result<MutationResult<SkillRemoval>> {
    crate::commands::require_confirmation(confirm, "deleting a skill")?;
    let skill = state.skill(&agent_id, &skill_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter.remove_skill(&context, &skill).await?;

    let report = state.scan().await;
    Ok(MutationResult::new(
        SkillRemoval {
            removed_skill_id: skill_id,
            name: skill.name,
            path: skill.path,
            trashed: true,
        },
        report,
    ))
}
