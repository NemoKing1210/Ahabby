//! Application state shared by all Tauri commands.
//!
//! This is where the whole backend is wired together once: catalog → adapters → scanner →
//! services. Commands get a `State<AppState>` and stay thin.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use tauri::{AppHandle, Emitter, Manager};
use tracing::warn;

use crate::adapters::AgentAdapter;
use crate::catalog::{self, Catalog};
use crate::domain::SyncRun;
use crate::domain::{
    is_project_owner, Agent, AgentManifest, AgentRemoval, ConfigFile, ConfigFormat, Extension,
    HiddenAgent, ManifestSource, McpServer, OtherResource, Project, ProjectFolder, Proxy,
    RemovalKind, RemovalMode, Skill, SkillInstall, TerminalExit, TerminalOutput, SHARED_OWNER_ID,
};
use crate::error::{AppError, Result};
use crate::platform::PlatformContext;
use crate::services::{
    self, HubService, JobOutcome, JobOutputEvent, JobRunner, JobSink, ScanCache, ScanReport,
    ScanSink, Scanner, Settings, SettingsService, SyncService, SyncSink, SyncTarget,
    TerminalManager, TerminalSink, VersionChecker, WebService,
};

/// Event names the frontend listens to. Kept in one place so both sides cannot drift.
pub mod events {
    /// Streamed line of an install/update job.
    pub const JOB_OUTPUT: &str = "job://output";
    /// Job finished (success, failure or cancellation).
    pub const JOB_DONE: &str = "job://done";
    /// A scan started; the UI marks every agent it knows about as refreshing.
    pub const SCAN_START: &str = "scan://start";
    /// One agent finished scanning and carries its final data.
    pub const SCAN_AGENT: &str = "scan://agent";
    /// The whole report is ready.
    pub const SCAN_DONE: &str = "scan://done";
    /// A chunk of a terminal session's output (base64-encoded bytes).
    pub const TERMINAL_OUTPUT: &str = "terminal://output";
    /// The process inside a terminal session ended.
    pub const TERMINAL_EXIT: &str = "terminal://exit";
    /// The tray asked for a screen: the payload is the route to open.
    pub const TRAY_NAVIGATE: &str = "tray://navigate";
    /// The tray asked to start an agent: the payload is its id.
    pub const TRAY_RUN_AGENT: &str = "tray://run-agent";
    /// A cloud sync run finished (manual or automatic): the payload is the [`SyncRun`].
    pub const SYNC_DONE: &str = "sync://done";
}

/// Emits job progress to the webview.
pub struct TauriJobSink {
    app: AppHandle,
}

impl JobSink for TauriJobSink {
    fn output(&self, event: JobOutputEvent) {
        let _ = self.app.emit(events::JOB_OUTPUT, event);
    }

    fn finished(&self, outcome: JobOutcome) {
        let _ = self.app.emit(events::JOB_DONE, outcome);
    }
}

/// Streams scan progress to the webview.
///
/// This is what turns a rescan into per-agent feedback: each agent paints the moment its own
/// version check and config reads are done, instead of the whole list flipping at the end.
pub struct TauriScanSink {
    app: AppHandle,
}

impl ScanSink for TauriScanSink {
    fn started(&self) {
        let _ = self.app.emit(events::SCAN_START, ());
    }

    fn agent_scanned(&self, agent: &Agent) {
        let _ = self.app.emit(events::SCAN_AGENT, agent);
    }

    fn finished(&self, report: &ScanReport) {
        let _ = self.app.emit(events::SCAN_DONE, report);
        // The tray menu is built out of this report — the counts and the agents it can start —
        // so it is rebuilt for the scan that just landed, whoever asked for it.
        crate::desktop::sync(&self.app);
        // Cloud sync reads the same report: an automatic run is asked for with the freshly
        // scanned picture of what exists, so it never works from a stale one.
        let state = self.app.state::<AppState>();
        let sync = state.sync();
        sync.observe(report);
        sync.request_auto();
    }
}

/// Streams the outcome of a cloud sync run to the webview.
///
/// An automatic run has no button behind it, so this is how the screen learns that something was
/// uploaded without asking: the status query would otherwise only be as fresh as its last fetch.
pub struct TauriSyncSink {
    app: AppHandle,
}

impl SyncSink for TauriSyncSink {
    fn finished(&self, run: &SyncRun, error: Option<&str>) {
        let _ = self.app.emit(
            events::SYNC_DONE,
            crate::domain::SyncEvent {
                run: Some(run.clone()),
                error: error.map(str::to_string),
            },
        );
    }
}

/// Streams terminal output to the webview.
///
/// Terminal traffic is the highest-volume thing Ahabby emits (a TUI repaints constantly), which
/// is why the manager batches PTY reads instead of emitting per byte.
pub struct TauriTerminalSink {
    app: AppHandle,
}

