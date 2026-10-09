//! End-to-end test of the read path and of every write path, without a Tauri app handle.
//!
//! It exercises exactly the sequence the commands perform: catalog → adapter → scanner →
//! library → edit/delete → install plan, against a synthetic home directory. This is the
//! proof that "adding an agent needs only a manifest" holds for the real pipeline, because
//! the agent used here exists nowhere in the shipped catalog.

use std::fs;
use std::path::{Path, PathBuf};

use ahabby_lib::adapters::doc_edit;
use ahabby_lib::adapters::AgentAdapter;
use ahabby_lib::catalog;
use ahabby_lib::domain::{
    AgentStatus, ConfigFormat, ExtensionAction, ExtensionKind, ExtensionManager, InstallAction,
    Manager, McpDraftTransport, McpKeyValue, McpServerDraft, Os, Severity, SkillDraft,
    SkillInstall, SkillInstallFile,
};
use ahabby_lib::platform::PlatformContext;
use ahabby_lib::services::{self, aggregate, Scanner};
use ahabby_lib::state::resolve_document;

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

[[extensions]]
id = "extensions"
format = "pi"
description = "Fixture extensions."
path = { windows = "${HOME}/.pipeline/extensions", macos = "${HOME}/.pipeline/extensions", linux = "${HOME}/.pipeline/extensions" }
settings = { windows = "${HOME}/.pipeline/settings.json", macos = "${HOME}/.pipeline/settings.json", linux = "${HOME}/.pipeline/settings.json" }
builtins = ["codemode"]

[[methods]]
id = "official-script"
manager = "script"
command = "curl -fsSL https://example.com/install.sh | sh"
update_command = "pipeline-demo self-update"
uninstall_command = "pipeline-demo self-uninstall"
docs_url = "https://example.com/docs/install"
priority = 0

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g pipeline-demo"
update_command = "npm install -g pipeline-demo@latest"
uninstall_command = "npm uninstall -g pipeline-demo"
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
  "packages": ["npm:demo-pkg@1.2.0"],
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

        // Extensions: one module the user dropped in, and one package the settings declare.
        fs::create_dir_all(agent_dir.join("extensions")).unwrap();
        fs::write(
            agent_dir.join("extensions/hello.ts"),
            "export default function () {}\n",
        )
        .unwrap();
        fs::create_dir_all(agent_dir.join("npm/node_modules/demo-pkg")).unwrap();
        fs::write(
            agent_dir.join("npm/node_modules/demo-pkg/package.json"),
            r#"{ "name": "demo-pkg", "version": "1.2.0", "description": "A demo package",
                 "license": "MIT", "pi": { "extensions": ["./src/index.ts"] } }"#,
        )
        .unwrap();
    }
}

