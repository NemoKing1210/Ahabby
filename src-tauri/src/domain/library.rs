use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::catalog::CatalogProblem;
use super::mcp::McpServer;
use super::resource::OtherResource;
use super::skill::Skill;

#[derive(Debug, Clone, Copy, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct LibraryStats {
    pub agents: usize,
    pub installed_agents: usize,
    pub skills: usize,
    pub mcp_servers: usize,
    pub other: usize,
}

/// Aggregated view across every agent: the "Library" tab.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Library {
    pub skills: Vec<Skill>,
    pub mcp_servers: Vec<McpServer>,
    pub other: Vec<OtherResource>,
    pub stats: LibraryStats,
    #[ts(type = "number")]
    pub scanned_at_ms: i64,
    pub problems: Vec<CatalogProblem>,
}
