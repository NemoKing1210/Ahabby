//! End-to-end test of the read path and of every write path, without a Tauri app handle.
//!
//! It exercises exactly the sequence the commands perform: catalog → adapter → scanner →
//! library → edit/delete → install plan, against a synthetic home directory. This is the
//! proof that "adding an agent needs only a manifest" holds for the real pipeline, because
//! the agent used here exists nowhere in the shipped catalog.

use std::fs;
use std::path::{Path, PathBuf};

use ahabby_lib::adapters::doc_edit;
use ahabby_lib::catalog;
use ahabby_lib::domain::{AgentStatus, ConfigFormat, InstallAction, Manager, Os, Severity};
use ahabby_lib::platform::PlatformContext;
use ahabby_lib::services::{self, aggregate, Scanner};

const MANIFEST: &str = r#"
id = "pipeline-demo"
name = "Pipeline Demo"
description = "Fixture agent that only exists inside this test."
website = "https://example.com"
docs = "https://example.com/docs"
icon = "pipeline"
category = "cli"
popular = true
unverified = ["skills.path"]
notes = "Created by tests/pipeline.rs"

[binaries]
names = ["pipeline-demo"]
version_args = ["--version"]

[[search_paths]]
windows = ["${HOME}/bin"]
macos = ["${HOME}/bin"]
linux = ["${HOME}/bin"]

[[configs]]
id = "settings"
label = "Settings"
format = "json"
path = { windows = "${HOME}/.pipeline/settings.json", macos = "${HOME}/.pipeline/settings.json", linux = "${HOME}/.pipeline/settings.json" }

[skills]
format = "skillMd"
glob = "**/SKILL.md"
path = { windows = "${HOME}/.pipeline/skills", macos = "${HOME}/.pipeline/skills", linux = "${HOME}/.pipeline/skills" }

[mcp]
format = "json"
key_path = ["mcpServers"]
shared_with_config = true
path = { windows = "${HOME}/.pipeline/settings.json", macos = "${HOME}/.pipeline/settings.json", linux = "${HOME}/.pipeline/settings.json" }

[[other]]
id = "instructions"
kind = "instructions"
label = "AGENTS.md"
format = "markdown"
path = { windows = "${HOME}/.pipeline/AGENTS.md", macos = "${HOME}/.pipeline/AGENTS.md", linux = "${HOME}/.pipeline/AGENTS.md" }

[[methods]]
id = "official-script"
manager = "script"
command = "curl -fsSL https://example.com/install.sh | sh"
update_command = "pipeline-demo self-update"
docs_url = "https://example.com/docs/install"
priority = 0

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g pipeline-demo"
update_command = "npm install -g pipeline-demo@latest"
priority = 1
"#;

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
        fs::create_dir_all(&home).unwrap();
        fs::create_dir_all(&app_data).unwrap();
        fs::create_dir_all(&app_config).unwrap();
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

    fn write_binary(&self, version: &str) {
        let bin_dir = self.home.join("bin");
        fs::create_dir_all(&bin_dir).unwrap();
        if cfg!(windows) {
            fs::write(
                bin_dir.join("pipeline-demo.cmd"),
                format!("@echo off\r\necho {version} (Pipeline Demo)\r\n"),
            )
            .unwrap();
        } else {
            let path = bin_dir.join("pipeline-demo");
            fs::write(
                &path,
                format!("#!/bin/sh\necho \"{version} (Pipeline Demo)\"\n"),
            )
            .unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&path, fs::Permissions::from_mode(0o755)).unwrap();
            }
        }
    }

    /// Writes the manifest into the *user* catalog directory.
    fn write_manifest(&self) -> PathBuf {
        let dir = self.app_config.join("catalog");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("pipeline-demo.toml");
        fs::write(&path, MANIFEST).unwrap();
        path
    }

    fn settings_json(&self) -> PathBuf {
        self.home.join(".pipeline").join("settings.json")
    }

    fn write_agent_files(&self) {
        let agent_dir = self.home.join(".pipeline");
        fs::create_dir_all(agent_dir.join("skills/pdf")).unwrap();
        fs::write(
            agent_dir.join("settings.json"),
            r#"{
  "theme": "dark",
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_do_not_leak_me" }
    },
    "linear": { "type": "sse", "url": "https://mcp.linear.app/sse" }
  }
}
"#,
        )
        .unwrap();
        fs::write(
            agent_dir.join("skills/pdf/SKILL.md"),
            "---\nname: pdf\ndescription: Read and fill PDF forms\n---\n\n# PDF\n\nUse pdftotext.\n",
        )
        .unwrap();
        fs::write(
            agent_dir.join("AGENTS.md"),
            "# Agent rules\n\nBe careful.\n",
        )
        .unwrap();
    }
}