/// One file of a Hub payload.
fn file(path: &str, text: &str) -> SkillInstallFile {
    SkillInstallFile {
        path: path.to_string(),
        bytes: text.as_bytes().to_vec(),
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
    let report = scanner.scan(&fixture.context(), None, &[], &[], None).await;

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

    // Extensions: the package the settings declare, the module in the extensions directory and
    // the built-in the manifest names.
    assert!(agent.extensions_supported);
    let package = agent
        .extensions
        .iter()
        .find(|extension| extension.name == "demo-pkg")
        .expect("declared package");
    assert_eq!(package.kind, ExtensionKind::Package);
    assert_eq!(package.manager, Some(ExtensionManager::Npm));
    assert_eq!(package.version.as_deref(), Some("1.2.0"));
    assert_eq!(package.description.as_deref(), Some("A demo package"));
    assert_eq!(package.resources.extensions, 1);
    assert!(package.can_update && package.can_remove && !package.can_toggle);

    let module = agent
        .extensions
        .iter()
        .find(|extension| extension.name == "hello")
        .expect("local module");
    assert_eq!(module.kind, ExtensionKind::Local);
    assert!(module.enabled && module.can_toggle && module.can_remove);
    assert!(module.entry_path.is_some());

    let builtin = agent
        .extensions
        .iter()
        .find(|extension| extension.name == "codemode")
        .expect("declared built-in");
    assert_eq!(builtin.kind, ExtensionKind::Builtin);
    assert!(!builtin.can_remove && !builtin.can_toggle);

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
async fn switching_a_local_extension_off_and_back_and_planning_a_package() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();
    let entry = fixture.home.join(".pipeline/extensions/hello.ts");

    let module = adapter
        .list_extensions(&context)
        .await
        .unwrap()
        .into_iter()
        .find(|extension| extension.name == "hello")
        .expect("local module");

    // Off renames the entry file, which is what the agent stops matching; the module stays in
    // the scan with its identity so the same switch can put it back.
    adapter
        .set_extension_enabled(&context, &module, false)
        .await
        .unwrap();
    assert!(!entry.exists());
    assert!(fixture
        .home
        .join(".pipeline/extensions/hello.ts.disabled")
        .is_file());

    let disabled = adapter
        .list_extensions(&context)
        .await
        .unwrap()
        .into_iter()
        .find(|extension| extension.name == "hello")
        .expect("switched-off module");
    assert!(!disabled.enabled);
    assert_eq!(disabled.id, module.id, "the id survives the switch");

    adapter
        .set_extension_enabled(&context, &disabled, true)
        .await
        .unwrap();
    assert!(entry.is_file());

    // A package is never trashed by Ahabby: it is the agent's own CLI that put it where it is.
    let package = adapter
        .list_extensions(&context)
        .await
        .unwrap()
        .into_iter()
        .find(|extension| extension.kind == ExtensionKind::Package)
        .expect("declared package");
    let error = adapter
        .remove_extension(&context, &package)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "not_supported");

    // …and the resolved command is what the job runner would run, with the declared source.
    let plan = adapter
        .extension_plan(&context, &package, ExtensionAction::Update)
        .await
        .unwrap();
    assert_eq!(plan.args, vec!["update", "npm:demo-pkg@1.2.0"]);
    assert_eq!(plan.action, InstallAction::Update);
    assert!(plan.manager_available);
    assert!(!plan.uses_shell);

    // A forged path is refused before anything is moved.
    let mut forged = module.clone();
    forged.path = Some(fixture.home.join("outside.ts").display().to_string());
    let error = adapter
        .remove_extension(&context, &forged)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "command_not_allowed");
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
async fn uninstall_plan_is_resolved_from_a_declared_uninstall_command() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    let catalog = catalog_for(&fixture);
    let context = fixture.context();
    let manifest = catalog.get("pipeline-demo").unwrap().clone();

    // With no method id the backend prefers a method that actually declares an uninstall.
    let plan = ahabby_lib::adapters::manifest_adapter::plan_for(
        &manifest,
        &context,
        InstallAction::Uninstall,
        Some("official-script"),
    )
    .unwrap();
    assert_eq!(plan.action, InstallAction::Uninstall);
    assert_eq!(plan.display_command, "pipeline-demo self-uninstall");
    assert!(plan.uses_shell, "the script method runs through the shell");

    // A method that does not declare an uninstall command is refused instead of guessing one.
    let mut without = manifest.clone();
    without.methods[0].uninstall_command = None;
    let error = ahabby_lib::adapters::manifest_adapter::plan_for(
        &without,
        &context,
        InstallAction::Uninstall,
        Some("official-script"),
    )
    .unwrap_err();
    assert_eq!(error.code(), "not_supported");
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
async fn a_backup_is_readable_and_deletable() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();
    let path = fixture.settings_json();
    let backup_root = fixture.context().backup_root;

    let snapshot = services::read_snapshot(&path, ConfigFormat::Json, true).unwrap();
    let edited = snapshot.content.replace("\"dark\"", "\"light\"");
    let saved = services::save(
        &path,
        ConfigFormat::Json,
        &edited,
        &snapshot.sha256,
        &backup_root,
    )
    .unwrap();
    let backup = PathBuf::from(saved.backup_path.expect("backup created"));

    // The comparison view reads exactly the version the write replaced.
    assert_eq!(services::read_backup(&backup).unwrap(), snapshot.content);
    assert_eq!(
        services::list_backups(&backup_root, &path).unwrap().len(),
        1
    );

    // Deleting goes through the same store: the copy is gone and the list shrinks.
    services::delete_backup(&backup_root, &path, &backup).unwrap();
    assert!(!backup.exists());
    assert!(services::list_backups(&backup_root, &path)
        .unwrap()
        .is_empty());
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
async fn switching_a_skill_off_renames_its_entry_file_and_back() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();
    let directory = fixture.home.join(".pipeline/skills/pdf");

    let skill = adapter.list_skills(&context).await.unwrap().remove(0);
    assert!(skill.enabled);
    adapter
        .set_skill_enabled(&context, &skill, false)
        .await
        .unwrap();

    // Agents look a skill up by the exact file name, so a renamed entry is a skill they no
    // longer see — while the file itself is untouched.
    assert!(!directory.join("SKILL.md").exists());
    assert!(directory.join("SKILL.md.disabled").is_file());
    assert!(fs::read_to_string(directory.join("SKILL.md.disabled"))
        .unwrap()
        .contains("pdftotext"));

    // It stays in the scan (the switch has to be able to go back) and keeps its identity.
    let disabled = adapter.list_skills(&context).await.unwrap();
    assert_eq!(disabled.len(), 1);
    assert!(!disabled[0].enabled);
    assert_eq!(disabled[0].id, skill.id, "the id survives the switch");
    assert_eq!(disabled[0].name, "pdf", "the name survives the switch");
    assert!(disabled[0]
        .entry_path
        .as_deref()
        .unwrap()
        .ends_with("SKILL.md.disabled"));

    adapter
        .set_skill_enabled(&context, &disabled[0], true)
        .await
        .unwrap();
    assert!(directory.join("SKILL.md").is_file());
    assert!(!directory.join("SKILL.md.disabled").exists());
    assert!(adapter.list_skills(&context).await.unwrap()[0].enabled);

    // A skill Ahabby is not allowed to touch (plugin-managed) is never renamed.
    let mut locked = skill.clone();
    locked.removable = false;
    let error = adapter
        .set_skill_enabled(&context, &locked, false)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "not_supported");
    assert!(directory.join("SKILL.md").is_file());
}

