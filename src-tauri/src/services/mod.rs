//! Backend services: everything that has side effects lives here, behind small,
//! individually testable modules.

pub mod config_editor;
pub mod http;
pub mod hub;
pub mod installer;
pub mod library;
pub mod project;
pub mod scan_cache;
pub mod scanner;
pub mod settings;
pub mod shared;
pub mod sync;
pub mod terminal;
pub mod version_checker;
pub mod web;

pub use config_editor::{
    delete_backup, list_backups, preview, preview_fact, read_backup, read_snapshot, remove_fact,
    restore, save, save_fact, MAX_EDITABLE_BYTES,
};
pub use hub::{HubService, Prepared};
pub use installer::{JobOutcome, JobOutputEvent, JobRunner, JobSink, StreamKind};
pub use library::aggregate;
pub use scan_cache::ScanCache;
pub use scanner::{ScanReport, ScanSink, Scanner};
pub use settings::{
    AccentColor, FontFamily, Language, MonoFont, Settings, SettingsService, TerminalTheme, Theme,
};
pub use sync::{SyncProvider, SyncService, SyncSink, SyncTarget};
pub use terminal::{TerminalManager, TerminalRequest, TerminalSink};
pub use version_checker::{ReleaseSource, VersionChecker};
pub use web::WebService;
