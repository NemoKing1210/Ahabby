//! Reading, validating and writing other people's config files.
//!
//! The contract with the frontend:
//! 1. `read_snapshot` returns the content **and its sha256**;
//! 2. `preview` validates the edited text, diffs it against the file on disk and reports
//!    whether the two are still in sync;
//! 3. `save` re-checks the hash, takes a timestamped backup and writes atomically.
//!
//! A file that changed on disk since it was read is never overwritten silently — the user
//! gets a `stale_file` error and can reload.

use std::path::Path;

use similar::TextDiff;

use crate::adapters::doc_edit;
use crate::domain::{BackupEntry, ConfigFormat, ConfigSnapshot, DiffPreview, SaveResult};
use crate::error::{AppError, Result};
use crate::platform::{self, file_io};

/// Files larger than this are shown read-only: they are not configs anyone edits by hand.
pub const MAX_EDITABLE_BYTES: u64 = 4 * 1024 * 1024;

pub fn read_snapshot(path: &Path, format: ConfigFormat, editable: bool) -> Result<ConfigSnapshot> {
    let exists = path.is_file();
    if !exists {
        return Ok(ConfigSnapshot {
            path: path.to_string_lossy().to_string(),
            format,
            content: String::new(),
            sha256: String::new(),
            size_bytes: 0,
            modified_ms: 0,
            exists: false,
            truncated: false,
            editable,
        });
    }

    let metadata = std::fs::metadata(path).map_err(|error| AppError::io(path, error))?;
    let size_bytes = metadata.len();
    let truncated = size_bytes > MAX_EDITABLE_BYTES;

    let (content, sha256) = if truncated {
        (String::new(), file_io::sha256_file(path)?)
    } else {
        let content = platform::read_text(path)?;
        let sha256 = file_io::sha256_hex(content.as_bytes());
        (content, sha256)
    };

    Ok(ConfigSnapshot {
        path: path.to_string_lossy().to_string(),
        format,
        content,
        sha256,
        size_bytes,
        modified_ms: platform::metadata_ms(&metadata),
        exists: true,
        truncated,
        editable: editable && !truncated,
    })
}

/// Validate `content` and diff it against what is on disk right now.
pub fn preview(
    path: &Path,
    format: ConfigFormat,
    content: &str,
    base_sha256: &str,
) -> Result<DiffPreview> {
    let display = path.to_string_lossy().to_string();
    let mut errors = Vec::new();
    if let Err(error) = doc_edit::validate(format, content, &display) {
        errors.push(error.to_string());
    }

    let exists = path.is_file();
    let current = if exists {
        platform::read_text(path)?
    } else {
        String::new()
    };
    let current_sha256 = if exists {
        file_io::sha256_hex(current.as_bytes())
    } else {
        String::new()
    };
    let in_sync = current_sha256 == base_sha256;

    let diff = TextDiff::from_lines(&current, content);
    let unified = diff
        .unified_diff()
        .context_radius(3)
        .header("current", "edited")
        .to_string();
    // Count from the unified diff: stable across `similar` versions, and it is exactly the
    // text the user is shown.
    let (added, removed) = unified
        .lines()
        .skip(2) // "--- current" / "+++ edited"
        .fold((0usize, 0usize), |(added, removed), line| {
            match line.as_bytes() {
                [b'+', ..] => (added + 1, removed),
                [b'-', ..] => (added, removed + 1),
                _ => (added, removed),
            }
        });

    Ok(DiffPreview {
        path: display,
        unified,
        added,
        removed,
        errors,
        in_sync,
        current_sha256,
    })
}

/// Validate, back up and atomically write.
pub fn save(
    path: &Path,
    format: ConfigFormat,
    content: &str,
    base_sha256: &str,
    backup_root: &Path,
) -> Result<SaveResult> {
    let display = path.to_string_lossy().to_string();
    doc_edit::validate(format, content, &display)?;

    if path.exists() {
        let current = platform::read_text(path)?;
        let current_sha256 = file_io::sha256_hex(current.as_bytes());
        if current_sha256 != base_sha256 {
            return Err(AppError::Stale { path: display });
        }
    }

    let outcome = file_io::write_atomic(path, content, Some(backup_root))?;
    Ok(SaveResult {
        path: display,
        sha256: outcome.sha256,
        modified_ms: outcome.modified_ms,
        size_bytes: outcome.size_bytes,
        backup_path: outcome.backup_path,
    })
}

pub fn list_backups(backup_root: &Path, path: &Path) -> Result<Vec<BackupEntry>> {
    file_io::list_backups(backup_root, path)
}