#[tokio::test]
async fn switching_an_mcp_server_off_moves_it_out_of_the_agents_view() {
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
        .unwrap()
        .clone();
    assert!(github.enabled);
    adapter
        .set_mcp_server_enabled(&context, &github, false)
        .await
        .unwrap();

    let read = || -> serde_json::Value {
        serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap()
    };
    let value = read();
    assert!(value["mcpServers"].get("github").is_none());
    assert!(value["mcpServersDisabled"]["github"].is_object());
    assert!(
        value["mcpServers"].get("linear").is_some(),
        "other servers stay"
    );
    assert_eq!(value["theme"], "dark", "unrelated keys stay");
    assert_eq!(
        value["mcpServersDisabled"]["github"]["env"]["GITHUB_PERSONAL_ACCESS_TOKEN"],
        "ghp_do_not_leak_me",
        "the entry keeps its secrets"
    );
    assert_eq!(
        services::list_backups(&context.backup_root, &path)
            .unwrap()
            .len(),
        1,
        "the switch is backed up"
    );

    // The switched-off server is still reported — with its enabled address and its id — so the
    // UI can switch it back on.
    let off = adapter
        .list_mcp_servers(&context)
        .await
        .unwrap()
        .into_iter()
        .find(|server| server.name == "github")
        .unwrap();
    assert!(!off.enabled);
    assert_eq!(off.id, github.id, "the id survives the switch");
    assert_eq!(
        off.key_path, github.key_path,
        "the address stays the enabled one"
    );
    assert_eq!(off.env[0].value, None, "secrets stay masked while off");

    adapter
        .set_mcp_server_enabled(&context, &off, true)
        .await
        .unwrap();
    assert!(read()["mcpServers"]["github"].is_object());

    // A switched-off server can still be removed for good.
    adapter
        .set_mcp_server_enabled(&context, &github, false)
        .await
        .unwrap();
    let off = adapter
        .list_mcp_servers(&context)
        .await
        .unwrap()
        .into_iter()
        .find(|server| server.name == "github")
        .unwrap();
    assert!(!off.enabled);
    adapter.remove_mcp_server(&context, &off).await.unwrap();
    assert!(read()["mcpServersDisabled"].get("github").is_none());
}

#[tokio::test]
async fn switching_an_mcp_server_off_in_jsonc_keeps_every_comment() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    let agent_dir = fixture.home.join(".pipeline");
    fs::create_dir_all(&agent_dir).unwrap();
    let path = fixture.settings_json();
    fs::write(
        &path,
        r#"{
  // keep me
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "server-github"] },
    "linear": { "url": "https://mcp.linear.app/sse" },
  }
}
"#,
    )
    .unwrap();

    let jsonc_manifest = MANIFEST.replace("format = \"json\"", "format = \"jsonc\"");
    let adapter = ahabby_lib::adapters::registry::create(
        toml_edit::de::from_str(&jsonc_manifest).expect("jsonc variant of the fixture manifest"),
    );
    let context = fixture.context();
    let servers = adapter.list_mcp_servers(&context).await.unwrap();
    let linear = servers
        .iter()
        .find(|server| server.name == "linear")
        .unwrap();
    adapter
        .set_mcp_server_enabled(&context, linear, false)
        .await
        .unwrap();

    let updated = fs::read_to_string(&path).unwrap();
    assert!(updated.contains("// keep me"), "comments survive the move");
    assert!(updated.contains("\"github\""), "other servers survive");
    assert!(
        updated.contains("mcpServersDisabled"),
        "the entry moved to the disabled object"
    );
    doc_edit::validate(ConfigFormat::Jsonc, &updated, "test").unwrap();

    let off = adapter
        .list_mcp_servers(&context)
        .await
        .unwrap()
        .into_iter()
        .find(|server| server.name == "linear")
        .unwrap();
    assert!(!off.enabled);
    assert_eq!(off.transport.label(), "http");

    adapter
        .set_mcp_server_enabled(&context, &off, true)
        .await
        .unwrap();
    let restored = fs::read_to_string(&path).unwrap();
    doc_edit::validate(ConfigFormat::Jsonc, &restored, "test").unwrap();
    assert!(restored.contains("// keep me"));
    let servers = adapter.list_mcp_servers(&context).await.unwrap();
    let linear = servers
        .iter()
        .find(|server| server.name == "linear")
        .unwrap();
    assert!(linear.enabled, "the entry is readable where it was before");
}

