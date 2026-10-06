//! Claude Code specialisation.
//!
//! Almost everything about Claude Code is declarative, but two behaviours cannot be
//! expressed in a manifest:
//!
//! 1. **Two MCP sources.** User scope servers live in `~/.claude.json`; the CLI also
//!    honours `mcpServers` in `~/.claude/settings.json`. Only the first is declared in
//!    the manifest (so it is the only one Ahabby may ever *write*); servers coming from
//!    the second source are surfaced read-only.
//! 2. **Plugin skills.** Skills installed under `~/.claude/plugins/**` are owned by the
//!    plugin manager. Deleting them from a file manager would corrupt the installation,
//!    so they are listed but marked as not removable.

use async_trait::async_trait;

use crate::domain::{
    AgentManifest, ConfigFile, ConfigFormat, Detection, InstallAction, InstallPlan, McpServer,
    McpSpec, OsPathMap, OtherResource, Skill, Version,
};
use crate::error::Result;
use crate::platform::PlatformContext;

use super::manifest_adapter::ManifestAdapter;
use super::AgentAdapter;

/// Marker inside a skill path that means "managed by the plugin system".
const PLUGIN_MARKER: &str = "/plugins/";

pub struct ClaudeAdapter {
    inner: ManifestAdapter,
}

impl ClaudeAdapter {
    pub fn new(manifest: AgentManifest) -> Self {
        Self {
            inner: ManifestAdapter::new(manifest),
        }
    }

    /// The second, read-only MCP source of Claude Code.
    fn settings_mcp_spec() -> McpSpec {
        McpSpec {
            format: ConfigFormat::Json,
            path: OsPathMap {
                windows: Some("${USERPROFILE}/.claude/settings.json".to_string()),
                macos: Some("${HOME}/.claude/settings.json".to_string()),
                linux: Some("${HOME}/.claude/settings.json".to_string()),
            },
            glob: None,
            key_path: vec!["mcpServers".to_string()],
            entry_shape: crate::domain::McpEntryShape::Command,
            description: Some(
                "MCP servers defined in settings.json (read-only: managed by the Claude Code CLI)"
                    .to_string(),
            ),
            shared_with_config: false,
        }
    }
}

#[async_trait]
impl AgentAdapter for ClaudeAdapter {
    fn manifest(&self) -> &AgentManifest {
        self.inner.manifest()
    }

    async fn detect(&self, ctx: &PlatformContext) -> Result<Option<Detection>> {
        self.inner.detect(ctx).await
    }

    async fn version(&self, ctx: &PlatformContext, detection: &Detection) -> Option<Version> {
        self.inner.version(ctx, detection).await
    }

    async fn config_files(&self, ctx: &PlatformContext) -> Result<Vec<ConfigFile>> {
        self.inner.config_files(ctx).await
    }

    async fn list_skills(&self, ctx: &PlatformContext) -> Result<Vec<Skill>> {
        let mut skills = self.inner.list_skills(ctx).await?;
        for skill in &mut skills {
            if skill.path.replace('\\', "/").contains(PLUGIN_MARKER) {
                skill.removable = false;
                if let Some(description) = &mut skill.description {
                    description.push_str(" (plugin-managed)");
                } else {
                    skill.description = Some("Plugin-managed skill".to_string());
                }
            }
        }
        Ok(skills)
    }

    async fn list_mcp_servers(&self, ctx: &PlatformContext) -> Result<Vec<McpServer>> {
        let mut servers = self.inner.list_mcp_servers(ctx).await?;

        let mut extra = self.inner.read_mcp_spec(ctx, &Self::settings_mcp_spec())?;
        for server in &mut extra {
            // Read-only: this file is owned by the CLI, and the manifest never declared it
            // as writable, so removal is impossible by construction.
            server.removable = false;
        }

        let known: Vec<String> = servers.iter().map(|server| server.name.clone()).collect();
        servers.extend(
            extra
                .into_iter()
                .filter(|server| !known.contains(&server.name)),
        );

        servers.sort_by_key(|a| a.name.to_lowercase());
        Ok(servers)
    }

    async fn list_other_resources(&self, ctx: &PlatformContext) -> Result<Vec<OtherResource>> {
        self.inner.list_other_resources(ctx).await
    }

    async fn remove_skill(&self, ctx: &PlatformContext, skill: &Skill) -> Result<()> {
        self.inner.remove_skill(ctx, skill).await
    }

    async fn remove_mcp_server(&self, ctx: &PlatformContext, server: &McpServer) -> Result<()> {
        self.inner.remove_mcp_server(ctx, server).await
    }

    async fn set_skill_enabled(
        &self,
        ctx: &PlatformContext,
        skill: &Skill,
        enabled: bool,
    ) -> Result<()> {
        self.inner.set_skill_enabled(ctx, skill, enabled).await
    }

    async fn set_mcp_server_enabled(
        &self,
        ctx: &PlatformContext,
        server: &McpServer,
        enabled: bool,
    ) -> Result<()> {
        self.inner
            .set_mcp_server_enabled(ctx, server, enabled)
            .await
    }

    async fn create_skill(
        &self,
        ctx: &PlatformContext,
        draft: &crate::domain::SkillDraft,
    ) -> Result<Skill> {
        self.inner.create_skill(ctx, draft).await
    }

    /// New servers go to the declared `~/.claude.json`; the read-only `settings.json` source
    /// is never written, exactly like removal and the on/off switch.
    async fn create_mcp_server(
        &self,
        ctx: &PlatformContext,
        draft: &crate::domain::McpServerDraft,
    ) -> Result<McpServer> {
        self.inner.create_mcp_server(ctx, draft).await
    }

    async fn install_plan(
        &self,
        ctx: &PlatformContext,
        action: InstallAction,
        method_id: Option<&str>,
    ) -> Result<InstallPlan> {
        self.inner.install_plan(ctx, action, method_id).await
    }
}