/// Validate a one-value edit and diff it against the file, without writing anything.
///
/// The frontend sends a key and a value, never a document: [`patch_fact`] reads the file and
/// applies the change to it, and the diff is exactly what that would write.
pub fn preview_fact(
    path: &Path,
    format: ConfigFormat,
    key: &str,
    value: &str,
    base_sha256: &str,
) -> Result<DiffPreview> {
    let patched = patch_fact(path, format, key, value)?;
    preview(path, format, &patched, base_sha256)
}

/// Write one value in place: same patch, same validation, same backup and atomic replace as a
/// full document save.
pub fn save_fact(
    path: &Path,
    format: ConfigFormat,
    key: &str,
    value: &str,
    base_sha256: &str,
    backup_root: &Path,
) -> Result<SaveResult> {
    let patched = patch_fact(path, format, key, value)?;
    save(path, format, &patched, base_sha256, backup_root)
}

/// Read the file as it is on disk and apply one value to it.
///
/// Reading the file rather than a copy the frontend sent back is the point: `doc_edit::set_value`
/// refuses a key the document no longer holds, so a file that moved under the app is an error,
/// never a rewrite of something the user was not looking at.
fn patch_fact(path: &Path, format: ConfigFormat, key: &str, value: &str) -> Result<String> {
    if !path.is_file() {
        return Err(AppError::NotFound(path.to_string_lossy().to_string()));
    }
    let content = platform::read_text(path)?;
    doc_edit::set_value(format, &content, key, value)
}