/// A new skill is written as `<skills dir>/<slug>/SKILL.md`, so it is switched on by default
/// and behaves like any scanned skill from the next scan on.
#[tokio::test]
async fn creating_a_skill_writes_a_ready_skill_md() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();

    let skill = adapter
        .create_skill(
            &context,
            &SkillDraft {
                name: "Release Notes".into(),
                description: Some("Summarise a release".into()),
                content: Some("# Release Notes\n\nRead the git log.".into()),
            },
        )
        .await
        .unwrap();

    assert_eq!(skill.name, "Release Notes");
    assert!(skill.enabled);
    assert!(skill.removable);
    let entry = fixture
        .home
        .join(".pipeline")
        .join("skills")
        .join("release-notes")
        .join("SKILL.md");
    assert_eq!(
        skill.entry_path.as_deref(),
        Some(entry.to_string_lossy().as_ref())
    );
    let text = fs::read_to_string(&entry).unwrap();
    assert!(text.starts_with("---\nname: Release Notes\ndescription: Summarise a release\n---\n"));
    assert!(text.contains("Read the git log."));

    // It is a first-class skill of the scan immediately: switched on, editable, deletable.
    let scanned = adapter.list_skills(&context).await.unwrap();
    let created = scanned
        .iter()
        .find(|candidate| candidate.name == "Release Notes")
        .expect("the new skill is scanned");
    assert!(created.enabled);
    assert!(created.removable);

    // The same name again is refused instead of overwriting the user's work.
    let error = adapter
        .create_skill(
            &context,
            &SkillDraft {
                name: "release notes".into(),
                description: None,
                content: None,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "invalid_input");

    // A name with nothing usable in it has no directory to create.
    let error = adapter
        .create_skill(
            &context,
            &SkillDraft {
                name: "   ".into(),
                description: None,
                content: None,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "invalid_input");
}

/// An agent whose skills are a single markdown file has no directory to add a skill to.
#[tokio::test]
async fn creating_a_skill_is_refused_for_a_single_file_agent() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    let single_file = MANIFEST.replace("format = \"skillMd\"", "format = \"markdownFile\"");
    let adapter = ahabby_lib::adapters::registry::create(
        toml_edit::de::from_str(&single_file).expect("markdownFile variant of the fixture"),
    );
    let context = fixture.context();

    let error = adapter
        .create_skill(
            &context,
            &SkillDraft {
                name: "anything".into(),
                description: None,
                content: None,
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "not_supported");
}

/// Adding a server keeps every other byte of the config, and the new entry is immediately a
/// normal, switchable one.
#[tokio::test]
async fn creating_an_mcp_server_keeps_the_rest_of_the_config() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();
    let path = fixture.settings_json();

    let server = adapter
        .create_mcp_server(
            &context,
            &McpServerDraft {
                name: "sentry".into(),
                transport: McpDraftTransport::Stdio {
                    command: "npx".into(),
                    args: vec!["-y".into(), "@sentry/mcp".into()],
                    env: vec![McpKeyValue {
                        key: "SENTRY_TOKEN".into(),
                        value: "sntrys_do_not_leak_me".into(),
                    }],
                },
            },
        )
        .await
        .unwrap();

    assert_eq!(server.name, "sentry");
    assert!(server.enabled);
    assert!(server.removable);
    assert_eq!(server.transport.label(), "stdio");
    assert!(server.has_secrets);
    assert_eq!(server.env[0].value, None, "the scan still masks secrets");
    assert!(!server.raw.contains("sntrys_do_not_leak_me"));

    let updated = fs::read_to_string(&path).unwrap();
    doc_edit::validate(ConfigFormat::Json, &updated, "test").unwrap();
    assert!(updated.contains("\"sentry\""));
    assert!(updated.contains("\"github\""), "other servers survive");
    assert!(updated.contains("\"linear\""), "other servers survive");
    assert!(
        updated.contains("\"theme\": \"dark\""),
        "unrelated keys survive"
    );
    assert_eq!(
        services::list_backups(&context.backup_root, &path)
            .unwrap()
            .len(),
        1,
        "the write is backed up"
    );

    // A name that is already taken — on or off — is refused, never shadowed.
    let taken = || McpServerDraft {
        name: "github".into(),
        transport: McpDraftTransport::Stdio {
            command: "npx".into(),
            args: Vec::new(),
            env: Vec::new(),
        },
    };
    let error = adapter
        .create_mcp_server(&context, &taken())
        .await
        .unwrap_err();
    assert_eq!(error.code(), "invalid_input");

    let servers = adapter.list_mcp_servers(&context).await.unwrap();
    let created = servers
        .iter()
        .find(|candidate| candidate.name == "sentry")
        .unwrap()
        .clone();
    adapter
        .set_mcp_server_enabled(&context, &created, false)
        .await
        .unwrap();
    let error = adapter
        .create_mcp_server(&context, &taken())
        .await
        .unwrap_err();
    assert_eq!(
        error.code(),
        "invalid_input",
        "a disabled name is taken too"
    );
}

/// The first server of an agent whose config file does not exist yet creates that file.
#[tokio::test]
async fn creating_an_mcp_server_creates_a_missing_config_file() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();
    let path = fixture.settings_json();
    assert!(!path.exists());

    let server = adapter
        .create_mcp_server(
            &context,
            &McpServerDraft {
                name: "linear".into(),
                transport: McpDraftTransport::Http {
                    url: "https://mcp.linear.app/mcp".into(),
                    headers: vec![McpKeyValue {
                        key: "Authorization".into(),
                        value: "Bearer token".into(),
                    }],
                },
            },
        )
        .await
        .unwrap();

    assert_eq!(server.transport.label(), "http");
    assert_eq!(server.source_config, path.to_string_lossy());
    let updated = fs::read_to_string(&path).unwrap();
    doc_edit::validate(ConfigFormat::Json, &updated, "test").unwrap();
    assert_eq!(adapter.list_mcp_servers(&context).await.unwrap().len(), 1);
}