fn catalog_for(fixture: &Fixture) -> catalog::Catalog {
    catalog::load(Some(&fixture.app_config.join("catalog")))
}

#[tokio::test]
async fn full_read_pipeline_from_a_user_manifest() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("4.2.1");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    assert!(
        catalog.problems.is_empty(),
        "user manifest problems: {:#?}",
        catalog.problems
    );
    let manifest = catalog.get("pipeline-demo").expect("user manifest loaded");
    assert!(matches!(
        manifest.source,
        ahabby_lib::domain::ManifestSource::User { .. }
    ));

    let scanner = Scanner::new(&catalog);
    let report = scanner.scan(&fixture.context(), None, &[]).await;

    let agent = report.agent("pipeline-demo").expect("agent scanned");
    assert_eq!(agent.status, AgentStatus::Installed);
    assert_eq!(agent.version.as_ref().unwrap().raw, "4.2.1");
    assert_eq!(agent.version.as_ref().unwrap().major, 4);
    assert_eq!(agent.unverified, vec!["skills.path".to_string()]);
    assert!(agent.warnings.is_empty(), "warnings: {:?}", agent.warnings);

    // Configs
    assert_eq!(agent.configs.len(), 1);
    assert!(agent.configs[0].exists);

    // Skills
    assert_eq!(agent.skills.len(), 1);
    assert_eq!(agent.skills[0].name, "pdf");
    assert_eq!(
        agent.skills[0].description.as_deref(),
        Some("Read and fill PDF forms")
    );
    assert!(agent.skills[0]
        .content
        .as_deref()
        .unwrap()
        .contains("pdftotext"));

    // MCP, with the secret masked at the source
    assert_eq!(agent.mcp_servers.len(), 2);
    let github = agent
        .mcp_servers
        .iter()
        .find(|server| server.name == "github")
        .unwrap();
    assert!(github.has_secrets);
    assert_eq!(github.env[0].value, None);
    assert!(!github.raw.contains("ghp_do_not_leak_me"));
    assert!(github.removable);
    let linear = agent
        .mcp_servers
        .iter()
        .find(|server| server.name == "linear")
        .unwrap();
    assert_eq!(linear.transport.label(), "http");

    // Other resources
    assert_eq!(agent.other.len(), 1);
    assert_eq!(agent.other[0].label, "AGENTS.md");
    assert!(agent.other[0].exists);

    // Library aggregation sees the same documents
    let library = aggregate(&report);
    assert_eq!(library.stats.skills, 1);
    assert_eq!(library.stats.mcp_servers, 2);
    assert_eq!(library.skills[0].agents[0].id, "pipeline-demo");

    // Install options: the script method is always offered, npm only when npm exists.
    let script = agent
        .install_options
        .iter()
        .find(|option| option.manager == Manager::Script)
        .unwrap();
    assert!(script.available);
    assert!(agent.can_update);
}

