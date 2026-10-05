//! Everything OS dependent lives behind this module: path resolution, binary lookup,
//! package manager detection and process execution with timeouts.
//!
//! The rest of the backend only ever talks to [`PlatformContext`], which makes the
//! scanner testable on temporary directories (see `services::scanner` tests).

pub mod file_io;
pub mod open;
pub mod packages;
pub mod paths;
pub mod process;
pub mod which;
pub mod window;

pub use file_io::{
    backup_dir_for, create_backup, list_backups, modified_ms, read_text, sha256_file, sha256_hex,
    write_atomic, WriteOutcome,
};
pub use packages::{detect_managers, PackageManager};
pub use paths::{expand_template, PlatformContext};
pub use process::{
    apply_proxy, build_command, kill_tree, run_binary, run_capture, run_shell_capture,
    shell_invocation, CommandOutput,
};
pub use which::{find_binary, find_binary_in_dirs, BinaryLookup};
pub use window::set_window_chrome;

/// Epoch milliseconds — the only timestamp format that crosses the IPC boundary.
pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

/// Epoch milliseconds of a file's modification time.
pub fn metadata_ms(metadata: &std::fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}