/// An agent that keeps its servers in a list cannot be extended by writing a map: Ahabby says
/// so instead of writing an entry the agent would never read.
#[tokio::test]
async fn creating_an_mcp_server_in_a_list_container_is_refused() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    let agent_dir = fixture.home.join(".pipeline");
    fs::create_dir_all(&agent_dir).unwrap();
    fs::write(
        fixture.settings_json(),
        r#"{
  "mcpServers": [
    { "name": "linear", "url": "https://mcp.linear.app/sse", "type": "sse" }
  ]
}
"#,
    )
    .unwrap();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();

    let error = adapter
        .create_mcp_server(
            &context,
            &McpServerDraft {
                name: "github".into(),
                transport: McpDraftTransport::Stdio {
                    command: "npx".into(),
                    args: Vec::new(),
                    env: Vec::new(),
                },
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "not_supported");
}

/// A manifest that declares its own entry shape gets exactly that shape.
#[tokio::test]
async fn creating_an_mcp_server_follows_the_declared_entry_shape() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    let local = MANIFEST.replace(
        "key_path = [\"mcpServers\"]",
        "key_path = [\"mcpServers\"]\nentry_shape = \"local\"",
    );
    let adapter = ahabby_lib::adapters::registry::create(
        toml_edit::de::from_str(&local).expect("local-shape variant of the fixture"),
    );
    let context = fixture.context();

    let server = adapter
        .create_mcp_server(
            &context,
            &McpServerDraft {
                name: "everything".into(),
                transport: McpDraftTransport::Stdio {
                    command: "npx".into(),
                    args: vec!["-y".into(), "server-everything".into()],
                    env: vec![McpKeyValue {
                        key: "TOKEN".into(),
                        value: "x".into(),
                    }],
                },
            },
        )
        .await
        .unwrap();

    // opencode wants one command array and `environment`, and the reader normalises it back.
    let value: serde_json::Value =
        serde_json::from_str(&fs::read_to_string(fixture.settings_json()).unwrap()).unwrap();
    let entry = &value["mcpServers"]["everything"];
    assert_eq!(entry["type"], "local");
    assert_eq!(entry["command"][0], "npx");
    assert_eq!(entry["command"][2], "server-everything");
    assert_eq!(entry["environment"]["TOKEN"], "x");
    assert!(entry.get("args").is_none());
    assert_eq!(server.transport.label(), "stdio");
}

/// An agent whose servers live in a list is refused outright — even before its config file
/// exists, where the shape of the container cannot be read from disk.
#[tokio::test]
async fn creating_an_mcp_server_is_refused_for_a_declared_list() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");

    let list = MANIFEST.replace(
        "key_path = [\"mcpServers\"]",
        "key_path = [\"mcpServers\"]\nentry_shape = \"list\"",
    );
    let adapter = ahabby_lib::adapters::registry::create(
        toml_edit::de::from_str(&list).expect("list-shape variant of the fixture"),
    );
    let context = fixture.context();
    assert!(!fixture.settings_json().exists());

    let error = adapter
        .create_mcp_server(
            &context,
            &McpServerDraft {
                name: "github".into(),
                transport: McpDraftTransport::Stdio {
                    command: "npx".into(),
                    args: Vec::new(),
                    env: Vec::new(),
                },
            },
        )
        .await
        .unwrap_err();
    assert_eq!(error.code(), "not_supported");
    assert!(!fixture.settings_json().exists(), "nothing was written");
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

#[tokio::test]
async fn only_scanned_documents_are_addressable() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let scanner = Scanner::new(&catalog);
    let report = scanner.scan(&fixture.context(), None, &[], &[], None).await;
    let agent = report.agent("pipeline-demo").expect("agent scanned");

    // A declared config, with the format and writability the manifest gave it.
    let settings = fixture.settings_json().to_string_lossy().to_string();
    let target = resolve_document(agent, &settings).unwrap();
    assert_eq!(target.format, ConfigFormat::Json);
    assert!(target.editable);

    // A resource file: markdown, writable.
    let instructions = agent.other[0].path.clone();
    assert!(instructions.ends_with("AGENTS.md"));
    let target = resolve_document(agent, &instructions).unwrap();
    assert_eq!(target.format, ConfigFormat::Markdown);
    assert!(target.editable);

    // A skill entry file: markdown, writable while the skill itself is removable.
    let entry = agent.skills[0].entry_path.clone().expect("entry file");
    assert!(entry.ends_with("SKILL.md"));
    let target = resolve_document(agent, &entry).unwrap();
    assert_eq!(target.format, ConfigFormat::Markdown);
    assert!(target.editable);

    // The same skill marked plugin-managed is listed but never written.
    let mut plugin_skill = agent.skills[0].clone();
    plugin_skill.removable = false;
    let mut plugin_agent = agent.clone();
    plugin_agent.skills = vec![plugin_skill];
    let target = resolve_document(&plugin_agent, &entry).unwrap();
    assert!(!target.editable);

    // A directory resource is not a document.
    let mut directory_agent = agent.clone();
    directory_agent.other[0].is_directory = true;
    let error = resolve_document(&directory_agent, &instructions).unwrap_err();
    assert_eq!(error.code(), "command_not_allowed");

    // Nothing outside the scan is addressable, however plausible it looks.
    for forged in [
        fixture.home.join(".pipeline/notes.md"),
        fixture.home.join(".pipeline/skills/pdf/OTHER.md"),
        fixture.home.join("settings.json"),
    ] {
        let error = resolve_document(agent, &forged.to_string_lossy()).unwrap_err();
        assert_eq!(error.code(), "command_not_allowed", "{}", forged.display());
    }

    // The resolved skill file goes through the ordinary, backup-taking write path.
    let backup_root = fixture.context().backup_root;
    let path = PathBuf::from(&entry);
    let snapshot = services::read_snapshot(&path, ConfigFormat::Markdown, true).unwrap();
    let edited = format!("{}Extra line.\n", snapshot.content);
    let saved = services::save(
        &path,
        ConfigFormat::Markdown,
        &edited,
        &snapshot.sha256,
        &backup_root,
    )
    .unwrap();
    assert!(saved.backup_path.is_some());
    assert_eq!(fs::read_to_string(&path).unwrap(), edited);
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

