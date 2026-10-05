//! The scanner: turns manifests + a machine into the agent list the UI shows.
//!
//! Design notes:
//! * all agents are scanned **concurrently** (bounded), because most of the time is spent
//!   waiting for `--version` subprocesses;
//! * every agent has a hard timeout, so one hanging CLI cannot freeze the app;
//! * a failing sub-step becomes a warning on that agent, never a failed scan;
//! * the result is cached, which is what makes navigation instant.

use std::collections::BTreeSet;
use std::sync::{Arc, RwLock};
use std::time::{Duration, Instant};

use futures::stream::FuturesUnordered;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::adapters::{AdapterRegistry, AgentAdapter};
use crate::catalog::Catalog;
use crate::domain::{
    Agent, AgentStatus, CatalogProblem, Detection, InstallOption, Manager, ManifestSource, Os,
    RemovalKind, SharedResources, UpdateInfo,
};
use crate::platform::{self, PlatformContext};

use super::version_checker::VersionChecker;

/// A single agent may not take longer than this, no matter what it does.
pub const PER_AGENT_TIMEOUT: Duration = Duration::from_secs(45);

/// How many agents are inspected at the same time.
const CONCURRENCY: usize = 6;

/// Result of one full scan.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ScanReport {
    pub agents: Vec<Agent>,
    pub problems: Vec<CatalogProblem>,
    #[ts(type = "number")]
    pub scanned_at_ms: i64,
    #[ts(type = "number")]
    pub duration_ms: u64,
    pub installed: usize,
    pub available_to_install: usize,
    pub os: Os,
    /// Resources that belong to no single agent: global skills, MCP servers and documents
    /// from the cross-agent locations (`~/.agents/...`). Shown by the Library; never part of
    /// the agent list or its counts.
    #[serde(default)]
    pub shared: SharedResources,
}

impl ScanReport {
    pub fn agent(&self, id: &str) -> Option<&Agent> {
        self.agents.iter().find(|agent| agent.id == id)
    }

    pub fn installed_agents(&self) -> impl Iterator<Item = &Agent> {
        self.agents.iter().filter(|agent| agent.is_installed())
    }
}

/// Progress of a running scan.
///
/// The scanner knows nothing about Tauri, so the emitter lives in `state::TauriScanSink`
/// and is injected through this trait. It is what lets the UI paint each agent the moment
/// its own subprocess and config reads are done instead of waiting for the whole scan.
pub trait ScanSink: Send + Sync {
    /// A scan just started; nothing has been inspected yet.
    fn started(&self) {}

    /// One agent is done — its entry is final for this scan.
    fn agent_scanned(&self, agent: &Agent);

    /// The whole report is ready and cached.
    fn finished(&self, _report: &ScanReport) {}
}

pub struct Scanner {
    registry: RwLock<AdapterRegistry>,
    problems: RwLock<Vec<CatalogProblem>>,
    cache: RwLock<Option<ScanReport>>,
}

impl Scanner {
    pub fn new(catalog: &Catalog) -> Self {
        Self {
            registry: RwLock::new(AdapterRegistry::from_catalog(catalog)),
            problems: RwLock::new(catalog.problems.clone()),
            cache: RwLock::new(None),
        }
    }

    /// Swap in a freshly loaded catalog (user manifests may have changed on disk) while
    /// keeping the last scan available until the new one finishes.
    pub fn reload(&self, catalog: &Catalog) {
        if let Ok(mut registry) = self.registry.write() {
            *registry = AdapterRegistry::from_catalog(catalog);
        }
        if let Ok(mut problems) = self.problems.write() {
            *problems = catalog.problems.clone();
        }
    }

    pub fn last_report(&self) -> Option<ScanReport> {
        self.cache.read().ok().and_then(|cache| cache.clone())
    }

    /// Seed the cache with a report read back from disk, so the first `list_agents` after a
    /// restart answers before a scan has run. The next scan replaces it entirely.
    pub fn restore(&self, report: ScanReport) {
        if let Ok(mut cache) = self.cache.write() {
            *cache = Some(report);
        }
    }

    pub fn registry(&self) -> AdapterRegistry {
        self.registry
            .read()
            .map(|registry| registry.clone())
            .unwrap_or_default()
    }

