//! Library (aggregated skills / MCP / other resources) and skill deletion commands.

use tauri::State;

use crate::domain::{Library, Skill, SkillDraft};
use crate::error::Result;
use crate::services;
use crate::state::AppState;

use super::{MutationResult, SkillRemoval, SkillToggle};

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

/// Create a skill of the user's own under the skills directory the manifest declares.
///
/// `agent_id` is any owner the scan knows: a real agent id or the reserved shared surface.
/// The skill is written as `<skills dir>/<slug>/SKILL.md`, so it is switched on by default and
/// behaves like any scanned skill from the next scan on.
#[tauri::command]
pub async fn create_skill(
    state: State<'_, AppState>,
    agent_id: String,
    draft: SkillDraft,
) -> Result<MutationResult<Skill>> {
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    let skill = adapter.create_skill(&context, &draft).await?;

    let report = state.scan().await;
    Ok(MutationResult::new(skill, report))
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

/// Switch a skill on or off.
///
/// Off renames the entry file to `<name>.disabled`, which is enough for every agent, because
/// they look a skill up by its exact file name; on renames it back. Nothing is written inside
/// the file and nothing is deleted, so no confirmation is required — the switch itself undoes
/// the operation.
#[tauri::command]
pub async fn set_skill_enabled(
    state: State<'_, AppState>,
    agent_id: String,
    skill_id: String,
    enabled: bool,
) -> Result<MutationResult<SkillToggle>> {
    let skill = state.skill(&agent_id, &skill_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter.set_skill_enabled(&context, &skill, enabled).await?;

    let report = state.scan().await;
    Ok(MutationResult::new(
        SkillToggle {
            skill_id,
            name: skill.name,
            enabled,
            path: skill.path,
        },
        report,
    ))
}
