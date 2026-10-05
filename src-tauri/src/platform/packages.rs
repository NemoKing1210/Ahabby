//! Detection of the package managers available on this machine.
//!
//! An install button is only shown when the manager a manifest asks for is really
//! present — otherwise the UI links to the official instructions instead.

use std::path::PathBuf;

use crate::domain::Manager;

use super::which::find_binary;

/// A package manager found on this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PackageManager {
    pub manager: Manager,
    /// The program that will be executed (`pip3` when `pip` is missing, ...).
    pub program: String,
    pub path: String,
}

/// Every manager Ahabby can drive, in the order they are offered to the user.
pub const KNOWN_MANAGERS: &[Manager] = &[
    Manager::Npm,
    Manager::Pnpm,
    Manager::Yarn,
    Manager::Bun,
    Manager::Brew,
    Manager::Winget,
    Manager::Scoop,
    Manager::Pipx,
    Manager::Pip,
    Manager::Cargo,
    Manager::Go,
];

/// Candidate program names for a manager (the first one that exists wins).
fn program_candidates(manager: Manager) -> &'static [&'static str] {
    match manager {
        Manager::Pip => &["pip", "pip3"],
        Manager::Npm => &["npm"],
        Manager::Pnpm => &["pnpm"],
        Manager::Yarn => &["yarn"],
        Manager::Bun => &["bun"],
        Manager::Brew => &["brew"],
        Manager::Winget => &["winget"],
        Manager::Scoop => &["scoop"],
        Manager::Pipx => &["pipx"],
        Manager::Cargo => &["cargo"],
        Manager::Go => &["go"],
        Manager::Script | Manager::Manual => &[],
    }
}

/// Look up a single manager, optionally considering extra directories (used by tests).
pub fn lookup(manager: Manager, extra_dirs: &[PathBuf]) -> Option<PackageManager> {
    lookup_with(manager, extra_dirs, true)
}

/// Directory-only variant: never consults `PATH`. Deterministic for tests.
pub fn lookup_in_dirs(manager: Manager, extra_dirs: &[PathBuf]) -> Option<PackageManager> {
    lookup_with(manager, extra_dirs, false)
}

fn lookup_with(manager: Manager, extra_dirs: &[PathBuf], use_path: bool) -> Option<PackageManager> {
    let candidates: Vec<String> = program_candidates(manager)
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    let found = if use_path {
        find_binary(&candidates, extra_dirs)
    } else {
        super::which::find_binary_in_dirs(&candidates, extra_dirs)
    }?;
    Some(PackageManager {
        manager,
        program: found
            .path
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| candidates[0].clone()),
        path: found.path.to_string_lossy().to_string(),
    })
}

/// Detect every manager available on this machine.
pub fn detect_managers() -> Vec<PackageManager> {
    detect_managers_in(&[])
}

pub fn detect_managers_in(extra_dirs: &[PathBuf]) -> Vec<PackageManager> {
    KNOWN_MANAGERS
        .iter()
        .filter_map(|manager| lookup(*manager, extra_dirs))
        .collect()
}

/// Is the manager a manifest asked for available? Returns the program to run.
pub fn require(manager: Manager) -> Result<PackageManager, String> {
    lookup(manager, &[]).ok_or_else(|| {
        format!(
            "'{}' is not installed",
            manager.binary().unwrap_or("the required package manager")
        )
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_manager_in_extra_directory() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "npm.cmd" } else { "npm" };
        std::fs::write(dir.path().join(name), b"x").unwrap();
        let found =
            lookup_in_dirs(Manager::Npm, &[dir.path().to_path_buf()]).expect("npm should be found");
        assert_eq!(found.program, "npm");
        assert!(found.path.ends_with(name));
    }

    #[test]
    fn pip_falls_back_to_pip3() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) { "pip3.cmd" } else { "pip3" };
        std::fs::write(dir.path().join(name), b"x").unwrap();
        let found = lookup_in_dirs(Manager::Pip, &[dir.path().to_path_buf()])
            .expect("pip3 should be found");
        assert_eq!(found.program, "pip3");
    }

    #[test]
    fn script_and_manual_are_never_detected() {
        assert!(lookup(Manager::Script, &[]).is_none());
        assert!(lookup(Manager::Manual, &[]).is_none());
    }

    #[test]
    fn require_reports_missing_manager() {
        let error = require(Manager::Script).unwrap_err();
        assert!(error.contains("not installed"));
    }
}