/// The project surface, end to end: discovery, reading, and writing *inside* the project root.
///
/// This guards the one thing that makes a project work at all: a relative path of
/// `catalog/project.toml` must resolve inside the project being read. If it ever resolved
/// against Ahabby's working directory instead, a created skill would land next to the
/// application — and a forged path from the webview could reach it.
#[tokio::test]
async fn a_project_is_read_and_written_inside_its_own_root() {
    let fixture = Fixture::new();
    let work = fixture.home.join("work");
    let app = work.join("app");

    fs::create_dir_all(app.join(".claude/skills/review")).unwrap();
    fs::write(
        app.join(".claude/skills/review/SKILL.md"),
        "---\nname: review\ndescription: Review code\n---\n# Review\n",
    )
    .unwrap();
    fs::write(
        app.join(".mcp.json"),
        r#"{"mcpServers":{"github":{"command":"npx","args":["-y","server-github"]}}}"#,
    )
    .unwrap();
    fs::write(app.join("AGENTS.md"), "# House rules\n").unwrap();
    fs::create_dir_all(app.join(".cursor/rules")).unwrap();
    fs::write(app.join(".cursor/rules/style.mdc"), "be terse\n").unwrap();
    // A second project, discovered through its git directory.
    fs::create_dir_all(work.join("other/.git")).unwrap();
    fs::write(work.join("other/.git/HEAD"), "ref: refs/heads/main\n").unwrap();

    let folder = services::project::folder_for(&work.to_string_lossy()).unwrap();
    let catalog = catalog::load(None);
    let report = Scanner::new(&catalog)
        .scan(
            &fixture.context(),
            None,
            &[],
            std::slice::from_ref(&folder),
            None,
        )
        .await;

    assert_eq!(report.projects.folders.len(), 1);
    assert!(report.projects.folders[0].exists);
    assert_eq!(
        report.projects.projects.len(),
        2,
        "both projects are discovered: {:?}",
        report
            .projects
            .projects
            .iter()
            .map(|project| project.root.as_str())
            .collect::<Vec<_>>()
    );

    let project = report
        .projects
        .projects
        .iter()
        .find(|project| project.name == "app")
        .expect("the app project");
    assert_eq!(project.skills.len(), 1);
    assert_eq!(project.skills[0].name, "review");
    assert_eq!(project.mcp_servers.len(), 1);
    assert!(project
        .other
        .iter()
        .any(|item| item.path.ends_with("AGENTS.md")));
    assert!(project
        .configs
        .iter()
        .any(|config| config.path.ends_with(".mcp.json")));
    // Owned and scoped by the project, never mistaken for an agent's global resource.
    assert_eq!(project.skills[0].agents[0].id, project.id);
    assert!(matches!(
        project.skills[0].scope,
        ahabby_lib::domain::Scope::Project { .. }
    ));
    // Nothing from the project leaks into the agent list or the Library.
    assert!(report.agents.iter().all(|agent| agent.skills.is_empty()));
    assert!(aggregate(&report).skills.is_empty());

    // A document of the project is addressable; the project root and anything outside is not.
    let entry = project.skills[0].entry_path.clone().unwrap();
    assert!(services::project::resolve_document(project, &entry).is_ok());
    assert!(services::project::resolve_document(project, &project.root).is_err());
    assert!(services::project::resolve_document(project, "/etc/passwd").is_err());

    // Writing goes through the same adapter an agent's documents use — rooted at the project.
    let context = fixture.context();
    let adapter = services::project::adapter(&app);
    let created = adapter
        .create_skill(
            &context,
            &SkillDraft {
                name: "Deploy".to_string(),
                description: Some("Ship it".to_string()),
                content: None,
            },
        )
        .await
        .unwrap();
    assert!(created.agents[0].id == project.id, "the project owns it");
    assert!(std::path::Path::new(&created.path).starts_with(&app));
    assert!(created
        .entry_path
        .as_deref()
        .unwrap()
        .replace('\\', "/")
        .ends_with("/app/.claude/skills/deploy/SKILL.md"));

    // Switch it off and back on: the rename happens inside the project, nothing is deleted.
    adapter
        .set_skill_enabled(&context, &created, false)
        .await
        .unwrap();
    let listed = adapter.list_skills(&context).await.unwrap();
    let disabled = listed
        .iter()
        .find(|skill| skill.name == "Deploy")
        .expect("switched-off skills stay listed");
    assert!(!disabled.enabled);
    adapter
        .set_skill_enabled(&context, disabled, true)
        .await
        .unwrap();

    // A new MCP server lands in the project's `.mcp.json`, keeping the file's other entries.
    let server = adapter
        .create_mcp_server(
            &context,
            &McpServerDraft {
                name: "linear".to_string(),
                transport: McpDraftTransport::Stdio {
                    command: "npx".to_string(),
                    args: vec!["-y".to_string(), "server-linear".to_string()],
                    env: Vec::new(),
                },
            },
        )
        .await
        .unwrap();
    assert!(server
        .source_config
        .replace('\\', "/")
        .ends_with("/app/.mcp.json"));
    let content = fs::read_to_string(app.join(".mcp.json")).unwrap();
    assert!(content.contains("linear"), "{content}");
    assert!(
        content.contains("server-github"),
        "existing entry kept: {content}"
    );

    // …and it can be switched off, which moves the entry where no agent looks for it.
    adapter
        .set_mcp_server_enabled(&context, &server, false)
        .await
        .unwrap();
    let switched = fs::read_to_string(app.join(".mcp.json")).unwrap();
    assert!(switched.contains("mcpServersDisabled"), "{switched}");
}

