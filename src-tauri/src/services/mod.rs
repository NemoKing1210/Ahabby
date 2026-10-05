//! Backend services: everything that has side effects lives here, behind small,
//! individually testable modules.

pub mod config_editor;
pub mod installer;
pub mod library;
pub mod scan_cache;
pub mod scanner;
pub mod settings;
pub mod shared;
pub mod terminal;
pub mod version_checker;

pub use config_editor::{list_backups, preview, read_snapshot, restore, save, MAX_EDITABLE_BYTES};
pub use installer::{JobOutcome, JobOutputEvent, JobRunner, JobSink, StreamKind};
pub use library::aggregate;
pub use scan_cache::ScanCache;
pub use scanner::{ScanReport, ScanSink, Scanner};
pub use settings::{AccentColor, FontFamily, Language, MonoFont, Settings, SettingsService, Theme};
pub use terminal::{TerminalManager, TerminalRequest, TerminalSink};
pub use version_checker::{ReleaseSource, VersionChecker};
