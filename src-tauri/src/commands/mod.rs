//! Tauri commands: input validation plus a call into a service. No business logic here.
//!
//! Every command that can change something on disk returns the refreshed [`ScanReport`]
//! alongside its own result, so the UI never has to guess what the truth on disk is now.

pub mod agents;
pub mod configs;
pub mod install;
pub mod mcp;
pub mod settings;
pub mod skills;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

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
