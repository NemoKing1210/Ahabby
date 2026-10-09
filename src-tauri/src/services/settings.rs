//! User settings: the only mutable state Ahabby owns.
//!
//! Stored as JSON inside the app config directory. Every field has a safe default, so a
//! missing or corrupted file never prevents the app from starting.

use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::RwLock;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::domain::{HiddenAgent, ProjectFolder, Proxy, ProxyMode, SyncKind, SyncSettings};
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
    Zh,
    Es,
    De,
    Ja,
    Fr,
}

impl Language {
    /// Stable code stored in settings and passed to the webview.
    pub fn code(self) -> &'static str {
        match self {
            Language::En => "en",
            Language::Ru => "ru",
            Language::Zh => "zh",
            Language::Es => "es",
            Language::De => "de",
            Language::Ja => "ja",
            Language::Fr => "fr",
        }
    }
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

/// Accent colour picked in Settings. `Custom` reads [`Settings::accent_custom`]; every other
/// variant maps to a preset hue the frontend owns.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum AccentColor {
    #[default]
    Clay,
    Indigo,
    Sky,
    Teal,
    Green,
    Amber,
    Violet,
    Rose,
    Graphite,
    Custom,
}

/// Interface typeface. `Serif` is the bundled Lora; `System` uses whatever the OS ships.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum FontFamily {
    #[default]
    Inter,
    System,
    Serif,
}

/// Typeface used for code, paths and the config editor.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum MonoFont {
    #[default]
    Jetbrains,
    System,
}

/// Colour scheme painted by the built-in terminal.
///
/// `Auto` follows the rest of the interface — the app theme, the accent and the design tokens —
/// while every other variant names a fixed palette. The list is what *validates* the setting: the
/// frontend owns the hexes (`src/features/terminal/lib/themes.ts`) but only for the ids declared
/// here, so a hand-edited file cannot ask for a scheme nobody can paint.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum TerminalTheme {
    #[default]
    Auto,
    OneDark,
    Dracula,
    Nord,
    Gruvbox,
    TokyoNight,
    Catppuccin,
    SolarizedDark,
    SolarizedLight,
    OneLight,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Settings {
    pub language: Language,
    pub theme: Theme,
    /// Accent colour of the interface.
    pub accent: AccentColor,
    /// `#rrggbb` used when `accent` is [`AccentColor::Custom`]; ignored otherwise.
    pub accent_custom: Option<String>,
    /// Percent that scales spacing, controls, icons and corner radii.
    pub interface_scale: u32,
    /// Percent that scales type only.
    pub text_scale: u32,
    /// Interface typeface.
    pub font_family: FontFamily,
    /// Typeface used for code, paths and the config editor.
    pub mono_font: MonoFont,
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
    /// Agents the user removed from Ahabby that are still on disk. A shipped agent (or a
    /// user manifest that overrides one) can only be hidden, never deleted.
    pub hidden_agents: Vec<HiddenAgent>,
    /// Agent ids the user pinned as favourites, in the order they were added. The list is
    /// what puts them first in the agents list and in the sidebar.
    pub favorite_agents: Vec<String>,
    /// Where "run in terminal" sends an agent: `"builtin"` for Ahabby's own terminal, or the
    /// id of an external terminal from `platform::terminals` (checked against the table here,
    /// so a hand-edited file cannot smuggle in an unknown program).
    pub terminal: String,
    /// Colours of the built-in terminal.
    pub terminal_theme: TerminalTheme,
    /// Folders the user added to the Projects screen. Ahabby looks for projects inside each of
    /// them (and treats the folder itself as one when it holds none) and reads the project-local
    /// skills, MCP servers and documents it finds. Only Ahabby's own list changes — nothing is
    /// written until the user edits something inside a project.
    pub project_folders: Vec<ProjectFolder>,
    /// Whether Ahabby starts with the system: the login item is registered on save and taken
    /// back when this goes off. The one setting here that changes something *outside* the app
    /// config directory, which is why [`SettingsService::save`] is not the one that applies it —
    /// see `desktop::autostart`.
    pub launch_at_login: bool,
    /// Whether Ahabby keeps an icon in the system tray. The tray is what a minimized Ahabby is
    /// reached through, so turning it off also turns off the two settings below.
    pub tray_icon: bool,
    /// Whether the window's close button hides Ahabby in the tray instead of quitting it. The
    /// window is not closed at all, so the webview, the scan and any running install survive.
    pub close_to_tray: bool,
    /// Whether a launch opens the window on screen. Off means Ahabby comes up in the tray
    /// (unless the tray could not be created, when the window is shown anyway so the user is
    /// never left with a process that has no surface).
    pub start_minimized: bool,
    /// Interface state the shell remembers between launches — *not* something the Settings page
    /// edits. The settings document is the one place Ahabby persists anything, so "where was I"
    /// lives here too instead of in a second file; [`SettingsService::save`] deliberately keeps
    /// whatever these two fields already hold, so a whole-document save from the Settings page
    /// (whose copy predates the last collapse or navigation) cannot roll them back.
    ///
    /// Whether the sidebar rail is collapsed.
    pub sidebar_collapsed: bool,
    /// The screen the window was on (`/agents`, `/settings/terminal`, …). `None` opens the home
    /// screen. `boot()` reads it before the first render, so the app opens where the user left
    /// it instead of painting home and navigating away.
    pub last_route: Option<String>,
    /// Whether the product tour has been finished or skipped. Shell-owned like the rail: a
    /// whole-document save keeps whatever this field already holds. Older settings files that
    /// omit the key deserialize as completed so an upgrade does not re-show the tour; a brand-new
    /// install starts with [`Settings::default`]'s `false`.
    #[serde(default = "default_tour_completed")]
    pub tour_completed: bool,
    /// Cloud sync: whether it is on, where copies are kept and what an automatic run covers.
    ///
    /// Non-secret by construction — the token lives in its own file (`sync/credentials.json`),
    /// which the frontend never reads. A settings file written before the feature existed has no
    /// `sync` key and deserializes as [`SyncSettings::default`] (off, manual).
    #[serde(default)]
    pub sync: SyncSettings,
}

