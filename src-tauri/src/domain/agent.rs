use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::config::ConfigFile;
use super::manifest::ManifestSource;
use super::mcp::McpServer;
use super::resource::OtherResource;
use super::skill::Skill;
use super::version::Version;
use super::{AgentManifest, Manager, Os};

/// Lightweight agent reference embedded in skills / MCP servers / configs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct AgentRef {
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum AgentStatus {
    /// The executable was found.
    Installed,
    /// Not found: either not installed, or installed somewhere Ahabby does not know about.
    NotInstalled,
}

/// Where the binary was found.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Detection {
    pub binary_path: String,
    /// `path` when it came from `PATH`, otherwise the manifest search path that matched.
    pub found_in: String,
    /// Which install manager that location belongs to, when recognisable.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager: Option<Manager>,
}

/// One way to install (or update) an agent, already checked against this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct InstallOption {
    pub id: String,
    pub manager: Manager,
    /// Exact command line the user will be asked to confirm.
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update_command: Option<String>,
    #[serde(default)]
    pub requires: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// `true` when the required package manager is actually present on this machine.
    pub available: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unavailable_reason: Option<String>,
    /// `true` when this looks like the method the agent was installed with.
    pub detected: bool,
}

/// Optional "a newer version exists" information.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct UpdateInfo {
    pub latest: String,
    /// `npm` or `github`, for the UI tooltip.
    pub source: String,
    #[ts(type = "number")]
    pub checked_at_ms: i64,
}

/// The fully scanned agent — the main entity of the UI.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Agent {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    /// Who publishes the agent (from the manifest) — shown on the agent's own page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// Short highlights from the manifest — shown on the agent's own page.
    #[serde(default)]
    pub features: Vec<String>,
    /// `owner/repo`, used for the repository link and the version check.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<String>,
    pub popular: bool,
    pub status: AgentStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub binary_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub found_in: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<Version>,
    /// Method Ahabby *thinks* the agent was installed with (from the binary location).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_via: Option<String>,
    pub install_options: Vec<InstallOption>,
    /// `true` when at least one install option is available on this machine.
    pub can_install: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_docs_url: Option<String>,
    /// `true` when the manifest tells us how to update this agent.
    pub can_update: bool,
    pub configs: Vec<ConfigFile>,
    pub skills: Vec<Skill>,
    pub mcp_servers: Vec<McpServer>,
    pub other: Vec<OtherResource>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub update: Option<UpdateInfo>,
    /// Dotted manifest paths that still need a docs check (see `ARCHITECTURE.md`).
    #[serde(default)]
    pub unverified: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    pub manifest_source: ManifestSource,
    /// Non-fatal problems collected while reading this agent (bad config, missing dir, ...).
    #[serde(default)]
    pub warnings: Vec<String>,
    #[ts(type = "number")]
    pub scan_ms: u64,
}

impl Agent {
    pub fn is_installed(&self) -> bool {
        matches!(self.status, AgentStatus::Installed)
    }

    pub fn ref_of(manifest: &AgentManifest) -> AgentRef {
        AgentRef {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            icon: manifest.icon.clone(),
        }
    }
}

/// A resolved, executable plan. This is the only thing the UI can ask the backend to run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum InstallAction {
    Install,
    Update,
    Uninstall,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct InstallPlan {
    pub agent_id: String,
    pub agent_name: String,
    pub action: InstallAction,
    pub method_id: String,
    pub manager: Manager,
    pub program: String,
    pub args: Vec<String>,
    /// Exactly what the user will confirm, with quoting preserved.
    pub display_command: String,
    /// `true` when the command is executed through the platform shell (script methods).
    pub uses_shell: bool,
    pub manager_available: bool,
    pub warnings: Vec<String>,
    pub target_os: Os,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_ref_is_derived_from_manifest() {
        let manifest = toml_edit::de::from_str::<AgentManifest>(
            r#"
id = "demo"
name = "Demo"
description = "d"
icon = "demo"

[binaries]
names = ["demo"]
"#,
        )
        .unwrap();
        let reference = Agent::ref_of(&manifest);
        assert_eq!(reference.id, "demo");
        assert_eq!(reference.icon.as_deref(), Some("demo"));
    }
}