    /// Scan everything. `versions` is optional: when `None` (or when the user disabled
    /// network checks) only locally available information is used. `hidden` lists the ids of
    /// agents the user removed from Ahabby; they are left out of the report and its counts.
    /// `sink` receives progress while the scan runs.
    pub async fn scan(
        &self,
        ctx: &PlatformContext,
        versions: Option<Arc<VersionChecker>>,
        hidden: &[String],
        sink: Option<Arc<dyn ScanSink>>,
    ) -> ScanReport {
        let started = Instant::now();
        if let Some(sink) = &sink {
            sink.started();
        }
        let registry = self.registry();
        // Owned `Arc`s and `FuturesUnordered` instead of `StreamExt::map`: a closure whose
        // argument is `&Arc<dyn Trait>` cannot satisfy the higher-ranked lifetime bounds
        // required by `buffer_unordered`.
        let adapters: Vec<Arc<dyn AgentAdapter>> = registry.all().to_vec();
        let available_managers: Arc<BTreeSet<Manager>> = Arc::new(
            platform::detect_managers()
                .into_iter()
                .map(|found| found.manager)
                .collect(),
        );

        let mut agents: Vec<Agent> = Vec::with_capacity(adapters.len());
        for chunk in adapters.chunks(CONCURRENCY) {
            let mut pending = FuturesUnordered::new();
            for adapter in chunk {
                let adapter = Arc::clone(adapter);
                let versions = versions.clone();
                let available_managers = Arc::clone(&available_managers);
                pending.push(async move {
                    let manifest = adapter.manifest().clone();
                    match tokio::time::timeout(
                        PER_AGENT_TIMEOUT,
                        scan_agent(
                            adapter.as_ref(),
                            ctx,
                            versions.as_deref(),
                            &available_managers,
                            &manifest,
                        ),
                    )
                    .await
                    {
                        Ok(agent) => agent,
                        Err(_) => {
                            let mut skeleton = skeleton_agent(&manifest);
                            skeleton.warnings.push(format!(
                                "scanning {} timed out after {}s",
                                manifest.name,
                                PER_AGENT_TIMEOUT.as_secs()
                            ));
                            skeleton
                        }
                    }
                });
            }
            while let Some(agent) = pending.next().await {
                if let Some(sink) = &sink {
                    sink.agent_scanned(&agent);
                }
                agents.push(agent);
            }
        }

        // Agents the user removed are not part of the world Ahabby reports: they are gone
        // from the list and must not be counted as installed or available.
        let hidden: BTreeSet<&str> = hidden.iter().map(String::as_str).collect();
        agents.retain(|agent| !hidden.contains(agent.id.as_str()));

        let installed = agents.iter().filter(|agent| agent.is_installed()).count();
        let available_to_install = agents.iter().filter(|agent| agent.can_install).count();

        // The agent-neutral surface is independent of any agent: one machine-wide read
        // appended to the report the Library aggregates.
        let shared = super::shared::scan(ctx).await;

        let report = ScanReport {
            agents,
            problems: self
                .problems
                .read()
                .map(|problems| problems.clone())
                .unwrap_or_default(),
            scanned_at_ms: platform::now_ms(),
            duration_ms: started.elapsed().as_millis() as u64,
            installed,
            available_to_install,
            os: ctx.os,
            shared,
        };

        if let Ok(mut cache) = self.cache.write() {
            *cache = Some(report.clone());
        }
        if let Some(sink) = &sink {
            sink.finished(&report);
        }
        report
    }
}

