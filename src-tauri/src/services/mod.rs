//! Backend services: everything that has side effects lives here, behind small,
//! individually testable modules.

pub mod config_editor;
pub mod installer;
pub mod library;
pub mod scanner;
pub mod settings;
pub mod version_checker;

pub use config_editor::{list_backups, preview, read_snapshot, restore, save, MAX_EDITABLE_BYTES};
pub use installer::{JobOutcome, JobOutputEvent, JobRunner, JobSink, StreamKind};
pub use library::aggregate;
pub use scanner::{ScanReport, Scanner};
pub use settings::{Language, Settings, SettingsService, Theme};
pub use version_checker::{ReleaseSource, VersionChecker};