impl TerminalSink for TauriTerminalSink {
    fn output(&self, event: TerminalOutput) {
        let _ = self.app.emit(events::TERMINAL_OUTPUT, event);
    }

    fn exited(&self, event: TerminalExit) {
        let _ = self.app.emit(events::TERMINAL_EXIT, event);
    }
}

/// A file the frontend is allowed to read and write.
///
/// The scan is the source of truth: a path is only ever addressable when it belongs to a
/// document that some manifest declared (a config file) or that the scan discovered from a
/// declared location (another resource file, a skill entry file). Anything else is refused,
/// so a forged path from a compromised webview cannot reach the disk.
#[derive(Debug)]
pub struct DocumentTarget {
    pub path: PathBuf,
    pub format: ConfigFormat,
    pub editable: bool,
}

/// Resolve an addressable document of one scanned agent.
///
/// Order matters: a declared config wins (manifests describe their formats precisely), then
/// a non-directory `other` resource (instructions, commands, hooks, rules), then a skill's
/// entry file, then an extension's entry file. Skills are writable exactly when Ahabby would
/// also delete them — a plugin-managed skill stays read-only, because its owner is the plugin
/// manager.
pub fn resolve_document(agent: &Agent, path: &str) -> Result<DocumentTarget> {
    resolve_in(
        &agent.configs,
        &agent.other,
        &agent.skills,
        &agent.extensions,
        &agent.name,
        path,
    )
}

/// The same resolution for any owner: the lists a document can live in, plus the name used in
/// the refusal. Split out so the shared surface — which has no `Agent` — is resolved by exactly
/// the rules (and refusals) that guard an agent's documents.
pub fn resolve_in(
    configs: &[ConfigFile],
    other: &[OtherResource],
    skills: &[Skill],
    extensions: &[Extension],
    owner: &str,
    path: &str,
) -> Result<DocumentTarget> {
    if let Some(config) = configs.iter().find(|config| config.path == path) {
        return Ok(DocumentTarget {
            path: PathBuf::from(&config.path),
            format: config.format,
            editable: config.editable,
        });
    }

    if let Some(resource) = other
        .iter()
        .find(|resource| resource.path == path && !resource.is_directory)
    {
        return Ok(DocumentTarget {
            path: PathBuf::from(&resource.path),
            format: resource.format,
            editable: true,
        });
    }

    if let Some(skill) = skills
        .iter()
        .find(|skill| skill.entry_path.as_deref() == Some(path))
    {
        return Ok(DocumentTarget {
            path: PathBuf::from(path),
            format: ConfigFormat::Markdown,
            editable: skill.removable,
        });
    }

    if let Some(extension) = extensions
        .iter()
        .find(|extension| extension.entry_path.as_deref() == Some(path))
    {
        return Ok(DocumentTarget {
            path: PathBuf::from(path),
            // An extension is a script, whatever the manifest calls it.
            format: ConfigFormat::Text,
            // Only a local extension, whose entry file Ahabby also switches, is editable.
            editable: extension.can_toggle,
        });
    }

    Err(AppError::CommandNotAllowed(format!(
        "{path} is not declared by {owner}"
    )))
}

/// A settings file edited by hand can carry an unusable proxy URL; fall back to a direct
/// connection instead of failing to start (or to run a job) — and never route traffic
/// through a proxy the user did not pick.
fn proxy_or_default(settings: &Settings) -> Proxy {
    settings.proxy().unwrap_or_else(|error| {
        warn!("ignoring invalid proxy settings: {error}");
        Proxy::none()
    })
}

pub struct AppState {
    app_data: PathBuf,
    app_config: PathBuf,
    settings: SettingsService,
    scanner: Scanner,
    scan_cache: ScanCache,
    scan_sink: Arc<dyn ScanSink>,
    jobs: Arc<JobRunner>,
    terminals: Arc<TerminalManager>,
    versions: RwLock<Arc<VersionChecker>>,
    hub: RwLock<Arc<HubService>>,
    web: WebService,
    sync: Arc<SyncService>,
}

impl AppState {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let app_data = app.path().app_data_dir().map_err(|error| {
            AppError::other(format!("cannot resolve the app data directory: {error}"))
        })?;
        let app_config = app.path().app_config_dir().map_err(|error| {
            AppError::other(format!("cannot resolve the app config directory: {error}"))
        })?;
        std::fs::create_dir_all(&app_data).map_err(|error| AppError::io(&app_data, error))?;
        std::fs::create_dir_all(&app_config).map_err(|error| AppError::io(&app_config, error))?;

        let settings = SettingsService::load(&app_config);
        let current = settings.get();
        let proxy = proxy_or_default(&current);
        let catalog = Self::load_catalog(&app_config);