/// Serde default for a missing `tourCompleted` key in an existing settings file.
fn default_tour_completed() -> bool {
    true
}

/// Longest remembered route Ahabby keeps. Every real screen is far shorter; anything longer is
/// junk that came from a hand-edited file.
const MAX_ROUTE_LEN: usize = 200;

/// Clean a remembered route, or drop it.
///
/// Only an absolute, single-slash path with plain segments survives: the value is navigated to on
/// the next launch, so `..`, an empty segment, whitespace and anything absurdly long are refused
/// instead of being handed to the router.
fn normalize_route(route: &str) -> Option<String> {
    let route = route.trim();
    let usable = route.len() <= MAX_ROUTE_LEN
        && route.starts_with('/')
        && (route == "/" || !route.ends_with('/'))
        && !route.contains("//")
        && !route
            .split('/')
            .any(|segment| segment == "." || segment == "..")
        && !route
            .chars()
            .any(|character| character.is_whitespace() || character.is_control());
    usable.then(|| route.to_string())
}

fn is_hex_color(value: &str) -> bool {
    let trimmed = value.trim();
    let digits = trimmed.strip_prefix('#').unwrap_or(trimmed);
    matches!(digits.len(), 3 | 6)
        && digits
            .chars()
            .all(|character| character.is_ascii_hexdigit())
}

/// Percent scales are clamped to this range; the UI offers a few steps inside it.
const MIN_SCALE: u32 = 80;
const MAX_SCALE: u32 = 150;
const DEFAULT_SCALE: u32 = 100;

impl Default for Settings {
    fn default() -> Self {
        Self {
            language: Language::default(),
            theme: Theme::default(),
            accent: AccentColor::default(),
            accent_custom: None,
            interface_scale: DEFAULT_SCALE,
            text_scale: DEFAULT_SCALE,
            font_family: FontFamily::default(),
            mono_font: MonoFont::default(),
            extra_scan_paths: Vec::new(),
            network_version_checks: true,
            backup_dir: None,
            version_cache_minutes: 60,
            proxy_mode: ProxyMode::None,
            proxy_url: None,
            hidden_agents: Vec::new(),
            favorite_agents: Vec::new(),
            terminal: crate::platform::terminals::BUILTIN_ID.to_string(),
            terminal_theme: TerminalTheme::Auto,
            project_folders: Vec::new(),
            // Ahabby is a control panel the user opens and closes, so nothing is registered with
            // the OS and no window is hidden from them until they ask for it — but the tray icon
            // itself is on: that is what makes closing the window a choice.
            launch_at_login: false,
            tray_icon: true,
            close_to_tray: true,
            start_minimized: false,
            sidebar_collapsed: false,
            last_route: None,
            tour_completed: false,
            sync: SyncSettings::default(),
        }
    }
}

