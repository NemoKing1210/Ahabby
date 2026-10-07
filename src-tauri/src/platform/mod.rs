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
pub mod shell;
pub mod terminals;
pub mod which;
pub mod window;

pub use file_io::{
    backup_dir_for, create_backup, list_backups, modified_ms, read_text, sha256_file, sha256_hex,
    write_atomic, write_atomic_bytes, WriteOutcome,
};
pub use packages::{detect_managers, PackageManager};
pub use paths::{expand_template, PlatformContext};

/// The absolute, symlink-resolved form of a directory, without the Windows verbatim prefix.
///
/// `std::fs::canonicalize` yields `\\?\C:\work\app` on Windows — correct for the kernel, but not
/// something to show a user or to hash into an id. Folding it back to `C:\work\app` keeps ids,
/// duplicates detection and the paths in the settings file readable. `None` when the path does
/// not exist (which is also how a folder that has been moved is detected).
pub fn canonical_dir(path: &std::path::Path) -> Option<std::path::PathBuf> {
    let resolved = std::fs::canonicalize(path).ok()?;
    Some(strip_verbatim(resolved))
}

fn strip_verbatim(path: std::path::PathBuf) -> std::path::PathBuf {
    let text = path.to_string_lossy().to_string();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return std::path::PathBuf::from(format!(r"\\{rest}"));
    }
    match text.strip_prefix(r"\\?\") {
        Some(rest) => std::path::PathBuf::from(rest),
        None => path,
    }
}
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
    epoch_ms(metadata.modified().ok()).unwrap_or(0)
}

/// Epoch milliseconds of a file's modification time, when the metadata carries one.
///
/// Unlike [`metadata_ms`] this distinguishes "no timestamp" from a real `0`.
pub fn modified_at_ms(metadata: &std::fs::Metadata) -> Option<i64> {
    epoch_ms(metadata.modified().ok())
}

/// Epoch milliseconds of a file's creation time, when the platform reports one.
///
/// Windows and macOS always do. Many Linux filesystems (ext4 without a birth time) do not,
/// so this stays `None` there instead of falling back to a misleading modified time.
pub fn created_at_ms(metadata: &std::fs::Metadata) -> Option<i64> {
    epoch_ms(metadata.created().ok())
}

fn epoch_ms(time: Option<std::time::SystemTime>) -> Option<i64> {
    time?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_millis() as i64)
}