        // The Hub's own sources live next to the user's manifests, and the directory exists from
        // the first run: the Hub screen points the user at it as the place to drop one.
        if let Err(error) = std::fs::create_dir_all(app_config.join("hub")) {
            warn!("could not create the hub source directory: {error}");
        }

        // A restart must not show skeletons again: seed the scanner with the previous run's
        // report from disk (if any) so the first read answers instantly, then let the normal
        // background scan replace it. The cache is not authoritative — `resolve_document`
        // still only allows paths of the agents the *current* report describes.
        let scanner = Scanner::new(&catalog);
        let scan_cache = ScanCache::new(&app_data);
        if let Some(previous) = scan_cache.load() {
            scanner.restore(previous);
        }

        Ok(Self {
            jobs: JobRunner::new(Arc::new(TauriJobSink { app: app.clone() })),
            terminals: TerminalManager::new(Arc::new(TauriTerminalSink { app: app.clone() })),
            versions: RwLock::new(Arc::new(VersionChecker::new(
                current.network_version_checks,
                current.version_cache_minutes,
                &proxy,
            ))),
            hub: RwLock::new(Arc::new(HubService::new(&proxy, &app_data))),
            web: WebService::new(&proxy),
            sync: {
                let sync = Arc::new(SyncService::new(&app_data, &app_config, &proxy));
                sync.set_settings(&current.sync);
                sync.set_sink(Arc::new(TauriSyncSink { app: app.clone() }));
                sync
            },
            scan_sink: Arc::new(TauriScanSink { app: app.clone() }),
            scanner,
            scan_cache,
            settings,
            app_data,
            app_config,
        })
    }

    fn load_catalog(app_config: &Path) -> Catalog {
        catalog::load(Some(&app_config.join("catalog")))
    }

    pub fn app_data(&self) -> &Path {
        &self.app_data
    }

    pub fn settings(&self) -> Settings {
        self.settings.get()
    }

    /// Persist settings and rebuild everything that depends on them.
    pub fn save_settings(&self, settings: Settings) -> Result<Settings> {
        // Reject an unusable manual proxy URL before it reaches the disk.
        let proxy = settings.proxy()?;
        let saved = self.settings.save(settings)?;
        if let Ok(mut versions) = self.versions.write() {
            *versions = Arc::new(VersionChecker::new(
                saved.network_version_checks,
                saved.version_cache_minutes,
                &proxy,
            ));
        }
        // The hub's cache stays valid — a proxy change is about the connection, not the data.
        if let Ok(hub) = self.hub.read() {
            hub.set_proxy(&proxy);
        }
        self.web.set_proxy(&proxy);
        // Sync follows the same rule: the new configuration decides what an automatic run covers,
        // and the proxy decides how it leaves the machine. What was uploaded stays uploaded.
        self.sync.set_settings(&saved.sync);
        self.sync.set_proxy(&proxy);
        Ok(saved)
    }

    /// Pin or unpin an agent. The id must belong to the current report, so a forged id can
    /// never end up in settings.
    pub fn set_agent_favorite(&self, id: &str, favorite: bool) -> Result<Settings> {
        self.agent(id)?;
        self.settings.set_favorite(id, favorite)
    }

    /// Remember whether the sidebar rail is collapsed. Only that field moves, and nothing derived
    /// from settings (the version checker, the hub's client) is rebuilt for a click on the rail.
    pub fn set_sidebar_collapsed(&self, collapsed: bool) -> Result<Settings> {
        self.settings.set_sidebar_collapsed(collapsed)
    }

    /// Remember the screen the window is on, so the next launch opens there.
    pub fn set_last_route(&self, route: Option<&str>) -> Result<Settings> {
        self.settings.set_last_route(route)
    }

    /// Remember that the product tour was finished or skipped.
    pub fn set_tour_completed(&self, completed: bool) -> Result<Settings> {
        self.settings.set_tour_completed(completed)
    }

    /// Adopt the login item the OS actually holds, so the settings page never claims something
    /// this machine does not do. Written by the startup check in `run()`, never by the UI.
    pub fn set_launch_at_login(&self, enabled: bool) -> Result<Settings> {
        self.settings.set_launch_at_login(enabled)
    }

    /// The proxy every version check and install job uses.
    pub fn proxy(&self) -> Proxy {
        proxy_or_default(&self.settings())
    }

    pub fn platform_context(&self) -> PlatformContext {
        self.settings
            .get()
            .platform_context(&self.app_data, &self.app_config)
    }

    pub fn version_checker(&self) -> Option<Arc<VersionChecker>> {
        let settings = self.settings();
        if !settings.network_version_checks {
            return None;
        }
        self.versions
            .read()
            .ok()
            .map(|checker| Arc::clone(&checker))
    }

    pub fn user_catalog_dir(&self) -> PathBuf {
        self.app_config.join("catalog")
    }

    /// The Hub, whose requests go out through the same proxy as every other network call.
    ///
    /// Unlike the version checks it is not a background feature — a user opening the Hub screen
    /// asked for it — so it stays available whatever `network_version_checks` says.
    pub fn hub(&self) -> Arc<HubService> {
        match self.hub.read() {
            Ok(hub) => Arc::clone(&hub),
            Err(poisoned) => Arc::clone(&poisoned.into_inner()),
        }
    }

    /// Cloud sync: the last scan's resources, the connection and the state store.
    pub fn sync(&self) -> Arc<SyncService> {
        Arc::clone(&self.sync)
    }

    /// The hub's sources: the builtin ones merged with the user's own from `<config>/hub`.
    ///
    /// Without star counts and in name order: this is what resolving an entry reads, and it asks
    /// nothing of the network. The screen's own read is [`HubService::sources_with_stars`].
    pub fn hub_sources(&self) -> crate::domain::HubSourceCatalog {
        self.hub().sources(&self.hub_source_dir())
    }

    /// Directory the user's own hub sources are read from, and dropped into by hand.
    pub fn hub_source_dir(&self) -> PathBuf {
        self.app_config.join("hub")
    }

    /// Ahabby's own browser: reads the pages and images the reader shows, through the same proxy.
    pub fn web(&self) -> &WebService {
        &self.web
    }

    /// Reload the catalog from disk (user manifests may have changed) and scan.
    pub async fn scan(&self) -> ScanReport {
        let catalog = Self::load_catalog(&self.app_config);
        self.scanner.reload(&catalog);
        let context = self.platform_context();
        // The folders the user added on the Projects screen travel with the scan, exactly like
        // the hidden agents do: they are part of what this machine holds.
        let folders = self.settings().project_folders;
        let report = self
            .scanner
            .scan(
                &context,
                self.version_checker(),
                &self.hidden_agent_ids(),
                &folders,
                Some(Arc::clone(&self.scan_sink)),
            )
            .await;
        // Best effort: a cache that cannot be written only costs one skeleton on the next
        // start, so it must never turn a successful scan into a failed command.
        if let Err(error) = self.scan_cache.save(&report) {
            warn!("could not persist the scan cache: {error}");
        }
        report
    }

    /// Ids of the agents the user removed (and that are therefore hidden from the scan).
    fn hidden_agent_ids(&self) -> Vec<String> {
        self.settings()
            .hidden_agents
            .into_iter()
            .map(|hidden| hidden.id)
            .collect()
    }

    /// Remove an agent from Ahabby, the way the user chose in the removal dialog.
    ///
    /// [`RemovalMode::Hide`] always works and only touches Ahabby's own settings. [`RemovalMode::Delete`]
    /// trashes the agent's own user-catalog manifest, and is refused for an agent whose
    /// manifest ships with Ahabby — for those the real deletion is running the manifest's
    /// uninstall command (see [`Agent::can_uninstall`]).
    pub fn remove_agent(&self, id: &str, mode: RemovalMode) -> Result<AgentRemoval> {
        let adapter = self.adapter(id)?;
        let manifest = adapter.manifest().clone();
        remove_agent_from(
            &self.settings,
            &self.user_catalog_dir(),
            id,
            &manifest,
            mode,
            |path| {
                trash::delete(path).map_err(|error| {
                    AppError::other(format!(
                        "could not move {} to the trash: {error}",
                        path.display()
                    ))
                })
            },
        )
    }

    /// Bring a hidden agent back into the list.
    pub fn restore_agent(&self, id: &str) -> Result<HiddenAgent> {
        restore_hidden_agent(&self.settings, id)
    }

    /// Add a folder to the Projects screen: it is resolved, checked to exist, and remembered.
    ///
    /// Only Ahabby's own list changes — nothing inside the folder is written until the user asks
    /// for it.
    pub fn add_project_folder(&self, path: &str) -> Result<ProjectFolder> {
        let folder = services::project::folder_for(path)?;
        self.settings.add_project_folder(folder.clone())?;
        Ok(folder)
    }

    /// Forget a folder. The projects under it simply stop being scanned; nothing on disk is
    /// touched, which is why this needs no confirmation.
    pub fn remove_project_folder(&self, folder_id: &str) -> Result<ProjectFolder> {
        self.settings.remove_project_folder(folder_id)
    }

    /// Last scan result, or an error when nothing has been scanned yet.
    pub fn report(&self) -> Result<ScanReport> {
        self.scanner
            .last_report()
            .ok_or_else(|| AppError::NotSupported("no scan has run yet".to_string()))
    }

    pub fn agent(&self, id: &str) -> Result<Agent> {
        self.report()?
            .agent(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("agent '{id}'")))
    }

    /// The project with this owner id, out of the last scan.
    pub fn project(&self, id: &str) -> Result<Project> {
        self.report()?
            .projects
            .project(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("project '{id}'")))
    }

    pub fn adapter(&self, id: &str) -> Result<Arc<dyn AgentAdapter>> {
        // The shared surface is not a catalog manifest, but deletion goes through the same
        // adapter interface, so its path checks stay identical to an agent's.
        if id == SHARED_OWNER_ID {
            return Ok(services::shared::adapter());
        }
        // A project is read through the project surface, rooted at the directory the scan found.
        // The adapter re-roots every call itself, so whatever context a command passes it can
        // only ever read inside that project.
        if is_project_owner(id) {
            let project = self.project(id)?;
            return Ok(services::project::adapter(std::path::Path::new(
                &project.root,
            )));
        }
        self.scanner
            .registry()
            .all()
            .iter()
            .find(|adapter| adapter.manifest().id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("agent '{id}'")))
    }

    /// Only documents the scan knows about can be read or written: a config declared by the
    /// manifest, a resource file the manifest declares, or a skill's entry file. A document
    /// of the shared surface (`~/.agents/...`) is addressable the same way, under its
    /// reserved id.
    pub fn document_target(&self, agent_id: &str, path: &str) -> Result<DocumentTarget> {
        if agent_id == SHARED_OWNER_ID {
            return services::shared::resolve_document(&self.report()?.shared, path);
        }
        if is_project_owner(agent_id) {
            return services::project::resolve_document(&self.project(agent_id)?, path);
        }
        resolve_document(&self.agent(agent_id)?, path)
    }

    pub fn skill(&self, agent_id: &str, skill_id: &str) -> Result<Skill> {
        if agent_id == SHARED_OWNER_ID {
            return self
                .report()?
                .shared
                .skills
                .into_iter()
                .find(|skill| skill.id == skill_id)
                .ok_or_else(|| AppError::NotFound(format!("shared skill '{skill_id}'")));
        }
        if is_project_owner(agent_id) {
            return self
                .project(agent_id)?
                .skills
                .into_iter()
                .find(|skill| skill.id == skill_id)
                .ok_or_else(|| AppError::NotFound(format!("project skill '{skill_id}'")));
        }
        self.agent(agent_id)?
            .skills
            .into_iter()
            .find(|skill| skill.id == skill_id)
            .ok_or_else(|| AppError::NotFound(format!("skill '{skill_id}'")))
    }

    pub fn mcp_server(&self, agent_id: &str, server_id: &str) -> Result<McpServer> {
        if agent_id == SHARED_OWNER_ID {
            return self
                .report()?
                .shared
                .mcp_servers
                .into_iter()
                .find(|server| server.id == server_id)
                .ok_or_else(|| AppError::NotFound(format!("shared MCP server '{server_id}'")));
        }
        if is_project_owner(agent_id) {
            return self
                .project(agent_id)?
                .mcp_servers
                .into_iter()
                .find(|server| server.id == server_id)
                .ok_or_else(|| AppError::NotFound(format!("project MCP server '{server_id}'")));
        }
        self.agent(agent_id)?
            .mcp_servers
            .into_iter()
            .find(|server| server.id == server_id)
            .ok_or_else(|| AppError::NotFound(format!("mcp server '{server_id}'")))
    }

    /// One extension of one scanned agent. Extensions belong to an agent alone: the shared
    /// surface and a project declare none, so there is no second branch here on purpose.
    pub fn extension(&self, agent_id: &str, extension_id: &str) -> Result<Extension> {
        self.agent(agent_id)?
            .extensions
            .into_iter()
            .find(|extension| extension.id == extension_id)
            .ok_or_else(|| AppError::NotFound(format!("extension '{extension_id}'")))
    }

    pub fn jobs(&self) -> Arc<JobRunner> {
        Arc::clone(&self.jobs)
    }

    pub fn terminals(&self) -> Arc<TerminalManager> {
        Arc::clone(&self.terminals)
    }

    pub fn backup_root(&self) -> PathBuf {
        self.settings().backup_root(&self.app_data)
    }

    /// Open a path in the OS file manager. Only paths inside the user's home or Ahabby's
    /// own directories are accepted, and only if they exist.
    pub fn reveal(&self, path: &str) -> Result<()> {
        let target = PathBuf::from(path);
        if !target.exists() {
            return Err(AppError::NotFound(path.to_string()));
        }
        let home = self.platform_context().home;
        let allowed = target.starts_with(&home)
            || target.starts_with(&self.app_data)
            || target.starts_with(&self.app_config);
        if !allowed {
            return Err(AppError::CommandNotAllowed(format!(
                "refusing to open {path}: outside the user's home directory"
            )));
        }

        if target.is_dir() {
            crate::platform::open::open_path(&target)
        } else {
            crate::platform::open::reveal_item(&target)
        }
    }

    /// Read one addressable document through the safe path (ownership validation included).
    pub fn read_config(&self, agent_id: &str, path: &str) -> Result<crate::domain::ConfigSnapshot> {
        let target = self.document_target(agent_id, path)?;
        services::read_snapshot(&target.path, target.format, target.editable)
    }

    /// The skills the scan reported for any owner, whichever surface it is.
    fn owner_skills(&self, owner_id: &str) -> Vec<Skill> {
        if owner_id == SHARED_OWNER_ID {
            return self
                .report()
                .map(|report| report.shared.skills)
                .unwrap_or_default();
        }
        if is_project_owner(owner_id) {
            return self
                .project(owner_id)
                .map(|project| project.skills)
                .unwrap_or_default();
        }
        self.report()
            .ok()
            .and_then(|report| report.agent(owner_id).map(|agent| agent.skills.clone()))
            .unwrap_or_default()
    }
}

