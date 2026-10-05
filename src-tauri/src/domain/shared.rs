use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::{ConfigFile, McpServer, OtherResource, Skill};

/// Id of the synthetic owner of every resource discovered in an agent-neutral location.
///
/// Ahabby describes the shared surface itself as a manifest with this id (see
/// `catalog/shared.toml`), and the id is reserved: `catalog::loader` refuses a user manifest
/// that claims it, so it can never collide with a real agent. The frontend mirrors the
/// constant in `src/shared/lib/owners.ts`.
pub const SHARED_OWNER_ID: &str = "shared";

/// Resources that belong to no single agent: global skills, MCP servers and documents every
/// installed agent can read (`~/.agents/skills`, `~/.agents/mcp.json`, `~/.agents/AGENTS.md`).
///
/// They travel with the scan report so the Library can show them next to the per-agent
/// resources, and so the backend can resolve them for reading, editing and deletion.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SharedResources {
    /// Files the shared surface declares. They are not listed in the Library, but they are
    /// addressable documents — that is how a secret of the shared `mcp.json` is revealed.
    #[serde(default)]
    pub configs: Vec<ConfigFile>,
    #[serde(default)]
    pub skills: Vec<Skill>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServer>,
    #[serde(default)]
    pub other: Vec<OtherResource>,
    /// Resolved roots of the shared surface. A resource an agent manifest also declares
    /// under one of them is reported as shared only, never twice.
    #[serde(default)]
    pub roots: Vec<String>,
}