impl Settings {
    /// Forces hand-edited values back into a shape the frontend can render: scales inside
    /// their range, a custom accent that is actually a colour (or the default preset).
    pub fn sanitized(mut self) -> Self {
        self.interface_scale = self.interface_scale.clamp(MIN_SCALE, MAX_SCALE);
        self.text_scale = self.text_scale.clamp(MIN_SCALE, MAX_SCALE);
        self.accent_custom = self
            .accent_custom
            .map(|value| value.trim().to_string())
            .filter(|value| is_hex_color(value));
        if self.accent == AccentColor::Custom && self.accent_custom.is_none() {
            self.accent = AccentColor::Clay;
        }
        // A hand-edited favourites list keeps its order but never repeats an id or a blank.
        let mut seen = HashSet::new();
        self.favorite_agents = std::mem::take(&mut self.favorite_agents)
            .into_iter()
            .map(|id| id.trim().to_string())
            .filter(|id| !id.is_empty() && seen.insert(id.clone()))
            .collect();
        // Same for the project folders: a hand-edited list keeps its order, drops blanks, and
        // gets its ids recomputed from the paths — the id is what the scan reports and what the
        // frontend addresses a folder by.
        let mut seen_folders = HashSet::new();
        self.project_folders = std::mem::take(&mut self.project_folders)
            .into_iter()
            .filter_map(|mut folder| {
                folder.path = folder.path.trim().to_string();
                if folder.path.is_empty() {
                    return None;
                }
                folder.id = ProjectFolder::id_for(&folder.path);
                seen_folders.insert(folder.id.clone()).then_some(folder)
            })
            .collect();
        // A remembered route is kept only when it is one the router can resolve: a hand-edited
        // file must not be able to point the shell at a screen that does not exist.
        self.last_route = self.last_route.as_deref().and_then(normalize_route);
        // The terminal must be one Ahabby knows how to start. A terminal that is merely *not
        // installed right now* keeps its place in the setting: the UI flags it and the user can
        // reinstall it, which a silent reset to the built-in terminal would not allow.
        self.terminal = {
            let requested = self.terminal.trim();
            let known = requested == platform::terminals::BUILTIN_ID
                || platform::terminals::spec(requested).is_some();
            if known {
                requested.to_string()
            } else {
                platform::terminals::BUILTIN_ID.to_string()
            }
        };
        // Without a tray icon a hidden window has no way back, so neither field that can hide it
        // is allowed to stand on its own: a hand-edited file cannot leave Ahabby running with no
        // surface at all.
        if !self.tray_icon {
            self.close_to_tray = false;
            self.start_minimized = false;
        }
        // Cloud sync: the interval and the size cap are bounded, and the three lists are
        // hand-editable file input like every other list here — blanks, duplicates and a kind the
        // cloud no longer accepts go.
        self.sync.auto_interval_minutes = self
            .sync
            .auto_interval_minutes
            .clamp(SyncSettings::MIN_INTERVAL, SyncSettings::MAX_INTERVAL);
        self.sync.max_file_bytes = self
            .sync
            .max_file_bytes
            .clamp(1024, SyncSettings::MAX_MAX_BYTES);
        let mut seen_kinds: HashSet<SyncKind> = HashSet::new();
        self.sync
            .auto_kinds
            .retain(|kind| SyncKind::SYNCABLE.contains(kind) && seen_kinds.insert(*kind));
        let mut seen_owners: HashSet<String> = HashSet::new();
        self.sync.auto_owners = std::mem::take(&mut self.sync.auto_owners)
            .into_iter()
            .map(|owner| owner.trim().to_string())
            .filter(|owner| !owner.is_empty() && seen_owners.insert(owner.clone()))
            .collect();
        self.sync.exclude_patterns = std::mem::take(&mut self.sync.exclude_patterns)
            .into_iter()
            .map(|pattern| pattern.trim().to_string())
            .filter(|pattern| !pattern.is_empty())
            .collect();
        self
    }