/// How cloud sync writes a restore back into this machine.
///
/// Both writes are the app's own checked paths — an edit and a skill install — so a payload that
/// arrived from a cloud can only ever land where the target owner's manifest declares a place for
/// it: [`AppState::document_target`] refuses a path no manifest described, and
/// `AgentAdapter::install_skill` derives the skill directory itself.
#[async_trait::async_trait]
impl SyncTarget for AppState {
    async fn write_file(&self, owner_id: &str, path: &str, bytes: &[u8]) -> Result<()> {
        let target = self.document_target(owner_id, path)?;
        if !target.editable {
            return Err(AppError::CommandNotAllowed(format!("{path} is read-only")));
        }
        crate::platform::write_atomic_bytes(&target.path, bytes, Some(&self.backup_root()))?;
        Ok(())
    }

    async fn install_skill(&self, owner_id: &str, install: SkillInstall) -> Result<String> {
        let adapter = self.adapter(owner_id)?;
        let context = self.platform_context();
        let skill = adapter.install_skill(&context, &install).await?;
        Ok(skill.path)
    }

    fn skills_root(&self, owner_id: &str) -> Option<String> {
        let skill = self.owner_skills(owner_id).into_iter().next()?;
        Path::new(&skill.path)
            .parent()
            .map(|parent| parent.to_string_lossy().to_string())
    }

