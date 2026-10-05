//! User settings: the only mutable state Ahabby owns.
//!
//! Stored as JSON inside the app config directory. Every field has a safe default, so a
//! missing or corrupted file never prevents the app from starting.

use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::domain::{Proxy, ProxyMode};
use crate::error::{AppError, Result};
use crate::platform::{self, PlatformContext};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum Language {
    #[default]
    En,
    Ru,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum Theme {
    #[default]
    System,
    Light,
    Dark,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Settings {
    pub language: Language,
    pub theme: Theme,
    /// Extra directories that are searched for agent binaries and configs.
    pub extra_scan_paths: Vec<String>,
    /// Turns the optional "a newer version exists" checks on/off (no network by default
    /// is *not* the default: they are on, but never block a scan).
    pub network_version_checks: bool,
    /// Overrides where backups go. `None` means `<app data>/backups`.
    pub backup_dir: Option<String>,
    /// How long a version check result is reused.
    pub version_cache_minutes: u32,
    /// How Ahabby reaches the network. Defaults to a direct connection.
    pub proxy_mode: ProxyMode,
    /// Manual proxy URL (`http://host:port`); only read when `proxy_mode` is `manual`.
    pub proxy_url: Option<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::default(),
            theme: Theme::default(),
            extra_scan_paths: Vec::new(),
            network_version_checks: true,
            backup_dir: None,
            version_cache_minutes: 60,
            proxy_mode: ProxyMode::None,
            proxy_url: None,
        }
    }
}

impl Settings {
    /// Validated proxy configuration for version checks and install/update jobs.
    pub fn proxy(&self) -> Result<Proxy> {
        match self.proxy_mode {
            ProxyMode::None => Ok(Proxy::none()),
            ProxyMode::System => Ok(Proxy::system()),
            ProxyMode::Manual => Proxy::manual(self.proxy_url.as_deref().unwrap_or_default()),
        }
    }

    /// Where backups actually go.
    pub fn backup_root(&self, app_data: &Path) -> PathBuf {
        match &self.backup_dir {
            Some(path) if !path.trim().is_empty() => PathBuf::from(path),
            _ => app_data.join("backups"),
        }
    }

    /// Build the platform context for the next scan.
    pub fn platform_context(&self, app_data: &Path, app_config: &Path) -> PlatformContext {
        let extra = self
            .extra_scan_paths
            .iter()
            .map(|path| path.trim())
            .filter(|path| !path.is_empty())
            .map(PathBuf::from)
            .collect::<Vec<_>>();
        let mut context =
            PlatformContext::detect(app_data.to_path_buf(), app_config.to_path_buf(), extra);
        context.backup_root = self.backup_root(app_data);
        context
    }
}

/// Loads, holds and persists [`Settings`].
pub struct SettingsService {
    path: PathBuf,
    settings: RwLock<Settings>,
}

impl SettingsService {
    pub fn load(app_config: &Path) -> Self {
        let path = app_config.join("settings.json");
        let settings = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<Settings>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            settings: RwLock::new(settings),
        }
    }

    pub fn get(&self) -> Settings {
        self.settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub fn save(&self, settings: Settings) -> Result<Settings> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AppError::InvalidInput("settings path has no parent".to_string()))?;
        std::fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;

        // Settings are ours: no diff prompt, but still an atomic write.
        platform::write_atomic(&self.path, &serde_json::to_string_pretty(&settings)?, None)?;

        if let Ok(mut guard) = self.settings.write() {
            *guard = settings.clone();
        }
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_are_safe() {
        let settings = Settings::default();
        assert!(settings.network_version_checks);
        assert_eq!(settings.language, Language::En);
        assert_eq!(settings.theme, Theme::System);
        assert_eq!(settings.proxy_mode, ProxyMode::None);
        assert!(settings.proxy_url.is_none());
        assert_eq!(settings.proxy().unwrap(), Proxy::none());
    }

    #[test]
    fn proxy_round_trips_and_is_validated() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        let mut settings = service.get();
        settings.proxy_mode = ProxyMode::Manual;
        settings.proxy_url = Some("http://127.0.0.1:7890".to_string());
        service.save(settings).unwrap();

        let reloaded = SettingsService::load(dir.path()).get();
        assert_eq!(reloaded.proxy_mode, ProxyMode::Manual);
        assert_eq!(
            reloaded.proxy().unwrap().url(),
            Some("http://127.0.0.1:7890/")
        );

        let mut broken = reloaded;
        broken.proxy_url = Some("127.0.0.1:7890".to_string());
        assert_eq!(broken.proxy().unwrap_err().code(), "invalid_input");
    }

    #[test]
    fn missing_file_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        assert_eq!(service.get(), Settings::default());
    }

    #[test]
    fn round_trips_and_survives_corruption() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        let mut settings = service.get();
        settings.language = Language::Ru;
        settings.theme = Theme::Dark;
        settings.extra_scan_paths = vec!["/opt/agents".to_string()];
        service.save(settings.clone()).unwrap();

        let reloaded = SettingsService::load(dir.path());
        assert_eq!(reloaded.get(), settings);

        std::fs::write(service.path(), "{not json").unwrap();
        let corrupted = SettingsService::load(dir.path());
        assert_eq!(corrupted.get(), Settings::default());
    }

    #[test]
    fn partial_settings_files_keep_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("settings.json"), r#"{"language":"ru"}"#).unwrap();
        let service = SettingsService::load(dir.path());
        let settings = service.get();
        assert_eq!(settings.language, Language::Ru);
        assert!(
            settings.network_version_checks,
            "missing keys fall back to defaults"
        );
        assert_eq!(settings.version_cache_minutes, 60);
    }

    #[test]
    fn backup_root_honours_override() {
        let mut settings = Settings::default();
        assert_eq!(
            settings.backup_root(Path::new("/data")),
            PathBuf::from("/data/backups")
        );
        settings.backup_dir = Some("/custom".to_string());
        assert_eq!(
            settings.backup_root(Path::new("/data")),
            PathBuf::from("/custom")
        );

        let context = settings.platform_context(Path::new("/data"), Path::new("/cfg"));
        assert_eq!(context.backup_root, PathBuf::from("/custom"));
    }
}