    /// Whether a launch should leave the window hidden, so the user lands on the tray icon.
    ///
    /// The tray icon is part of the answer — [`Settings::sanitized`] refuses the two together —
    /// but the caller still has to check that the tray *exists*: a platform where it could not be
    /// created must never leave Ahabby running with no surface to click.
    pub fn starts_in_tray(&self) -> bool {
        self.tray_icon && self.start_minimized
    }

    /// Whether the window's close button should hide Ahabby in the tray instead of quitting it.
    pub fn keeps_running_in_tray(&self) -> bool {
        self.tray_icon && self.close_to_tray
    }

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
            .map(Settings::sanitized)
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

    /// Write a whole settings document — what the Settings page does.
    ///
    /// The sidebar, the remembered screen and the tour flag belong to the shell, and a
    /// whole-document save is never about them: the Settings page saves a copy fetched before the
    /// user last collapsed the rail, navigated or finished the tour, so writing that copy back
    /// would undo state the user just set. Only the dedicated setters move those fields, and they
    /// write through [`SettingsService::persist`] instead.
    pub fn save(&self, mut settings: Settings) -> Result<Settings> {
        let current = self.get();
        settings.sidebar_collapsed = current.sidebar_collapsed;
        settings.last_route = current.last_route;
        settings.tour_completed = current.tour_completed;
        self.persist(settings)
    }