    fn owner_name(&self, owner_id: &str) -> Option<String> {
        if owner_id == SHARED_OWNER_ID {
            return Some("Shared".to_string());
        }
        if is_project_owner(owner_id) {
            return self.project(owner_id).ok().map(|project| project.name);
        }
        self.report()
            .ok()?
            .agent(owner_id)
            .map(|agent| agent.name.clone())
    }

    fn owner_exists(&self, owner_id: &str) -> bool {
        if owner_id == SHARED_OWNER_ID {
            return true;
        }
        if is_project_owner(owner_id) {
            return self.project(owner_id).is_ok();
        }
        self.report()
            .map(|report| report.agent(owner_id).is_some())
            .unwrap_or(false)
    }
}

/// The file behind a user manifest, checked to be a direct `*.toml` child of Ahabby's own
/// catalog directory. The scan only ever reads that directory, so this can only ever delete
/// a manifest Ahabby itself loaded — never an arbitrary path a manifest might claim.
pub(crate) fn user_manifest_path(catalog_dir: &Path, source: &str) -> Result<PathBuf> {
    let path = PathBuf::from(source);
    let is_child = path.parent() == Some(catalog_dir)
        && path.extension().and_then(|extension| extension.to_str()) == Some("toml");
    if !is_child {
        return Err(AppError::CommandNotAllowed(format!(
            "{source} is not a manifest in Ahabby's catalog directory"
        )));
    }
    Ok(path)
}

