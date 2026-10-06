//! Tauri commands: input validation plus a call into a service. No business logic here.
//!
//! Every command that can change something on disk returns the refreshed [`ScanReport`]
//! alongside its own result, so the UI never has to guess what the truth on disk is now.

pub mod agents;
pub mod configs;
pub mod install;
pub mod mcp;
pub mod projects;
pub mod settings;
pub mod skills;
pub mod terminal;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, Result};
use crate::services::ScanReport;

/// A mutation result plus the state of the world afterwards.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct MutationResult<T>
where
    T: TS,
{
    /// Payload of the mutation (a save result, removal details, ...).
    pub data: T,
    /// Fresh scan, so the UI never shows a stale file list.
    pub report: ScanReport,
}

impl<T: TS> MutationResult<T> {
    pub fn new(data: T, report: ScanReport) -> Self {
        Self { data, report }
    }
}

/// Refuses a destructive command that the frontend did not ask to confirm.
///
/// Every command that deletes something or executes a resolved installer takes a `confirm`
/// argument and passes it here, so a UI that forgets its dialog cannot silently delete or
/// install: the frontend always sends an agent id, never a command line, and this is the
/// second half of that contract.
pub fn require_confirmation(confirm: bool, action: &str) -> Result<()> {
    if confirm {
        return Ok(());
    }
    Err(AppError::InvalidInput(format!(
        "{action} requires explicit confirmation"
    )))
}

#[cfg(test)]
mod tests {
    use super::require_confirmation;
    use crate::error::AppError;

    #[test]
    fn unconfirmed_actions_are_refused_with_a_stable_code() {
        assert!(require_confirmation(true, "deleting a skill").is_ok());

        let error = require_confirmation(false, "deleting a skill").unwrap_err();
        // The UI branches on `code`, never on the message.
        assert!(matches!(error, AppError::InvalidInput(_)));
        assert!(error.to_string().contains("deleting a skill"));
    }
}

/// What `delete_skill` removed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SkillRemoval {
    pub removed_skill_id: String,
    pub name: String,
    /// Where it used to live (now moved to the OS trash).
    pub path: String,
    pub trashed: bool,
}

/// What `delete_mcp_server` removed.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct McpRemoval {
    pub removed_server_id: String,
    pub name: String,
    /// Config file it was removed from.
    pub config: String,
}

/// What `set_skill_enabled` switched.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SkillToggle {
    pub skill_id: String,
    pub name: String,
    /// The state the skill is in now.
    pub enabled: bool,
    /// Where it lives: the skill directory, or the file itself for a document.
    pub path: String,
}

/// What `set_mcp_server_enabled` switched.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct McpToggle {
    pub server_id: String,
    pub name: String,
    /// The state the server is in now.
    pub enabled: bool,
    /// Config file the entry was moved inside.
    pub config: String,
}