/// A skill installed from the Hub is written whole, inside the skills directory the manifest
/// declares, and nothing about it can escape that directory.
#[tokio::test]
async fn installing_a_hub_skill_writes_it_inside_the_declared_skills_directory() {
    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();

    let install = SkillInstall {
        name: "PDF Toolkit".into(),
        files: vec![
            file(
                "SKILL.md",
                "---\nname: PDF Toolkit\ndescription: Fill forms\n---\n\n# PDF\n",
            ),
            file("scripts/fill.py", "print('fill')\n"),
            file("references/spec.md", "# Spec\n"),
        ],
    };
    let skill = adapter.install_skill(&context, &install).await.unwrap();

    // The entry file is the one the agent looks for, and the directory is derived from the name.
    let directory = fixture
        .home
        .join(".pipeline")
        .join("skills")
        .join("pdf-toolkit");
    assert_eq!(skill.path, directory.to_string_lossy());
    assert!(directory.join("SKILL.md").is_file());
    assert!(directory.join("scripts/fill.py").is_file());
    assert!(directory.join("references/spec.md").is_file());
    assert!(skill.enabled && skill.removable);

    // It is a first-class skill from the next read on, with the description from its own file.
    let scanned = adapter.list_skills(&context).await.unwrap();
    let installed = scanned
        .iter()
        .find(|candidate| candidate.name == "PDF Toolkit")
        .expect("the installed skill is scanned");
    assert!(installed.enabled);
    assert_eq!(installed.description.as_deref(), Some("Fill forms"));

    // A name that is already taken is refused instead of being merged into.
    let error = adapter.install_skill(&context, &install).await.unwrap_err();
    assert_eq!(error.code(), "invalid_input");

    // The staging directory never survives a successful install.
    let leftovers: Vec<_> = fs::read_dir(fixture.home.join(".pipeline/skills"))
        .unwrap()
        .flatten()
        .map(|entry| entry.file_name().to_string_lossy().to_string())
        .filter(|name| name.contains("ahabby-installing"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
}

/// A payload that carries its own paths cannot be written outside the skill directory, and a
/// payload without an entry file is not a skill at all.
#[tokio::test]
async fn a_hub_payload_cannot_write_outside_its_own_directory() {
    let fixture = Fixture::new();
    fixture.write_manifest();

    let catalog = catalog_for(&fixture);
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());
    let context = fixture.context();
    let skills = fixture.home.join(".pipeline/skills");

    let escapes = [
        "../escape.md",
        "a/../../escape.md",
        "/etc/escape.md",
        "C:/escape.md",
        "a\\escape.md",
    ];
    for path in escapes {
        let install = SkillInstall {
            name: "Escape".into(),
            files: vec![
                file("SKILL.md", "---\nname: Escape\n---\n"),
                file(path, "nope\n"),
            ],
        };
        let error = adapter.install_skill(&context, &install).await.unwrap_err();
        assert_eq!(error.code(), "invalid_input", "accepted '{path}'");
        assert!(
            !skills.join("escape").exists(),
            "wrote something for '{path}'"
        );
    }

    // A hidden path is not an escape: it has to land inside the skill directory, not in the
    // user's real `.ssh`.
    let hidden = SkillInstall {
        name: "Hidden".into(),
        files: vec![
            file("SKILL.md", "---\nname: Hidden\n---\n"),
            file(".ssh/authorized_keys", "inside only\n"),
        ],
    };
    let installed = adapter.install_skill(&context, &hidden).await.unwrap();
    assert!(Path::new(&installed.path)
        .join(".ssh/authorized_keys")
        .is_file());
    assert!(!fixture.home.join(".ssh").exists());

    // Without an entry file there is nothing for an agent to load.
    let no_entry = SkillInstall {
        name: "No Entry".into(),
        files: vec![file("notes.md", "# Notes\n")],
    };
    let error = adapter
        .install_skill(&context, &no_entry)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "invalid_input");

    // One file cannot be the parent of another.
    let conflicting = SkillInstall {
        name: "Conflict".into(),
        files: vec![
            file("SKILL.md", "---\nname: Conflict\n---\n"),
            file("assets", "a file\n"),
            file("assets/logo.svg", "<svg/>\n"),
        ],
    };
    let error = adapter
        .install_skill(&context, &conflicting)
        .await
        .unwrap_err();
    assert_eq!(error.code(), "invalid_input");

    // Nothing of any of that is left behind.
    assert!(!skills.join("escape").exists());
    assert!(!skills.join("no-entry").exists());
    assert!(!skills.join("conflict").exists());
}