/// Remove an agent, given the manifest the catalog resolved for it.
///
/// `trash_file` is the only thing that touches the deleted file, which keeps the decision
/// and the path check testable without moving anything to a real trash. `mode` is what the
/// user picked: hiding always works, while deleting a file is only legal when the manifest
/// lives in Ahabby's own user catalog.
pub(crate) fn remove_agent_from<F>(
    settings: &SettingsService,
    catalog_dir: &Path,
    id: &str,
    manifest: &AgentManifest,
    mode: RemovalMode,
    trash_file: F,
) -> Result<AgentRemoval>
where
    F: FnOnce(&Path) -> Result<()>,
{
    let mut current = settings.get();
    if current.hidden_agents.iter().any(|hidden| hidden.id == id) {
        return Err(AppError::NotFound(format!(
            "agent '{id}' has already been removed"
        )));
    }

    let mut path = None;
    match (
        mode,
        RemovalKind::for_manifest(&manifest.source, catalog::is_builtin_id(id)),
    ) {
        // Hiding is the universal, reversible choice: nothing on disk is touched.
        (RemovalMode::Hide, _) => {
            current.hidden_agents.push(HiddenAgent {
                id: id.to_string(),
                name: manifest.name.clone(),
                icon: manifest.icon.clone(),
                removed_at_ms: crate::platform::now_ms(),
            });
            settings.save(current)?;
        }
        (RemovalMode::Delete, RemovalKind::Manifest) => {
            let ManifestSource::User { path: source } = &manifest.source else {
                return Err(AppError::other(format!(
                    "manifest of '{id}' has no file in the user catalog"
                )));
            };
            let target = user_manifest_path(catalog_dir, source)?;
            trash_file(&target)?;
            path = Some(target.to_string_lossy().to_string());
        }
        (RemovalMode::Delete, RemovalKind::Hidden) => {
            return Err(AppError::NotSupported(format!(
                "the manifest of '{id}' ships with Ahabby and cannot be deleted; only hiding \
                 it or uninstalling the agent itself is possible"
            )));
        }
    }

    Ok(AgentRemoval {
        agent_id: id.to_string(),
        name: manifest.name.clone(),
        deleted: path.is_some(),
        path,
    })
}