    /// Write a document that is already the whole truth, sanitized and atomically, then adopt it
    /// as the current settings.
    fn persist(&self, settings: Settings) -> Result<Settings> {
        let settings = settings.sanitized();
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

    /// Pin or unpin an agent. Favourites are ordered, so the list keeps the order the user
    /// added them in and the agents list puts them first in that same order.
    pub fn set_favorite(&self, agent_id: &str, favorite: bool) -> Result<Settings> {
        let id = agent_id.trim();
        if id.is_empty() {
            return Err(AppError::InvalidInput("agent id is empty".to_string()));
        }
        let mut settings = self.get();
        if favorite {
            // Already pinned: keep its place instead of moving it to the end.
            if !settings
                .favorite_agents
                .iter()
                .any(|existing| existing == id)
            {
                settings.favorite_agents.push(id.to_string());
            }
        } else {
            settings.favorite_agents.retain(|existing| existing != id);
        }
        self.save(settings)
    }

    /// Remember whether the sidebar rail is collapsed. Written on every toggle, so an unchanged
    /// value returns without touching the disk.
    pub fn set_sidebar_collapsed(&self, collapsed: bool) -> Result<Settings> {
        let mut settings = self.get();
        if settings.sidebar_collapsed == collapsed {
            return Ok(settings);
        }
        settings.sidebar_collapsed = collapsed;
        self.persist(settings)
    }

    /// Remember the screen the window is on. `None` — or a value [`normalize_route`] refuses —
    /// forgets it, which means the next launch opens on the home screen.
    pub fn set_last_route(&self, route: Option<&str>) -> Result<Settings> {
        let mut settings = self.get();
        let route = route.and_then(normalize_route);
        if settings.last_route == route {
            return Ok(settings);
        }
        settings.last_route = route;
        self.persist(settings)
    }

    /// Remember that the product tour was finished or skipped (or cleared so it can run again).
    pub fn set_tour_completed(&self, completed: bool) -> Result<Settings> {
        let mut settings = self.get();
        if settings.tour_completed == completed {
            return Ok(settings);
        }
        settings.tour_completed = completed;
        self.persist(settings)
    }

    /// Add a folder to the Projects screen. The folder itself is validated by the caller (it has
    /// to exist); this only refuses a duplicate and keeps the list ordered.
    pub fn add_project_folder(&self, folder: ProjectFolder) -> Result<Settings> {
        let mut settings = self.get();
        let normalized = ProjectFolder::normalize(&folder.path);
        if settings.project_folders.iter().any(|existing| {
            existing.id == folder.id || ProjectFolder::normalize(&existing.path) == normalized
        }) {
            return Err(AppError::InvalidInput(format!(
                "{} is already in your projects",
                folder.path
            )));
        }
        settings.project_folders.push(folder);
        self.save(settings)
    }

    /// Forget a folder. Nothing on disk is touched: the projects under it simply stop being
    /// scanned, which is why this needs no confirmation.
    pub fn remove_project_folder(&self, folder_id: &str) -> Result<ProjectFolder> {
        let mut settings = self.get();
        let index = settings
            .project_folders
            .iter()
            .position(|folder| folder.id == folder_id)
            .ok_or_else(|| AppError::NotFound(format!("project folder '{folder_id}'")))?;
        let removed = settings.project_folders.remove(index);
        self.save(settings)?;
        Ok(removed)
    }

    /// Adopt what the OS says about the login item.
    ///
    /// The one setting whose truth lives outside this file: the OS is asked at startup, and when
    /// the two disagree the OS wins — a user who took Ahabby out of their startup apps must not
    /// have it put back by the next launch.
    pub fn set_launch_at_login(&self, enabled: bool) -> Result<Settings> {
        let mut settings = self.get();
        if settings.launch_at_login == enabled {
            return Ok(settings);
        }
        settings.launch_at_login = enabled;
        self.persist(settings)
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
        assert_eq!(settings.accent, AccentColor::Clay);
        assert!(settings.accent_custom.is_none());
        assert_eq!(settings.interface_scale, DEFAULT_SCALE);
        assert_eq!(settings.text_scale, DEFAULT_SCALE);
        assert_eq!(settings.font_family, FontFamily::Inter);
        assert_eq!(settings.mono_font, MonoFont::Jetbrains);
        assert!(settings.favorite_agents.is_empty());
        assert_eq!(settings.terminal, "builtin");
        assert_eq!(settings.terminal_theme, TerminalTheme::Auto);
        // Nothing is registered with the OS, but the tray icon is there: closing the window keeps
        // Ahabby running until the user says otherwise.
        assert!(!settings.launch_at_login);
        assert!(settings.keeps_running_in_tray());
        assert!(!settings.starts_in_tray());
    }

    #[test]
    fn a_hidden_window_always_keeps_a_tray_icon_to_come_back_from() {
        let settings = Settings {
            tray_icon: false,
            close_to_tray: true,
            start_minimized: true,
            ..Settings::default()
        }
        .sanitized();

        assert!(!settings.keeps_running_in_tray());
        assert!(!settings.starts_in_tray());
        assert!(!settings.close_to_tray);
        assert!(!settings.start_minimized);
    }

    #[test]
    fn the_terminal_setting_keeps_known_ids_and_drops_forged_ones() {
        let mut settings = Settings {
            // A terminal that is simply not installed on this machine keeps its place: the UI
            // flags it, and reinstalling the terminal brings it back without a manual reset.
            terminal: "  ghostty ".to_string(),
            ..Settings::default()
        };
        assert_eq!(settings.clone().sanitized().terminal, "ghostty");

        settings.terminal = "definitely-not-a-terminal".to_string();
        assert_eq!(settings.clone().sanitized().terminal, "builtin");

        settings.terminal = String::new();
        assert_eq!(settings.sanitized().terminal, "builtin");
    }

    #[test]
    fn the_terminal_theme_round_trips_by_its_kebab_id() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        let mut settings = service.get();
        settings.terminal_theme = TerminalTheme::TokyoNight;
        service.save(settings).unwrap();

        let raw = std::fs::read_to_string(service.path()).unwrap();
        assert!(
            raw.contains("\"terminalTheme\": \"tokyo-night\""),
            "the stored value is the id the frontend knows: {raw}"
        );
        assert_eq!(
            SettingsService::load(dir.path()).get().terminal_theme,
            TerminalTheme::TokyoNight
        );

        // A missing key (an older file) keeps the default rather than failing the whole file.
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"language":"ru","terminalTheme":"solarized-light"}"#,
        )
        .unwrap();
        assert_eq!(
            SettingsService::load(dir.path()).get().terminal_theme,
            TerminalTheme::SolarizedLight
        );
    }

    #[test]
    fn appearance_values_are_sanitized() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        let mut settings = service.get();
        settings.interface_scale = 5;
        settings.text_scale = 900;
        settings.accent = AccentColor::Custom;
        settings.accent_custom = Some("not a colour".to_string());
        settings.font_family = FontFamily::Serif;
        settings.mono_font = MonoFont::System;

        let saved = service.save(settings).unwrap();
        assert_eq!(saved.interface_scale, MIN_SCALE);
        assert_eq!(saved.text_scale, MAX_SCALE);
        assert_eq!(saved.font_family, FontFamily::Serif);
        assert_eq!(saved.mono_font, MonoFont::System);
        assert_eq!(
            saved.accent,
            AccentColor::Clay,
            "a custom accent without a usable colour falls back to the default"
        );
        assert!(saved.accent_custom.is_none());
        assert_eq!(SettingsService::load(dir.path()).get(), saved);
    }

    #[test]
    fn custom_accent_keeps_a_valid_hex() {
        let mut settings = Settings {
            accent: AccentColor::Custom,
            accent_custom: Some("  #7B83EB ".to_string()),
            ..Settings::default()
        };
        let sanitized = settings.clone().sanitized();
        assert_eq!(sanitized.accent_custom.as_deref(), Some("#7B83EB"));

        settings.accent_custom = Some("#abc".to_string());
        assert_eq!(
            settings.sanitized().accent_custom.as_deref(),
            Some("#abc"),
            "the short form is kept; the frontend expands it"
        );
    }

    #[test]
    fn hand_edited_appearance_in_a_file_is_clamped_on_load() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"interfaceScale":10,"textScale":400,"accent":"violet","fontFamily":"system"}"#,
        )
        .unwrap();
        let settings = SettingsService::load(dir.path()).get();
        assert_eq!(settings.interface_scale, MIN_SCALE);
        assert_eq!(settings.text_scale, MAX_SCALE);
        assert_eq!(settings.accent, AccentColor::Violet);
        assert_eq!(settings.font_family, FontFamily::System);
        assert_eq!(settings.mono_font, MonoFont::Jetbrains);
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
    fn the_shell_remembers_the_collapsed_sidebar_and_the_screen() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());

        assert!(!service.get().sidebar_collapsed, "the rail starts open");
        assert!(service.get().last_route.is_none(), "and on the home screen");

        service.set_sidebar_collapsed(true).unwrap();
        let saved = service.set_last_route(Some("/settings/terminal")).unwrap();
        assert!(saved.sidebar_collapsed);
        assert_eq!(saved.last_route.as_deref(), Some("/settings/terminal"));

        let reloaded = SettingsService::load(dir.path()).get();
        assert!(
            reloaded.sidebar_collapsed,
            "the next launch opens the same way"
        );
        assert_eq!(reloaded.last_route.as_deref(), Some("/settings/terminal"));

        // Forgetting the route is an explicit `None`, which puts the window back on home.
        let forgotten = service.set_last_route(None).unwrap();
        assert!(forgotten.last_route.is_none());
        assert_eq!(SettingsService::load(dir.path()).get(), forgotten);
    }

    #[test]
    fn saving_the_settings_page_does_not_roll_back_what_the_shell_remembers() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        service.set_sidebar_collapsed(true).unwrap();
        service.set_last_route(Some("/library")).unwrap();
        service.set_tour_completed(true).unwrap();

        // What the Settings page holds: a document fetched *before* the rail was collapsed.
        let stale = Settings {
            language: Language::Ru,
            sidebar_collapsed: false,
            last_route: None,
            tour_completed: false,
            ..Settings::default()
        };
        let saved = service.save(stale).unwrap();

        assert_eq!(saved.language, Language::Ru, "the real setting is written");
        assert!(
            saved.sidebar_collapsed
                && saved.last_route.as_deref() == Some("/library")
                && saved.tour_completed,
            "the shell's own state survives a whole-document save: {saved:?}"
        );
        assert_eq!(SettingsService::load(dir.path()).get(), saved);
    }

    #[test]
    fn the_shell_remembers_the_tour_and_upgrades_keep_it_done() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        assert!(
            !service.get().tour_completed,
            "a brand-new install has not seen the tour"
        );

        service.set_tour_completed(true).unwrap();
        assert!(SettingsService::load(dir.path()).get().tour_completed);

        // An older settings file without the key must not re-show the tour on upgrade.
        std::fs::write(dir.path().join("settings.json"), r#"{"language":"en"}"#).unwrap();
        assert!(
            SettingsService::load(dir.path()).get().tour_completed,
            "missing tourCompleted means already done"
        );
    }

    #[test]
    fn a_route_the_router_cannot_resolve_is_dropped() {
        assert_eq!(
            normalize_route("/projects/a1b2").as_deref(),
            Some("/projects/a1b2")
        );
        assert_eq!(
            normalize_route("  /settings/terminal  ").as_deref(),
            Some("/settings/terminal")
        );
        assert_eq!(normalize_route("/").as_deref(), Some("/"));

        for rejected in [
            "",
            "   ",
            "agents",
            "#/agents",
            "https://example.com/agents",
            "/agents/../settings",
            "/agents//claude-code",
            "/agents/",
            "/agents claude",
            "/\u{1b}[31m",
        ] {
            assert_eq!(
                normalize_route(rejected),
                None,
                "{rejected:?} must be refused"
            );
        }
        assert_eq!(
            normalize_route(&format!("/{}", "a".repeat(MAX_ROUTE_LEN))),
            None
        );

        // A hand-edited file is cleaned up when it loads rather than being navigated to.
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"sidebarCollapsed":true,"lastRoute":"../../etc/passwd"}"#,
        )
        .unwrap();
        let settings = SettingsService::load(dir.path()).get();
        assert!(settings.sidebar_collapsed);
        assert!(settings.last_route.is_none());
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

    #[test]
    fn favorites_keep_their_order_and_never_repeat_an_id() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());

        service.set_favorite("codex", true).unwrap();
        let saved = service.set_favorite("claude-code", true).unwrap();
        assert_eq!(saved.favorite_agents, vec!["codex", "claude-code"]);

        // Pinning twice keeps a single entry instead of moving it to the end.
        service.set_favorite("codex", true).unwrap();
        assert_eq!(service.get().favorite_agents, vec!["codex", "claude-code"]);

        // Unpinning removes only that id.
        let unpinned = service.set_favorite("codex", false).unwrap();
        assert_eq!(unpinned.favorite_agents, vec!["claude-code"]);
        assert_eq!(SettingsService::load(dir.path()).get(), unpinned);
    }

    #[test]
    fn favorites_reject_blank_ids_and_are_cleaned_up_when_hand_edited() {
        let dir = tempfile::tempdir().unwrap();
        let service = SettingsService::load(dir.path());
        assert_eq!(
            service.set_favorite("   ", true).unwrap_err().code(),
            "invalid_input"
        );

        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"favoriteAgents":["codex"," ","codex","  claude-code  "],"language":"ru"}"#,
        )
        .unwrap();
        let settings = SettingsService::load(dir.path()).get();
        assert_eq!(settings.favorite_agents, vec!["codex", "claude-code"]);
    }

    #[test]
    fn a_settings_file_written_before_cloud_sync_still_loads() {
        let dir = tempfile::tempdir().unwrap();
        // The document an older Ahabby wrote: no `sync` key at all.
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"language":"en","theme":"system","tourCompleted":true}"#,
        )
        .unwrap();

        let settings = SettingsService::load(dir.path()).get();
        // Sync is opt-in: an upgrade must not start uploading anything by itself.
        assert!(!settings.sync.enabled);
        assert_eq!(settings.sync.mode, crate::domain::SyncMode::Manual);
        assert_eq!(settings.sync.provider, crate::domain::SyncProviderId::Gist);
        assert!(!settings.sync.include_secrets);
        assert_eq!(
            settings.sync.max_file_bytes,
            SyncSettings::DEFAULT_MAX_BYTES
        );
    }

    #[test]
    fn a_hand_edited_sync_block_is_clamped_and_deduplicated() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"sync":{"autoIntervalMinutes":1,"maxFileBytes":999999999999,
                "autoKinds":["skill","skill","mcp"],"autoOwners":["claude-code"," ","claude-code"],
                "excludePatterns":["  *.log  ",""]}}"#,
        )
        .unwrap();

        let sync = SettingsService::load(dir.path()).get().sync;
        // A hand edit cannot ask for a timer finer than the floor, nor for a file cap above the
        // ceiling; the lists lose their blanks and their repeats.
        assert_eq!(sync.auto_interval_minutes, SyncSettings::MIN_INTERVAL);
        assert_eq!(sync.max_file_bytes, SyncSettings::MAX_MAX_BYTES);
        assert_eq!(
            sync.auto_kinds,
            vec![crate::domain::SyncKind::Skill, crate::domain::SyncKind::Mcp]
        );
        assert_eq!(sync.auto_owners, vec!["claude-code"]);
        assert_eq!(sync.exclude_patterns, vec!["*.log"]);
    }

    #[test]
    fn an_interval_above_the_ceiling_is_pulled_back() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("settings.json"),
            r#"{"sync":{"autoIntervalMinutes":100000}}"#,
        )
        .unwrap();

        assert_eq!(
            SettingsService::load(dir.path())
                .get()
                .sync
                .auto_interval_minutes,
            SyncSettings::MAX_INTERVAL
        );
    }
}
