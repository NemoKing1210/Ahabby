use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::config::ConfigFormat;
use super::manifest::OtherKind;
use super::scope::Scope;

/// Everything that is neither a config file nor a skill nor an MCP server:
/// instructions (`CLAUDE.md`, `AGENTS.md`), slash commands, sub-agents, hooks, rules.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct OtherResource {
    pub id: String,
    pub kind: OtherKind,
    pub label: String,
    pub path: String,
    pub agent: AgentRef,
    pub scope: Scope,
    pub format: ConfigFormat,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Markdown/text preview for files small enough to show inline.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    pub is_directory: bool,
    pub exists: bool,
    /// Number of entries inside a directory resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub item_count: Option<usize>,
    pub unverified: bool,
}
