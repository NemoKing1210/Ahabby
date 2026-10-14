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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{McpDraftTransport, McpServerDraft, Os};
    use crate::error::AppError;
    use std::fs;
    use std::path::{Path, PathBuf};

    /// The manifest users actually get: both specialised behaviours are about what the
    /// *shipped* catalog entry declares — `~/.claude.json` as its only MCP source and
    /// `~/.claude/skills` as its skills root — so a fixture manifest here would prove
    /// nothing about Claude Code.
    const MANIFEST: &str = include_str!("../../catalog/builtin/claude-code.toml");

    struct Fixture {
        _root: tempfile::TempDir,
        home: PathBuf,
        app_data: PathBuf,
        app_config: PathBuf,
    }

    impl Fixture {
        fn new() -> Self {
            let root = tempfile::tempdir().expect("temp dir");
            let home = root.path().join("home");
            let app_data = root.path().join("appdata");
            let app_config = root.path().join("appconfig");
            for directory in [&home, &app_data, &app_config] {
                fs::create_dir_all(directory).unwrap();
            }
            Self {
                _root: root,
                home,
                app_data,
                app_config,
            }
        }

        fn context(&self) -> PlatformContext {
            PlatformContext::for_tests(Os::current(), &self.home, &self.app_data, &self.app_config)
        }

        fn adapter() -> ClaudeAdapter {
            let manifest = crate::catalog::parse_manifest(MANIFEST, "claude-code")
                .expect("the shipped manifest parses");
            ClaudeAdapter::new(manifest)
        }

        /// The declared, writable MCP source.
        fn claude_json(&self) -> PathBuf {
            self.home.join(".claude.json")
        }

        /// The undeclared second source, which is also the `user-settings` config file.
        fn settings_json(&self) -> PathBuf {
            self.home.join(".claude").join("settings.json")
        }

        fn write(&self, path: &Path, text: &str) {
            fs::create_dir_all(path.parent().expect("a file path has a parent")).unwrap();
            fs::write(path, text).unwrap();
        }
    }

    /// Expanded manifest paths carry the platform's separator, so comparisons normalise
    /// instead of hard-coding `/` or `\`.
    fn at_path(actual: &str, expected: &Path) -> bool {
        actual.replace('\\', "/") == expected.to_string_lossy().replace('\\', "/")
    }

    fn write_skill(directory: &Path, name: &str, description: Option<&str>) {
        fs::create_dir_all(directory).unwrap();
        let frontmatter = match description {
            Some(text) => format!("---\nname: {name}\ndescription: {text}\n---\n"),
            // Neither frontmatter description nor body: the reader reports `None`, which is
            // the case the adapter has to fill in itself.
            None => format!("---\nname: {name}\n---\n"),
        };
        fs::write(directory.join("SKILL.md"), frontmatter).unwrap();
    }

    fn skill<'a>(skills: &'a [Skill], name: &str) -> Option<&'a Skill> {
        skills.iter().find(|skill| skill.name == name)
    }

    fn server<'a>(servers: &'a [McpServer], name: &str) -> Option<&'a McpServer> {
        servers.iter().find(|server| server.name == name)
    }

    fn stdio(command: &str, args: &[&str]) -> McpDraftTransport {
        McpDraftTransport::Stdio {
            command: command.to_string(),
            args: args.iter().map(|arg| arg.to_string()).collect(),
            env: Vec::new(),
        }
    }

    /// A plugin-managed skill is listed — the user can see what the plugin brought — but every
    /// write path refuses it: the plugin manager owns those files, and deleting one would break
    /// the installation it came with.
    #[tokio::test]
    async fn plugin_skills_are_listed_but_never_writable() {
        let fixture = Fixture::new();
        // The marker is read out of the path, and the path arrives with the platform's
        // separator — so this pins the `\` → `/` normalisation the check relies on.
        let described = fixture.home.join(".claude/skills/plugins/acme/review");
        let bare = fixture.home.join(".claude/skills/plugins/acme/bare");
        let personal = fixture.home.join(".claude/skills/pdf");
        write_skill(&described, "review", Some("Review pull requests."));
        write_skill(&bare, "bare", None);
        write_skill(&personal, "pdf", Some("Read and fill PDF forms."));

        let ctx = fixture.context();
        let adapter = Fixture::adapter();
        let skills = adapter.list_skills(&ctx).await.unwrap();

        let plugin = skill(&skills, "review").expect("a plugin skill stays listed");
        assert!(!plugin.removable);
        assert_eq!(
            plugin.description.as_deref(),
            Some("Review pull requests. (plugin-managed)"),
            "the skill's own description survives, with the note appended"
        );

        let bare = skill(&skills, "bare").expect("listed as well");
        assert!(!bare.removable);
        assert_eq!(bare.description.as_deref(), Some("Plugin-managed skill"));

        let personal = skill(&skills, "pdf").expect("a personal skill is listed too");
        assert!(
            personal.removable,
            "outside /plugins/ the inner adapter's verdict stands"
        );
        assert_eq!(
            personal.description.as_deref(),
            Some("Read and fill PDF forms."),
            "an ordinary skill is not annotated"
        );

        let removed = adapter.remove_skill(&ctx, plugin).await;
        assert!(
            matches!(removed, Err(AppError::NotSupported(_))),
            "{removed:?}"
        );
        let toggled = adapter.set_skill_enabled(&ctx, plugin, false).await;
        assert!(
            matches!(toggled, Err(AppError::NotSupported(_))),
            "{toggled:?}"
        );
        assert!(
            described.join("SKILL.md").is_file(),
            "a refused delete leaves the plugin's files untouched"
        );
    }

    /// Servers come from the declared `~/.claude.json` and from the `mcpServers` object of
    /// `~/.claude/settings.json`, which the manifest deliberately does not declare as writable.
    #[tokio::test]
    async fn servers_come_from_both_files_but_only_the_declared_one_is_written() {
        let fixture = Fixture::new();
        fixture.write(
            &fixture.claude_json(),
            r#"{
  "theme": "dark",
  "mcpServers": {
    "zeta": { "command": "node", "args": ["zeta.js"] },
    "github": { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"] }
  }
}
"#,
        );
        fixture.write(
            &fixture.settings_json(),
            r#"{
  "mcpServers": {
    "alpha": { "command": "npx", "args": ["server-alpha"] },
    "Beta": { "type": "sse", "url": "https://example.com/sse" },
    "github": { "command": "npx", "args": ["-y", "settings-github"] }
  }
}
"#,
        );

        let ctx = fixture.context();
        let adapter = Fixture::adapter();
        let servers = adapter.list_mcp_servers(&ctx).await.unwrap();

        let names: Vec<&str> = servers.iter().map(|entry| entry.name.as_str()).collect();
        assert_eq!(
            names,
            ["alpha", "Beta", "github", "zeta"],
            "one row per name, sorted case-insensitively"
        );

        // A name that exists in both files is reported once, from the file Ahabby may write.
        let github = server(&servers, "github").unwrap();
        assert!(at_path(&github.source_config, &fixture.claude_json()));
        assert!(github.removable);

        for name in ["alpha", "Beta"] {
            let extra = server(&servers, name).unwrap();
            assert!(
                at_path(&extra.source_config, &fixture.settings_json()),
                "{name} is read from settings.json"
            );
            assert!(!extra.removable, "{name} must never be writable");
        }

        // The bytes of settings.json are the yardstick: no write of any kind may change them.
        let untouched = fs::read(fixture.settings_json()).unwrap();

        let created = adapter
            .create_mcp_server(
                &ctx,
                &McpServerDraft {
                    name: "newone".to_string(),
                    transport: stdio("npx", &["-y", "server-new"]),
                },
            )
            .await
            .unwrap();
        assert!(at_path(&created.source_config, &fixture.claude_json()));
        assert_eq!(fs::read(fixture.settings_json()).unwrap(), untouched);
        assert_eq!(adapter.list_mcp_servers(&ctx).await.unwrap().len(), 5);

        adapter.remove_mcp_server(&ctx, &created).await.unwrap();
        assert_eq!(fs::read(fixture.settings_json()).unwrap(), untouched);
        assert_eq!(adapter.list_mcp_servers(&ctx).await.unwrap().len(), 4);
        let declared = fs::read_to_string(fixture.claude_json()).unwrap();
        assert!(!declared.contains("newone"), "{declared}");
        assert!(
            declared.contains("\"theme\""),
            "the rest of the file is kept"
        );

        let listed = adapter.list_mcp_servers(&ctx).await.unwrap();
        let github = server(&listed, "github").unwrap().clone();
        adapter
            .set_mcp_server_enabled(&ctx, &github, false)
            .await
            .unwrap();
        assert_eq!(fs::read(fixture.settings_json()).unwrap(), untouched);
        let declared = fs::read_to_string(fixture.claude_json()).unwrap();
        assert!(declared.contains("mcpServersDisabled"), "{declared}");

        // Every write on a server that only settings.json declares is refused — before the
        // path is even considered.
        let listed = adapter.list_mcp_servers(&ctx).await.unwrap();
        let alpha = server(&listed, "alpha").unwrap().clone();
        let removed = adapter.remove_mcp_server(&ctx, &alpha).await;
        assert!(
            matches!(removed, Err(AppError::NotSupported(_))),
            "{removed:?}"
        );
        let toggled = adapter.set_mcp_server_enabled(&ctx, &alpha, false).await;
        assert!(
            matches!(toggled, Err(AppError::NotSupported(_))),
            "{toggled:?}"
        );
        assert_eq!(fs::read(fixture.settings_json()).unwrap(), untouched);
    }

    /// Both MCP sources are optional: a file that exists without the container, and a file
    /// that is not there at all, mean "no servers here" rather than an error.
    #[tokio::test]
    async fn absent_containers_and_missing_files_are_not_errors() {
        let fixture = Fixture::new();
        fixture.write(&fixture.claude_json(), "{\n  \"theme\": \"dark\"\n}\n");
        assert!(!fixture.settings_json().exists());

        let ctx = fixture.context();
        let adapter = Fixture::adapter();
        assert!(adapter.list_mcp_servers(&ctx).await.unwrap().is_empty());

        // settings.json exists but declares no servers either: still nothing, still no error.
        fixture.write(&fixture.settings_json(), "{\n  \"permissions\": {}\n}\n");
        assert!(adapter.list_mcp_servers(&ctx).await.unwrap().is_empty());

        // Creating the first server puts the container into the declared file only.
        let before = fs::read(fixture.settings_json()).unwrap();
        let created = adapter
            .create_mcp_server(
                &ctx,
                &McpServerDraft {
                    name: "linear".to_string(),
                    transport: stdio("npx", &["-y", "server-linear"]),
                },
            )
            .await
            .unwrap();
        assert!(at_path(&created.source_config, &fixture.claude_json()));
        assert_eq!(fs::read(fixture.settings_json()).unwrap(), before);

        let listed = adapter.list_mcp_servers(&ctx).await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].name, "linear");
        assert!(listed[0].removable);
    }
}