/// Restore a backup over its original file. The current content is backed up first, so a
/// restore is itself reversible.
pub fn restore(
    backup_path: &Path,
    target: &Path,
    format: ConfigFormat,
    backup_root: &Path,
) -> Result<SaveResult> {
    if !backup_path.is_file() {
        return Err(AppError::NotFound(
            backup_path.to_string_lossy().to_string(),
        ));
    }
    let content = platform::read_text(backup_path)?;
    let display = target.to_string_lossy().to_string();
    doc_edit::validate(format, &content, &display)?;

    let outcome = file_io::write_atomic(target, &content, Some(backup_root))?;
    Ok(SaveResult {
        path: display,
        sha256: outcome.sha256,
        modified_ms: outcome.modified_ms,
        size_bytes: outcome.size_bytes,
        backup_path: outcome.backup_path,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn setup() -> (tempfile::TempDir, PathBuf, PathBuf) {
        let dir = tempfile::tempdir().unwrap();
        let backups = dir.path().join("backups");
        let file = dir.path().join("mcp.json");
        (dir, file, backups)
    }

    #[test]
    fn missing_file_yields_an_empty_snapshot() {
        let (_dir, file, _backups) = setup();
        let snapshot = read_snapshot(&file, ConfigFormat::Json, true).unwrap();
        assert!(!snapshot.exists);
        assert!(snapshot.content.is_empty());
        assert!(snapshot.sha256.is_empty());
    }

    #[test]
    fn preview_reports_diff_and_sync_state() {
        let (_dir, file, _backups) = setup();
        std::fs::write(&file, "{\n  \"a\": 1\n}\n").unwrap();
        let snapshot = read_snapshot(&file, ConfigFormat::Json, true).unwrap();

        let first = preview(
            &file,
            ConfigFormat::Json,
            "{\n  \"a\": 2\n}\n",
            &snapshot.sha256,
        )
        .unwrap();
        assert!(first.in_sync);
        assert!(first.errors.is_empty());
        assert_eq!(first.added, 1);
        assert_eq!(first.removed, 1);
        assert!(first.unified.contains(r#"-  "a": 1"#));
        assert!(first.unified.contains(r#"+  "a": 2"#));

        // An out-of-date hash is detected instead of applied.
        let stale = preview(&file, ConfigFormat::Json, "{}\n", "deadbeef").unwrap();
        assert!(!stale.in_sync);
    }

    #[test]
    fn preview_reports_invalid_content() {
        let (_dir, file, _backups) = setup();
        std::fs::write(&file, "{}\n").unwrap();
        let invalid = preview(&file, ConfigFormat::Json, "{ broken", "whatever").unwrap();
        assert!(!invalid.errors.is_empty());
        assert!(invalid.errors[0].contains("not valid json"));
    }

    #[test]
    fn save_refuses_broken_and_stale_writes() {
        let (_dir, file, backups) = setup();
        std::fs::write(&file, "{}\n").unwrap();
        let snapshot = read_snapshot(&file, ConfigFormat::Json, true).unwrap();

        let invalid = save(
            &file,
            ConfigFormat::Json,
            "{ nope",
            &snapshot.sha256,
            &backups,
        );
        assert!(invalid.is_err());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{}\n");

        let stale = save(
            &file,
            ConfigFormat::Json,
            "{\"b\":1}\n",
            "deadbeef",
            &backups,
        );
        let error = stale.unwrap_err();
        assert_eq!(error.code(), "stale_file");

        let saved = save(
            &file,
            ConfigFormat::Json,
            "{\"b\":1}\n",
            &snapshot.sha256,
            &backups,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"b\":1}\n");
        assert!(saved.backup_path.is_some());
        assert!(saved.size_bytes > 0);
    }

    #[test]
    fn save_creates_backups_that_can_be_listed_and_restored() {
        let (_dir, file, backups) = setup();
        std::fs::write(&file, "{\"v\":1}\n").unwrap();
        let first = read_snapshot(&file, ConfigFormat::Json, true).unwrap();
        save(
            &file,
            ConfigFormat::Json,
            "{\"v\":2}\n",
            &first.sha256,
            &backups,
        )
        .unwrap();

        let second = read_snapshot(&file, ConfigFormat::Json, true).unwrap();
        save(
            &file,
            ConfigFormat::Json,
            "{\"v\":3}\n",
            &second.sha256,
            &backups,
        )
        .unwrap();

        let entries = list_backups(&backups, &file).unwrap();
        assert_eq!(entries.len(), 2);

        let restored = restore(
            Path::new(&entries[1].path),
            &file,
            ConfigFormat::Json,
            &backups,
        )
        .unwrap();
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"v\":1}\n");
        assert!(restored.backup_path.is_some(), "restore is reversible too");
    }

    #[test]
    fn huge_files_are_read_only() {
        let (_dir, file, _backups) = setup();
        let content = format!(
            "{{\"pad\":\"{}\"}}",
            "x".repeat(MAX_EDITABLE_BYTES as usize + 16)
        );
        std::fs::write(&file, content).unwrap();
        let snapshot = read_snapshot(&file, ConfigFormat::Json, true).unwrap();
        assert!(snapshot.truncated);
        assert!(snapshot.content.is_empty());
        assert!(!snapshot.editable);
        assert!(!snapshot.sha256.is_empty());
    }

    #[test]
    fn fact_preview_and_save_change_one_value_and_keep_a_backup() {
        let (_dir, file, backups) = setup();
        let content = "{\n  // keep me\n  \"model\": \"gpt-5\",\n  \"other\": 1\n}\n";
        std::fs::write(&file, content).unwrap();
        let snapshot = read_snapshot(&file, ConfigFormat::Jsonc, true).unwrap();

        let diff = preview_fact(
            &file,
            ConfigFormat::Jsonc,
            "model",
            "gpt-5.1",
            &snapshot.sha256,
        )
        .unwrap();
        assert!(diff.in_sync);
        assert!(diff.errors.is_empty());
        assert_eq!(diff.added, 1);
        assert_eq!(diff.removed, 1);
        assert!(diff.unified.contains("gpt-5.1"));

        let saved = save_fact(
            &file,
            ConfigFormat::Jsonc,
            "model",
            "gpt-5.1",
            &snapshot.sha256,
            &backups,
        )
        .unwrap();
        let after = std::fs::read_to_string(&file).unwrap();
        assert!(after.contains("// keep me"), "the comment survives");
        assert!(after.contains("\"model\": \"gpt-5.1\""));
        assert!(after.contains("\"other\": 1"));
        assert!(saved.backup_path.is_some());
    }

    #[test]
    fn fact_save_refuses_a_stale_base_and_a_key_that_is_gone() {
        let (_dir, file, backups) = setup();
        std::fs::write(&file, "{\n  \"model\": \"gpt-5\"\n}\n").unwrap();

        // A file that changed since the row was read is never overwritten.
        let error = save_fact(
            &file,
            ConfigFormat::Json,
            "model",
            "x",
            "deadbeef",
            &backups,
        )
        .unwrap_err();
        assert_eq!(error.code(), "stale_file");
        assert!(std::fs::read_to_string(&file).unwrap().contains("gpt-5"));

        // A key the document no longer holds is refused rather than inserted.
        let snapshot = read_snapshot(&file, ConfigFormat::Json, true).unwrap();
        let error = save_fact(
            &file,
            ConfigFormat::Json,
            "missing",
            "x",
            &snapshot.sha256,
            &backups,
        )
        .unwrap_err();
        assert_eq!(error.code(), "not_found");
    }

    #[test]
    fn fact_patch_refuses_a_file_that_is_not_there() {
        let (_dir, file, backups) = setup();
        let error = save_fact(&file, ConfigFormat::Json, "a", "1", "", &backups).unwrap_err();
        assert_eq!(error.code(), "not_found");
        assert_eq!(
            preview_fact(&file, ConfigFormat::Json, "a", "1", "")
                .unwrap_err()
                .code(),
            "not_found"
        );
    }
}
