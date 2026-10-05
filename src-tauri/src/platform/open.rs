//! Opening paths in the OS file manager.
//!
//! Implemented with the platform's own tools instead of a crate, because "reveal this file
//! in the file manager" needs a *selection* on Windows and macOS, which generic openers do
//! not do. Failures are non-fatal: the command returns an error, the UI shows a toast, and
//! nothing about the scan changes.

use std::path::Path;
use std::process::Command;

use crate::error::{AppError, Result};

/// Show `path` in the file manager, selecting it when the platform supports it.
pub fn reveal_item(path: &Path) -> Result<()> {
    if cfg!(windows) {
        // `explorer` reports a non-zero exit code even when it succeeds, so the status is
        // deliberately ignored — only a failure to *start* it is an error.
        spawn(
            "explorer",
            &["/select,".to_string(), path.to_string_lossy().to_string()],
        )
    } else if cfg!(target_os = "macos") {
        spawn(
            "open",
            &["-R".to_string(), path.to_string_lossy().to_string()],
        )
    } else {
        let directory = if path.is_dir() {
            path
        } else {
            path.parent().unwrap_or(path)
        };
        spawn("xdg-open", &[directory.to_string_lossy().to_string()])
    }
}

/// Open a directory or file with the default application.
pub fn open_path(path: &Path) -> Result<()> {
    if cfg!(windows) {
        spawn("explorer", &[path.to_string_lossy().to_string()])
    } else if cfg!(target_os = "macos") {
        spawn("open", &[path.to_string_lossy().to_string()])
    } else {
        spawn("xdg-open", &[path.to_string_lossy().to_string()])
    }
}

/// Open a documentation or website URL in the user's browser.
///
/// Only `http` and `https` are accepted: the webview must not be able to hand Ahabby a
/// `file:` or `javascript:` payload and have the OS act on it.
pub fn open_url(url: &str) -> Result<()> {
    let trimmed = url.trim();
    let lower = trimmed.to_ascii_lowercase();
    if !(lower.starts_with("https://") || lower.starts_with("http://")) {
        return Err(AppError::CommandNotAllowed(format!(
            "only http(s) links can be opened, got '{trimmed}'"
        )));
    }
    if cfg!(windows) {
        // `start` is a cmd builtin; the empty argument is the window title.
        spawn(
            "cmd",
            &[
                "/C".to_string(),
                "start".to_string(),
                String::new(),
                trimmed.to_string(),
            ],
        )
    } else if cfg!(target_os = "macos") {
        spawn("open", &[trimmed.to_string()])
    } else {
        spawn("xdg-open", &[trimmed.to_string()])
    }
}

fn spawn(program: &str, args: &[String]) -> Result<()> {
    let mut command = Command::new(program);
    command.args(args);
    command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command.spawn().map(|_| ()).map_err(|error| {
        AppError::other(format!(
            "could not open the file manager ({program}): {error}"
        ))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_programs_are_reported_as_errors() {
        // The point is that a broken environment produces a clean error instead of a panic.
        let result = spawn("definitely-not-a-real-opener-xyz", &[]);
        assert!(result.is_err());
    }

    #[test]
    fn only_http_links_can_be_opened() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "  FTP://example.com  ",
            "not a url",
            "",
        ] {
            let error = open_url(url).unwrap_err();
            assert_eq!(error.code(), "command_not_allowed", "url: {url}");
        }
    }
}