#[tokio::test]
async fn install_plan_resolves_manifest_commands_only() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    let catalog = catalog_for(&fixture);
    let context = fixture.context();

    // The adapter refuses an unknown method id instead of inventing a command.
    let manifest = catalog.get("pipeline-demo").unwrap().clone();
    let error = ahabby_lib::adapters::manifest_adapter::plan_for(
        &manifest,
        &context,
        InstallAction::Install,
        Some("does-not-exist"),
    )
    .unwrap_err();
    assert_eq!(error.code(), "invalid_input");

    // The script method runs through the platform shell, and the user sees the exact text.
    let plan = ahabby_lib::adapters::manifest_adapter::plan_for(
        &manifest,
        &context,
        InstallAction::Install,
        Some("official-script"),
    )
    .unwrap();
    assert!(plan.uses_shell);
    assert_eq!(
        plan.display_command,
        "curl -fsSL https://example.com/install.sh | sh"
    );
    assert!(plan.program.contains("sh"));
    assert!(plan.manager_available);

    // Update uses `update_command`, not the install command.
    let update = ahabby_lib::adapters::manifest_adapter::plan_for(
        &manifest,
        &context,
        InstallAction::Update,
        Some("official-script"),
    )
    .unwrap();
    assert_eq!(update.display_command, "pipeline-demo self-update");

    // The npm method stays selectable but reports a missing manager instead of pretending.
    let npm = ahabby_lib::adapters::manifest_adapter::plan_for(
        &manifest,
        &context,
        InstallAction::Install,
        Some("npm"),
    )
    .unwrap();
    assert_eq!(npm.manager, Manager::Npm);
    assert!(!npm.uses_shell);
    assert_eq!(npm.program, "npm");
    assert_eq!(npm.args, vec!["install", "-g", "pipeline-demo"]);
}

#[tokio::test]
async fn editing_a_config_is_backed_up_and_stale_safe() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();
    let path = fixture.settings_json();
    let backup_root = fixture.context().backup_root;

    let snapshot = services::read_snapshot(&path, ConfigFormat::Json, true).unwrap();
    assert!(snapshot.exists);
    assert!(!snapshot.sha256.is_empty());

    // The diff the user is shown mentions both sides of the change.
    let edited = snapshot.content.replace("\"dark\"", "\"light\"");
    let preview = services::preview(&path, ConfigFormat::Json, &edited, &snapshot.sha256).unwrap();
    assert!(preview.in_sync);
    assert!(preview.errors.is_empty());
    assert!(preview.unified.contains("-\"dark\"") || preview.unified.contains("dark"));
    assert_eq!(preview.added, 1);
    assert_eq!(preview.removed, 1);

    // Invalid content never reaches the disk.
    let invalid = services::save(
        &path,
        ConfigFormat::Json,
        "{ nope",
        &snapshot.sha256,
        &backup_root,
    );
    assert!(invalid.is_err());
    assert_eq!(fs::read_to_string(&path).unwrap(), snapshot.content);

    // A file changed by someone else is refused.
    let stale = services::save(&path, ConfigFormat::Json, "{}", "deadbeef", &backup_root);
    assert_eq!(stale.unwrap_err().code(), "stale_file");

    // A valid write takes a backup and is reversible.
    let saved = services::save(
        &path,
        ConfigFormat::Json,
        &edited,
        &snapshot.sha256,
        &backup_root,
    )
    .unwrap();
    let backup = saved.backup_path.expect("backup created");
    assert!(Path::new(&backup).is_file());
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
    assert!(services::list_backups(&backup_root, &path).unwrap().len() == 1);

    let restored =
        services::restore(Path::new(&backup), &path, ConfigFormat::Json, &backup_root).unwrap();
    assert_eq!(fs::read_to_string(&path).unwrap(), snapshot.content);
    assert!(restored.backup_path.is_some(), "restore is reversible too");
}

#[tokio::test]
async fn removing_an_mcp_server_rewrites_only_that_entry() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();
    let path = fixture.settings_json();

    let servers = adapter.list_mcp_servers(&context).await.unwrap();
    let github = servers
        .iter()
        .find(|server| server.name == "github")
        .unwrap();

    adapter.remove_mcp_server(&context, github).await.unwrap();

    let updated = fs::read_to_string(&path).unwrap();
    assert!(!updated.contains("github"));
    assert!(updated.contains("linear"), "other servers survive");
    assert!(
        updated.contains("\"theme\": \"dark\""),
        "unrelated keys survive"
    );
    assert_eq!(
        services::list_backups(&context.backup_root, &path)
            .unwrap()
            .len(),
        1,
        "the removal is backed up"
    );

    // Removing the same server again fails cleanly instead of corrupting the file.
    let error = adapter
        .remove_mcp_server(&context, github)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "not_found");
}