/// Bring a hidden agent back; refuses an id that is not hidden.
pub(crate) fn restore_hidden_agent(settings: &SettingsService, id: &str) -> Result<HiddenAgent> {
    let mut current = settings.get();
    let index = current
        .hidden_agents
        .iter()
        .position(|hidden| hidden.id == id)
        .ok_or_else(|| AppError::NotFound(format!("agent '{id}' is not hidden")))?;
    let hidden = current.hidden_agents.remove(index);
    settings.save(current)?;
    Ok(hidden)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_names_are_stable() {
        // The frontend listens on these exact strings (src/shared/api/events.ts).
        assert_eq!(events::JOB_OUTPUT, "job://output");
        assert_eq!(events::JOB_DONE, "job://done");
        assert_eq!(events::SCAN_START, "scan://start");
        assert_eq!(events::SCAN_AGENT, "scan://agent");
        assert_eq!(events::SCAN_DONE, "scan://done");
        assert_eq!(events::TERMINAL_OUTPUT, "terminal://output");
        assert_eq!(events::TERMINAL_EXIT, "terminal://exit");
        assert_eq!(events::TRAY_NAVIGATE, "tray://navigate");
        assert_eq!(events::TRAY_RUN_AGENT, "tray://run-agent");
    }

    fn manifest(id: &str, source: ManifestSource) -> AgentManifest {
        let raw = format!(
            r#"
id = "{id}"
name = "Test {id}"
description = "used by tests"

[binaries]
names = ["{id}"]
"#
        );
        let mut manifest = crate::catalog::parse_manifest(&raw, "test").unwrap();
        manifest.source = source;
        manifest
    }

    fn settings_service(dir: &Path) -> SettingsService {
        SettingsService::load(dir)
    }

    #[test]
    fn user_manifest_path_stays_inside_the_catalog_directory() {
        let catalog = Path::new("/cfg/catalog");
        assert_eq!(
            user_manifest_path(catalog, "/cfg/catalog/demo.toml").unwrap(),
            PathBuf::from("/cfg/catalog/demo.toml")
        );

        for refused in [
            "/etc/demo.toml",
            "/cfg/catalog/nested/demo.toml",
            "/cfg/catalog/demo.json",
            "/cfg/other/../catalog/demo.toml",
        ] {
            let error = user_manifest_path(catalog, refused).unwrap_err();
            assert_eq!(error.code(), "command_not_allowed", "for {refused}");
        }
    }

    #[test]
    fn hiding_a_shipped_agent_is_reversible_and_touches_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let settings = settings_service(dir.path());
        let manifest = manifest("demo", ManifestSource::Builtin);

        let removal = remove_agent_from(
            &settings,
            Path::new("/cfg/catalog"),
            "demo",
            &manifest,
            RemovalMode::Hide,
            |_| panic!("hiding must never delete a file"),
        )
        .unwrap();
        assert!(!removal.deleted);
        assert!(removal.path.is_none());
        assert_eq!(settings.get().hidden_agents.len(), 1);
        assert_eq!(settings.get().hidden_agents[0].name, "Test demo");

        // Removing twice is refused instead of piling up duplicates.
        let error = remove_agent_from(
            &settings,
            Path::new("/cfg/catalog"),
            "demo",
            &manifest,
            RemovalMode::Hide,
            |_| panic!("never reached"),
        )
        .unwrap_err();
        assert_eq!(error.code(), "not_found");

        let restored = restore_hidden_agent(&settings, "demo").unwrap();
        assert_eq!(restored.id, "demo");
        assert!(settings.get().hidden_agents.is_empty());
        assert_eq!(
            restore_hidden_agent(&settings, "demo").unwrap_err().code(),
            "not_found"
        );
    }

    #[test]
    fn hiding_a_user_manifest_keeps_its_file() {
        let dir = tempfile::tempdir().unwrap();
        let settings = settings_service(dir.path());
        let catalog = dir.path().join("catalog");
        std::fs::create_dir_all(&catalog).unwrap();
        let file = catalog.join("demo.toml");
        std::fs::write(&file, "id = \"demo\"\n").unwrap();
        let manifest = manifest(
            "demo",
            ManifestSource::User {
                path: file.to_string_lossy().to_string(),
            },
        );

        let removal = remove_agent_from(
            &settings,
            &catalog,
            "demo",
            &manifest,
            RemovalMode::Hide,
            |_| panic!("hiding must never delete the manifest"),
        )
        .unwrap();

        assert!(!removal.deleted);
        assert!(removal.path.is_none());
        assert_eq!(settings.get().hidden_agents.len(), 1);
        assert!(file.exists(), "the manifest stays on disk");
    }

    #[test]
    fn deleting_a_user_manifest_trashes_the_file() {
        let dir = tempfile::tempdir().unwrap();
        let settings = settings_service(dir.path());
        let catalog = dir.path().join("catalog");
        std::fs::create_dir_all(&catalog).unwrap();
        let file = catalog.join("demo.toml");
        std::fs::write(&file, "id = \"demo\"\n").unwrap();
        let manifest = manifest(
            "demo",
            ManifestSource::User {
                path: file.to_string_lossy().to_string(),
            },
        );

        let mut trashed: Option<PathBuf> = None;
        let removal = remove_agent_from(
            &settings,
            &catalog,
            "demo",
            &manifest,
            RemovalMode::Delete,
            |path| {
                trashed = Some(path.to_path_buf());
                Ok(())
            },
        )
        .unwrap();

        assert!(removal.deleted);
        assert_eq!(
            removal.path.as_deref(),
            Some(file.to_string_lossy().as_ref())
        );
        assert_eq!(trashed.as_deref(), Some(file.as_path()));
        assert!(
            settings.get().hidden_agents.is_empty(),
            "a deleted manifest needs no hidden entry"
        );
    }

    #[test]
    fn deleting_a_shipped_agent_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let settings = settings_service(dir.path());
        let manifest = manifest("demo", ManifestSource::Builtin);

        let error = remove_agent_from(
            &settings,
            Path::new("/cfg/catalog"),
            "demo",
            &manifest,
            RemovalMode::Delete,
            |_| panic!("a shipped manifest must never be deleted"),
        )
        .unwrap_err();
        assert_eq!(error.code(), "not_supported");
        assert!(settings.get().hidden_agents.is_empty());
    }

    #[test]
    fn deleting_a_user_override_of_a_builtin_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let settings = settings_service(dir.path());
        let id = catalog::builtin_ids()
            .first()
            .copied()
            .expect("builtin manifests ship with the app");
        let manifest = manifest(
            id,
            ManifestSource::User {
                path: dir
                    .path()
                    .join(format!("{id}.toml"))
                    .to_string_lossy()
                    .to_string(),
            },
        );

        // Deleting the override would resurrect the builtin, so it is refused.
        let error = remove_agent_from(
            &settings,
            dir.path(),
            id,
            &manifest,
            RemovalMode::Delete,
            |_| panic!("deleting the override would resurrect the builtin manifest"),
        )
        .unwrap_err();
        assert_eq!(error.code(), "not_supported");

        // Hiding it, however, stays available.
        let removal = remove_agent_from(
            &settings,
            dir.path(),
            id,
            &manifest,
            RemovalMode::Hide,
            |_| panic!("never reached"),
        )
        .unwrap();
        assert!(!removal.deleted);
        assert_eq!(settings.get().hidden_agents[0].id, id);
    }

    #[test]
    fn a_manifest_outside_the_catalog_directory_is_never_trashed() {
        let dir = tempfile::tempdir().unwrap();
        let settings = settings_service(dir.path());
        let manifest = manifest(
            "demo",
            ManifestSource::User {
                path: "/somewhere/else/demo.toml".to_string(),
            },
        );

        let error = remove_agent_from(
            &settings,
            dir.path(),
            "demo",
            &manifest,
            RemovalMode::Delete,
            |_| panic!("the path check must run before any deletion"),
        )
        .unwrap_err();
        assert_eq!(error.code(), "command_not_allowed");
    }
}