async fn scan_agent(
    adapter: &dyn AgentAdapter,
    ctx: &PlatformContext,
    versions: Option<&VersionChecker>,
    available_managers: &BTreeSet<Manager>,
    manifest: &crate::domain::AgentManifest,
) -> Agent {
    let started = Instant::now();
    let mut warnings: Vec<String> = Vec::new();

    let detection = match adapter.detect(ctx).await {
        Ok(detection) => detection,
        Err(error) => {
            warnings.push(format!("detection failed: {error}"));
            None
        }
    };

    let mut agent = skeleton_agent(manifest);
    agent.manifest_source = manifest.source.clone();

    let installed = detection.is_some();
    let mut version = None;

    if let Some(detection) = &detection {
        agent.status = AgentStatus::Installed;
        agent.binary_path = Some(detection.binary_path.clone());
        agent.found_in = Some(detection.found_in.clone());
        version = adapter.version(ctx, detection).await;
        if version.is_none() {
            warnings.push(format!(
                "{} did not report a version",
                manifest.binaries.version_args.join(" ")
            ));
        }

        let (configs, skills, mcp_servers, other) = futures::join!(
            adapter.config_files(ctx),
            adapter.list_skills(ctx),
            adapter.list_mcp_servers(ctx),
            adapter.list_other_resources(ctx),
        );

        match configs {
            Ok(configs) => agent.configs = configs,
            Err(error) => warnings.push(format!("configs: {error}")),
        }
        match skills {
            Ok(skills) => agent.skills = skills,
            Err(error) => warnings.push(format!("skills: {error}")),
        }
        match mcp_servers {
            Ok(servers) => agent.mcp_servers = servers,
            Err(error) => warnings.push(format!("mcp servers: {error}")),
        }
        match other {
            Ok(resources) => agent.other = other_resources_sorted(resources),
            Err(error) => warnings.push(format!("other resources: {error}")),
        }
    }

    agent.version = version;
    agent.install_options = install_options(manifest, ctx.os, available_managers, &detection);
    agent.installed_via = agent
        .install_options
        .iter()
        .find(|option| option.detected)
        .map(|option| option.id.clone());
    agent.can_install = !installed && agent.install_options.iter().any(|option| option.available);
    agent.can_update = installed && agent.install_options.iter().any(|option| option.available);
    agent.can_uninstall = installed && can_uninstall(&agent.install_options);

    if installed {
        if let (Some(checker), Some(current)) = (versions, agent.version.as_ref()) {
            if let Some((latest, source)) = checker.latest_for(manifest).await {
                if latest.is_newer_than(current) {
                    agent.update = Some(UpdateInfo {
                        latest: latest.raw.clone(),
                        source,
                        checked_at_ms: platform::now_ms(),
                    });
                }
            }
        }
    }

    agent.warnings = warnings;
    agent.scan_ms = started.elapsed().as_millis() as u64;
    agent
}

fn skeleton_agent(manifest: &crate::domain::AgentManifest) -> Agent {
    Agent {
        id: manifest.id.clone(),
        name: manifest.name.clone(),
        description: manifest.description.clone(),
        tagline: manifest.tagline.clone(),
        icon: manifest.icon.clone(),
        category: manifest.category.clone(),
        website: manifest.website.clone(),
        docs: manifest.docs.clone(),
        vendor: manifest.vendor.clone(),
        features: manifest.features.clone(),
        github: manifest.github.clone(),
        popular: manifest.popular,
        status: AgentStatus::NotInstalled,
        binary_path: None,
        found_in: None,
        version: None,
        installed_via: None,
        install_options: Vec::new(),
        can_install: false,
        install_docs_url: manifest.install_docs_url().map(str::to_string),
        can_update: false,
        can_uninstall: false,
        configs: Vec::new(),
        skills: Vec::new(),
        mcp_servers: Vec::new(),
        other: Vec::new(),
        update: None,
        unverified: manifest.unverified.clone(),
        notes: manifest.notes.clone(),
        manifest_source: ManifestSource::Builtin,
        removal: RemovalKind::for_manifest(
            &manifest.source,
            crate::catalog::is_builtin_id(&manifest.id),
        ),
        warnings: Vec::new(),
        scan_ms: 0,
    }
}

/// Real deletion is possible only when the agent is installed and a method that can actually
/// run on this machine declares an uninstall command; every other agent can only be hidden.
fn can_uninstall(options: &[crate::domain::InstallOption]) -> bool {
    options
        .iter()
        .any(|option| option.uninstall_command.is_some() && option.available)
}

fn install_options(
    manifest: &crate::domain::AgentManifest,
    os: Os,
    available_managers: &BTreeSet<Manager>,
    detection: &Option<Detection>,
) -> Vec<InstallOption> {
    let detected_manager = detection.as_ref().and_then(|detection| detection.manager);
    manifest
        .methods_for(os)
        .into_iter()
        .map(|method| {
            let manager_available = match method.manager {
                Manager::Manual => false,
                Manager::Script => true,
                manager => available_managers.contains(&manager),
            };
            let unavailable_reason = if manager_available {
                None
            } else if method.manager == Manager::Manual {
                Some("manual installation only".to_string())
            } else {
                Some(format!(
                    "{} is not installed",
                    method
                        .manager
                        .binary()
                        .unwrap_or("the required package manager")
                ))
            };
            InstallOption {
                id: method.id.clone(),
                manager: method.manager,
                command: method.command.clone(),
                update_command: method.update_command.clone(),
                uninstall_command: method.uninstall_command.clone(),
                requires: method.requires.clone(),
                docs_url: method.docs_url.clone(),
                note: method.note.clone(),
                available: manager_available,
                unavailable_reason,
                detected: detected_manager == Some(method.manager),
            }
        })
        .collect()
}