#[tokio::test]
async fn removing_an_mcp_server_from_a_jsonc_file_keeps_the_comments() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    // A JSONC config with a commented-out server, exactly like Cursor's mcp.json.
    let agent_dir = fixture.home.join(".pipeline");
    fs::create_dir_all(&agent_dir).unwrap();
    let path = fixture.settings_json();
    fs::write(
        &path,
        r#"{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "server-github"] },
    "linear": { "url": "https://mcp.linear.app/sse" }
    // "chrome-devtools": { "command": "npx -y chrome-devtools-mcp@latest" }
  }
}
"#,
    )
    .unwrap();

    // Same fixture agent, but its MCP files are JSONC.
    let jsonc_manifest = MANIFEST.replace("format = \"json\"", "format = \"jsonc\"");
    let adapter = ahabby_lib::adapters::registry::create(
        toml_edit::de::from_str(&jsonc_manifest).expect("jsonc variant of the fixture manifest"),
    );
    let context = fixture.context();
    let servers = adapter.list_mcp_servers(&context).await.unwrap();
    assert_eq!(servers.len(), 2);

    let linear = servers
        .iter()
        .find(|server| server.name == "linear")
        .unwrap();
    adapter.remove_mcp_server(&context, linear).await.unwrap();

    let updated = fs::read_to_string(&path).unwrap();
    assert!(!updated.contains("\"linear\""));
    assert!(
        updated.contains("// \"chrome-devtools\""),
        "comments survive"
    );
    assert!(updated.contains("github"), "other servers survive");
    doc_edit::validate(ConfigFormat::Jsonc, &updated, "test").unwrap();
}

#[tokio::test]
async fn writes_are_refused_outside_declared_paths() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();

    // A skill whose path is outside the declared skills directory is never trashed.
    let mut skills = adapter.list_skills(&context).await.unwrap();
    assert_eq!(skills.len(), 1);
    let mut forged = skills.remove(0);
    forged.path = fixture
        .home
        .join("not-a-skill")
        .to_string_lossy()
        .to_string();
    let error = adapter.remove_skill(&context, &forged).await.unwrap_err();
    assert_eq!(error.code(), "command_not_allowed");
    assert!(fixture.home.join(".pipeline/skills/pdf").exists());

    // Same for an MCP server pointing at a file the manifest never declared.
    let mut servers = adapter.list_mcp_servers(&context).await.unwrap();
    let mut forged_server = servers.remove(0);
    forged_server.source_config = fixture
        .home
        .join("elsewhere.json")
        .to_string_lossy()
        .to_string();
    let error = adapter
        .remove_mcp_server(&context, &forged_server)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "command_not_allowed");
}

#[test]
fn document_edits_preserve_the_rest_of_the_file() {
    // TOML is edited through `toml_edit`, so comments and spacing survive.
    let content = "# my config\nmodel = \"gpt-5\"  # keep\n\n[mcp_servers.github]\ncommand = \"npx\"\n\n# trailing note\n[mcp_servers.linear]\ncommand = \"npx\"\n";
    let updated = doc_edit::remove_entry(
        ConfigFormat::Toml,
        content,
        &["mcp_servers".to_string(), "linear".to_string()],
    )
    .unwrap()
    .expect("entry removed");
    assert!(updated.contains("# my config"));
    assert!(updated.contains("# keep"));
    assert!(updated.contains("model = \"gpt-5\"  # keep"));
    assert!(!updated.contains("linear"));
    assert!(updated.contains("[mcp_servers.github]"));
    doc_edit::validate(ConfigFormat::Toml, &updated, "test").unwrap();
}

#[test]
fn shipped_catalog_is_valid_and_extensible() {
    // No user directory: only the embedded manifests.
    let catalog = catalog::load(None);
    assert!(
        catalog.problems.is_empty(),
        "builtin catalog problems: {:#?}",
        catalog.problems
    );
    assert!(
        catalog.manifests.len() >= 10,
        "expected the shipped catalog"
    );
    for manifest in &catalog.manifests {
        let errors: Vec<_> = manifest
            .validate()
            .into_iter()
            .filter(|problem| problem.severity == Severity::Error)
            .collect();
        assert!(
            errors.is_empty(),
            "{} should validate cleanly: {errors:?}",
            manifest.id
        );
    }
    // Every manifest that ships with the app is reachable through the scanner.
    let scanner = Scanner::new(&catalog);
    assert_eq!(scanner.registry().len(), catalog.manifests.len());
}
