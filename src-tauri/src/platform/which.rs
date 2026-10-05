//! Binary lookup: `PATH` first, then the manifest's extra search directories.
//!
//! `PATH` wins on purpose — that is what the user's shell would run, and it is what
//! guarantees `claude` in a terminal and `claude` in Ahabby are the same program.

use std::path::{Path, PathBuf};

/// A binary found on disk.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BinaryLookup {
    pub path: PathBuf,
    /// `path` when it came from `PATH`, otherwise the directory that matched.
    pub found_in: String,
}

impl BinaryLookup {
    /// Directory the binary lives in — used to guess the install method.
    pub fn directory(&self) -> Option<PathBuf> {
        self.path.parent().map(Path::to_path_buf)
    }
}

pub fn find_binary(names: &[String], extra_dirs: &[PathBuf]) -> Option<BinaryLookup> {
    find_binary_with(names, extra_dirs, true)
}

/// Directory-only lookup. Used by tests and by callers that must not be affected by
/// whatever happens to be on the user's `PATH`.
pub fn find_binary_in_dirs(names: &[String], extra_dirs: &[PathBuf]) -> Option<BinaryLookup> {
    find_binary_with(names, extra_dirs, false)
}

fn find_binary_with(
    names: &[String],
    extra_dirs: &[PathBuf],
    use_path: bool,
) -> Option<BinaryLookup> {
    if use_path {
        for name in names {
            if name.trim().is_empty() {
                continue;
            }
            if let Ok(path) = which::which(name) {
                return Some(BinaryLookup {
                    path: normalize(&path),
                    found_in: "path".to_string(),
                });
            }
        }
    }

    for directory in extra_dirs {
        if !directory.is_dir() {
            continue;
        }
        for name in names {
            if name.trim().is_empty() {
                continue;
            }
            for candidate in candidates(directory, name) {
                if candidate.is_file() {
                    return Some(BinaryLookup {
                        path: normalize(&candidate),
                        found_in: directory.to_string_lossy().to_string(),
                    });
                }
            }
        }
    }

    None
}

/// Candidate file names for a binary inside `directory`, OS extensions included.
pub fn candidates(directory: &Path, name: &str) -> Vec<PathBuf> {
    let mut names: Vec<String> = Vec::new();
    if cfg!(windows) {
        let lower = name.to_ascii_lowercase();
        if !lower.ends_with(".exe") && !lower.ends_with(".cmd") && !lower.ends_with(".bat") {
            names.push(format!("{name}.exe"));
            names.push(format!("{name}.cmd"));
            names.push(format!("{name}.bat"));
        }
    }
    names.push(name.to_string());
    names.into_iter().map(|name| directory.join(name)).collect()
}

/// Strip the Windows `\\?\` verbatim prefix so paths look sane in the UI.
fn normalize(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(stripped) => PathBuf::from(stripped),
        None => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_binary_in_extra_directory() {
        let dir = tempfile::tempdir().unwrap();
        let name = if cfg!(windows) {
            "demo-tool.cmd"
        } else {
            "demo-tool"
        };
        let file = dir.path().join(name);
        std::fs::write(&file, "#!/bin/sh\n").unwrap();

        let lookup = find_binary_in_dirs(
            &["demo-tool".to_string()],
            &[dir.path().to_path_buf(), PathBuf::from("/nope")],
        )
        .expect("should find the file");
        assert_eq!(lookup.path, file);
        assert_eq!(lookup.found_in, dir.path().to_string_lossy());
    }

    #[test]
    fn windows_extensions_are_tried() {
        if !cfg!(windows) {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("demo.exe"), b"x").unwrap();
        let lookup =
            find_binary_in_dirs(&["demo".to_string()], &[dir.path().to_path_buf()]).unwrap();
        assert!(lookup.path.to_string_lossy().ends_with("demo.exe"));
    }

    #[test]
    fn returns_none_when_absent() {
        assert!(find_binary(&["definitely-not-a-real-binary-xyz".to_string()], &[]).is_none());
    }

    #[test]
    fn strips_verbatim_prefix() {
        assert_eq!(
            normalize(Path::new(r"\\?\C:\x\y.exe")),
            PathBuf::from(r"C:\x\y.exe")
        );
        assert_eq!(
            normalize(Path::new("/usr/bin/x")),
            PathBuf::from("/usr/bin/x")
        );
    }
}