fn other_resources_sorted(
    resources: Vec<crate::domain::OtherResource>,
) -> Vec<crate::domain::OtherResource> {
    let mut resources = resources;
    resources.sort_by(|a, b| {
        format!("{:?}", a.kind)
            .cmp(&format!("{:?}", b.kind))
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });
    resources
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::parse_manifest;
    use crate::domain::{InstallMethodSpec, Manager};
    use std::collections::BTreeSet;

    fn manifest() -> crate::domain::AgentManifest {
        parse_manifest(
            r#"
id = "unit-agent"
name = "Unit Agent"
description = "an agent that exists only for tests"
popular = true
website = "https://example.com"
docs = "https://example.com/docs"

[binaries]
names = ["unit-agent"]
version_args = ["--version"]

[[configs]]
id = "settings"
label = "Settings"
format = "json"
path = { linux = "${HOME}/.unit-agent/settings.json", windows = "${HOME}/.unit-agent/settings.json", macos = "${HOME}/.unit-agent/settings.json" }

[skills]
format = "skillMd"
path = { linux = "${HOME}/.unit-agent/skills", windows = "${HOME}/.unit-agent/skills", macos = "${HOME}/.unit-agent/skills" }

[mcp]
format = "json"
key_path = ["mcpServers"]
path = { linux = "${HOME}/.unit-agent/settings.json", windows = "${HOME}/.unit-agent/settings.json", macos = "${HOME}/.unit-agent/settings.json" }

[[methods]]
id = "script"
manager = "script"
command = "curl -fsSL https://example.com/install.sh | sh"
"#,
            "test",
        )
        .unwrap()
    }

    fn catalog(manifest: crate::domain::AgentManifest) -> Catalog {
        Catalog {
            manifests: vec![manifest],
            problems: Vec::new(),
        }
    }

    fn context(home: &std::path::Path) -> PlatformContext {
        PlatformContext::for_tests(Os::current(), home, home.join("appdata"), home.join("cfg"))
    }

    #[tokio::test]
    async fn not_installed_agent_is_reported_without_errors() {
        let home = tempfile::tempdir().unwrap();
        let mut manifest = manifest();
        manifest.binaries.names = vec!["definitely-not-installed-unit-agent".to_string()];
        let scanner = Scanner::new(&catalog(manifest));
        let report = scanner.scan(&context(home.path()), None, &[], None).await;

        let agent = report.agent("unit-agent").unwrap();
        assert_eq!(agent.status, AgentStatus::NotInstalled);
        assert!(agent.binary_path.is_none());
        assert!(
            agent.can_install,
            "a script method is always available, so this is installable"
        );
        assert!(agent.warnings.is_empty());
        assert_eq!(report.installed, 0);
        assert!(report.problems.is_empty());
    }

    #[test]
    fn uninstall_is_possible_only_for_an_available_method_that_declares_it() {
        let os = Os::current();

        // The default manifest declares a script method but no uninstall command.
        let script = manifest();
        let options = install_options(&script, os, &BTreeSet::new(), &None);
        assert!(
            options[0].available,
            "a script method is always runnable, so the gate is the command"
        );
        assert!(options[0].uninstall_command.is_none());
        assert!(!can_uninstall(&options));

        // The same method with an uninstall command makes real deletion possible.
        let mut with_uninstall = script.clone();
        with_uninstall.methods[0].uninstall_command = Some("rm -f unit-agent".to_string());
        let options = install_options(&with_uninstall, os, &BTreeSet::new(), &None);
        assert_eq!(
            options[0].uninstall_command.as_deref(),
            Some("rm -f unit-agent")
        );
        assert!(can_uninstall(&options));

        // A method whose package manager is missing cannot run, so it is not offered even
        // though it declares an uninstall command.
        let mut npm_only = script;
        npm_only.methods = vec![InstallMethodSpec {
            id: "npm".to_string(),
            manager: Manager::Npm,
            os: Vec::new(),
            command: "npm install -g unit-agent".to_string(),
            update_command: None,
            uninstall_command: Some("npm uninstall -g unit-agent".to_string()),
            docs_url: None,
            note: None,
            priority: 0,
            requires: Vec::new(),
        }];
        let missing = install_options(&npm_only, os, &BTreeSet::new(), &None);
        assert!(!missing[0].available);
        assert!(!can_uninstall(&missing));

        // …and once npm is present the same method becomes available.
        let available = install_options(&npm_only, os, &BTreeSet::from([Manager::Npm]), &None);
        assert!(available[0].available);
        assert!(can_uninstall(&available));
    }

    #[tokio::test]
    async fn installed_agent_is_scanned_end_to_end() {
        let home = tempfile::tempdir().unwrap();
        let agent_dir = home.path().join(".unit-agent");
        std::fs::create_dir_all(agent_dir.join("skills/pdf")).unwrap();
        std::fs::create_dir_all(agent_dir.join("skills/summarise")).unwrap();

        std::fs::write(
            agent_dir.join("settings.json"),
            r#"{
  "mcpServers": {
    "github": { "command": "npx", "args": ["-y", "server-github"], "env": { "GITHUB_TOKEN": "ghp_supersecret" } }
  }
}
"#,
        )
        .unwrap();
        std::fs::write(
            agent_dir.join("skills/pdf/SKILL.md"),
            "---\nname: pdf\ndescription: Work with PDFs\n---\n\n# PDF\n\nBody.\n",
        )
        .unwrap();
        std::fs::write(
            agent_dir.join("skills/summarise/SKILL.md"),
            "---\nname: summarise\ndescription: Summarise documents.\n---\n\n# Summarise\n",
        )
        .unwrap();

        // A fake binary that reports a version.
        let bin_dir = home.path().join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        let binary = write_fake_binary(&bin_dir, "unit-agent", "3.1.4");

        let mut manifest = manifest();
        manifest.search_paths = vec![crate::domain::SearchPathSpec {
            windows: vec!["${HOME}/bin".to_string()],
            macos: vec!["${HOME}/bin".to_string()],
            linux: vec!["${HOME}/bin".to_string()],
        }];
        manifest.binaries.names = vec!["unit-agent".to_string()];
        // A declared uninstall command on an installed agent makes a real deletion possible.
        manifest.methods[0].uninstall_command = Some("unit-agent self-uninstall".to_string());

        let scanner = Scanner::new(&catalog(manifest));
        let report = scanner.scan(&context(home.path()), None, &[], None).await;
        let agent = report.agent("unit-agent").unwrap();

        assert_eq!(agent.status, AgentStatus::Installed);
        assert!(agent.can_uninstall);
        assert_eq!(
            agent.binary_path.as_deref(),
            Some(binary.to_string_lossy().as_ref())
        );
        assert_eq!(agent.version.as_ref().unwrap().raw, "3.1.4");
        assert_eq!(report.installed, 1);

        assert_eq!(agent.configs.len(), 1);
        assert!(agent.configs[0].exists);

        assert_eq!(agent.skills.len(), 2, "skills: {:?}", agent.skills);
        assert!(agent.skills.iter().any(|skill| skill.name == "pdf"));
        assert!(agent.skills.iter().any(|skill| skill.name == "summarise"));

        assert_eq!(agent.mcp_servers.len(), 1);
        let server = &agent.mcp_servers[0];
        assert_eq!(server.name, "github");
        assert_eq!(server.key_path, vec!["mcpServers", "github"]);
        assert!(server.has_secrets);
        assert_eq!(server.env[0].value, None);
        assert!(!server.raw.contains("ghp_supersecret"));
    }

    #[tokio::test]
    async fn broken_config_becomes_a_warning_not_a_failure() {
        let home = tempfile::tempdir().unwrap();
        let agent_dir = home.path().join(".unit-agent");
        std::fs::create_dir_all(&agent_dir).unwrap();
        std::fs::write(agent_dir.join("settings.json"), "{ broken").unwrap();

        let bin_dir = home.path().join("bin");
        std::fs::create_dir_all(&bin_dir).unwrap();
        write_fake_binary(&bin_dir, "unit-agent", "1.0.0");

        let mut manifest = manifest();
        manifest.binaries.names = vec!["unit-agent".to_string()];
        manifest.search_paths = vec![crate::domain::SearchPathSpec {
            linux: vec!["${HOME}/bin".to_string()],
            macos: vec!["${HOME}/bin".to_string()],
            windows: vec!["${HOME}/bin".to_string()],
        }];

        let scanner = Scanner::new(&catalog(manifest));
        let report = scanner.scan(&context(home.path()), None, &[], None).await;
        let agent = report.agent("unit-agent").unwrap();

        assert_eq!(agent.status, AgentStatus::Installed);
        assert!(agent
            .warnings
            .iter()
            .any(|warning| warning.starts_with("mcp servers:")));
        // The config file itself is still listed, the UI can show the problem to the user.
        assert_eq!(agent.configs.len(), 1);
    }

    #[tokio::test]
    async fn second_scan_is_served_from_the_cache() {
        let home = tempfile::tempdir().unwrap();
        let scanner = Scanner::new(&catalog(manifest()));
        assert!(scanner.last_report().is_none());
        let report = scanner.scan(&context(home.path()), None, &[], None).await;
        let cached = scanner.last_report().expect("cached");
        assert_eq!(cached.scanned_at_ms, report.scanned_at_ms);
        assert_eq!(cached.agents.len(), 1);
    }

    #[tokio::test]
    async fn hidden_agents_are_left_out_of_the_report_and_its_counts() {
        let home = tempfile::tempdir().unwrap();
        let scanner = Scanner::new(&catalog(manifest()));

        let visible = scanner.scan(&context(home.path()), None, &[], None).await;
        assert!(
            visible.available_to_install > 0,
            "the script method makes this agent installable"
        );

        let hidden = scanner
            .scan(
                &context(home.path()),
                None,
                &["unit-agent".to_string()],
                None,
            )
            .await;
        assert!(hidden.agent("unit-agent").is_none());
        assert!(hidden.agents.is_empty());
        assert_eq!(hidden.installed, 0);
        assert_eq!(hidden.available_to_install, 0);
        // The cache is filtered too, so a later `report()` cannot leak the hidden agent.
        assert_eq!(scanner.last_report().unwrap().agents.len(), 0);
    }

    /// Records what the scanner reports while it runs.
    #[derive(Default)]
    struct RecordingSink {
        events: std::sync::Mutex<Vec<String>>,
    }

    impl RecordingSink {
        fn record(&self, event: String) {
            if let Ok(mut events) = self.events.lock() {
                events.push(event);
            }
        }

        fn taken(&self) -> Vec<String> {
            self.events
                .lock()
                .map(|events| events.clone())
                .unwrap_or_default()
        }
    }

    impl ScanSink for RecordingSink {
        fn started(&self) {
            self.record("start".to_string());
        }

        fn agent_scanned(&self, agent: &Agent) {
            self.record(format!("agent:{}", agent.id));
        }

        fn finished(&self, report: &ScanReport) {
            self.record(format!("done:{}", report.agents.len()));
        }
    }

    #[tokio::test]
    async fn the_sink_gets_every_agent_between_start_and_finish() {
        let home = tempfile::tempdir().unwrap();
        let scanner = Scanner::new(&catalog(manifest()));
        let sink = Arc::new(RecordingSink::default());

        let report = scanner
            .scan(&context(home.path()), None, &[], Some(sink.clone()))
            .await;
        assert_eq!(report.agents.len(), 1);

        // The order is the contract the UI relies on: start → each agent → the full report.
        assert_eq!(sink.taken(), vec!["start", "agent:unit-agent", "done:1"]);
    }

    /// Create a small executable that prints a version, for the current OS.
    fn write_fake_binary(
        directory: &std::path::Path,
        name: &str,
        version: &str,
    ) -> std::path::PathBuf {
        if cfg!(windows) {
            let path = directory.join(format!("{name}.cmd"));
            std::fs::write(&path, format!("@echo off\r\necho {version} (fake)\r\n")).unwrap();
            path
        } else {
            let path = directory.join(name);
            std::fs::write(&path, format!("#!/bin/sh\necho \"{version} (fake)\"\n")).unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        }
    }
}