/// The same install, into one of the user's projects: it lands inside the project, in the
/// directory `catalog/project.toml` lists first, and the owner it reports is the project.
#[tokio::test]
async fn a_hub_skill_installs_into_a_project() {
    let fixture = Fixture::new();
    let root = fixture.home.join("code").join("app");
    fs::create_dir_all(&root).unwrap();

    let adapter = ahabby_lib::adapters::ProjectAdapter::new(
        services::project::manifest().clone(),
        root.clone(),
    );
    let context = fixture.context();
    let skill = adapter
        .install_skill(
            &context,
            &SkillInstall {
                name: "deploy".into(),
                files: vec![
                    file("SKILL.md", "---\nname: deploy\n---\n"),
                    file("run.sh", "echo deploy\n"),
                ],
            },
        )
        .await
        .unwrap();

    assert!(skill
        .entry_path
        .as_deref()
        .unwrap()
        .replace('\\', "/")
        .ends_with("/app/.claude/skills/deploy/SKILL.md"));
    assert!(root.join(".claude/skills/deploy/run.sh").is_file());
    assert_eq!(
        skill.agents[0].id,
        ahabby_lib::domain::project_owner_id(&ahabby_lib::domain::ProjectFolder::normalize(
            &root.to_string_lossy()
        ))
    );
}

/// The Hub's "already installed for …" is the *scan's* answer, not a second opinion: a payload
/// installed into an agent's skills directory is found in the very report the Library reads, told
/// apart from a same-named copy by the hash of its entry file, and still found after it is switched
/// off.
#[tokio::test]
async fn a_hub_entry_is_found_installed_in_the_scan_report() {
    use ahabby_lib::domain::{HubEntry, HubResourceKind};
    use ahabby_lib::services::hub::installed::{skill_identity, InstalledIndex};

    let fixture = Fixture::new();
    fixture.write_manifest();
    fixture.write_binary("1.0.0");
    fixture.write_agent_files();

    let catalog = catalog_for(&fixture);
    let context = fixture.context();
    let adapter =
        ahabby_lib::adapters::registry::create(catalog.get("pipeline-demo").unwrap().clone());

    let published = "---\nname: PDF Toolkit\ndescription: Fill forms\n---\n\n# PDF\n";
    adapter
        .install_skill(
            &context,
            &SkillInstall {
                name: "PDF Toolkit".into(),
                files: vec![
                    file("SKILL.md", published),
                    file("fill.py", "print('fill')\n"),
                ],
            },
        )
        .await
        .unwrap();

    // A hub entry as a collection offers one: the published bytes, and a name spelled its own way.
    let entry = |identity: Option<String>| HubEntry {
        id: "example/pdf-toolkit".into(),
        source_id: "example".into(),
        source_name: "Example".into(),
        kind: HubResourceKind::Skill,
        name: "pdf-toolkit".into(),
        title: None,
        description: None,
        version: None,
        vendor: None,
        homepage: None,
        repository: None,
        license: None,
        tags: Vec::new(),
        group: None,
        file_count: None,
        size_bytes: None,
        installable: true,
        install_problem: None,
        input_count: 0,
        has_scripts: true,
        installed: Vec::new(),
        identity,
    };

    let scanner = Scanner::new(&catalog);
    let report = scanner.scan(&context, None, &[], &[], None).await;
    let installed = report
        .agent("pipeline-demo")
        .unwrap()
        .skills
        .iter()
        .find(|candidate| candidate.name == "PDF Toolkit")
        .expect("the installed skill is scanned")
        .clone();

    let index = InstalledIndex::of(&report);
    let mut entries = vec![entry(Some(skill_identity(published.as_bytes())))];
    index.annotate(&mut entries);

    assert_eq!(entries[0].installed.len(), 1, "one copy, one owner");
    let found = &entries[0].installed[0];
    assert_eq!(found.owner.id, "pipeline-demo");
    assert_eq!(found.path, installed.path);
    assert!(found.enabled);
    assert_eq!(
        found.identical,
        Some(true),
        "the published bytes are the bytes on disk"
    );

    // The collection moved on: the same name, a different payload.
    let mut moved = vec![entry(Some(skill_identity(
        b"---\nname: PDF Toolkit\n---\n\n# PDF v2\n",
    )))];
    index.annotate(&mut moved);
    assert_eq!(moved[0].installed[0].identical, Some(false));

    // Switched off, the copy is still one an agent has — it just is not loaded any more.
    adapter
        .set_skill_enabled(&context, &installed, false)
        .await
        .unwrap();
    let report = scanner.scan(&context, None, &[], &[], None).await;
    let mut entries = vec![entry(Some(skill_identity(published.as_bytes())))];
    InstalledIndex::of(&report).annotate(&mut entries);

    assert_eq!(
        entries[0].installed.len(),
        1,
        "a switched-off copy is still installed"
    );
    assert!(!entries[0].installed[0].enabled);
    assert_eq!(
        entries[0].installed[0].identical,
        Some(true),
        "renaming the file does not change what it says"
    );
}
