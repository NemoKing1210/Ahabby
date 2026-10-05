//! Application state shared by all Tauri commands.
//!
//! This is where the whole backend is wired together once: catalog → adapters → scanner →
//! services. Commands get a `State<AppState>` and stay thin.

use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

use tauri::{AppHandle, Emitter, Manager};

use crate::adapters::AgentAdapter;
use crate::catalog::{self, Catalog};
use crate::domain::{Agent, ConfigFormat, McpServer, Skill};
use crate::error::{AppError, Result};
use crate::platform::PlatformContext;
use crate::services::{
    self, JobOutcome, JobOutputEvent, JobRunner, JobSink, ScanReport, Scanner, Settings,
    SettingsService, VersionChecker,
};

/// Event names the frontend listens to. Kept in one place so both sides cannot drift.
pub mod events {
    /// Streamed line of an install/update job.
    pub const JOB_OUTPUT: &str = "job://output";
    /// Job finished (success, failure or cancellation).
    pub const JOB_DONE: &str = "job://done";
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

/// A config file the frontend is allowed to read and write.
pub struct ConfigTarget {
    pub path: PathBuf,
    pub format: ConfigFormat,
    pub editable: bool,
}

pub struct AppState {
    app_data: PathBuf,
    app_config: PathBuf,
    settings: SettingsService,
    scanner: Scanner,
    jobs: Arc<JobRunner>,
    versions: RwLock<Arc<VersionChecker>>,
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
        let catalog = Self::load_catalog(&app_config);

        Ok(Self {
            jobs: JobRunner::new(Arc::new(TauriJobSink { app: app.clone() })),
            versions: RwLock::new(Arc::new(VersionChecker::new(
                current.network_version_checks,
                current.version_cache_minutes,
            ))),
            scanner: Scanner::new(&catalog),
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
        let saved = self.settings.save(settings)?;
        if let Ok(mut versions) = self.versions.write() {
            *versions = Arc::new(VersionChecker::new(
                saved.network_version_checks,
                saved.version_cache_minutes,
            ));
        }
        Ok(saved)
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

    /// Reload the catalog from disk (user manifests may have changed) and scan.
    pub async fn scan(&self) -> ScanReport {
        let catalog = Self::load_catalog(&self.app_config);
        self.scanner.reload(&catalog);
        let context = self.platform_context();
        self.scanner.scan(&context, self.version_checker()).await
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

    pub fn adapter(&self, id: &str) -> Result<Arc<dyn AgentAdapter>> {
        self.scanner
            .registry()
            .all()
            .iter()
            .find(|adapter| adapter.manifest().id == id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("agent '{id}'")))
    }

    /// Only config files that the catalog knows about can be read or written.
    pub fn config_target(&self, agent_id: &str, path: &str) -> Result<ConfigTarget> {
        let agent = self.agent(agent_id)?;
        let config = agent
            .configs
            .iter()
            .find(|config| config.path == path)
            .ok_or_else(|| {
                AppError::CommandNotAllowed(format!("{path} is not declared by {}", agent.name))
            })?;
        Ok(ConfigTarget {
            path: PathBuf::from(&config.path),
            format: config.format,
            editable: config.editable,
        })
    }

    pub fn skill(&self, agent_id: &str, skill_id: &str) -> Result<Skill> {
        self.agent(agent_id)?
            .skills
            .into_iter()
            .find(|skill| skill.id == skill_id)
            .ok_or_else(|| AppError::NotFound(format!("skill '{skill_id}'")))
    }

    pub fn mcp_server(&self, agent_id: &str, server_id: &str) -> Result<McpServer> {
        self.agent(agent_id)?
            .mcp_servers
            .into_iter()
            .find(|server| server.id == server_id)
            .ok_or_else(|| AppError::NotFound(format!("mcp server '{server_id}'")))
    }

    pub fn jobs(&self) -> Arc<JobRunner> {
        Arc::clone(&self.jobs)
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

    /// Read a config file through the safe path (validation of ownership included).
    pub fn read_config(&self, agent_id: &str, path: &str) -> Result<crate::domain::ConfigSnapshot> {
        let target = self.config_target(agent_id, path)?;
        services::read_snapshot(&target.path, target.format, target.editable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn event_names_are_stable() {
        // The frontend listens on these exact strings (src/shared/api/events.ts).
        assert_eq!(events::JOB_OUTPUT, "job://output");
        assert_eq!(events::JOB_DONE, "job://done");
    }
}
