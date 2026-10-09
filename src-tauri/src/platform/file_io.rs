//! Safe file primitives: hashing, timestamped backups, atomic writes.
//!
//! Every write into a user's file goes through [`write_atomic`]. It is the only place
//! that touches the filesystem in a way that could lose data, and it guarantees:
//! * a **timestamped backup** is taken before the change (unless the file is new),
//! * the content is written to a temporary file *in the same directory* and then
//!   renamed over the original, so a crash never leaves a half-written config,
//! * the original file permissions survive the replacement (configs often hold tokens),
//! * the backup directory layout makes `list_backups(original)` trivial.

use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::domain::BackupEntry;
use crate::error::{AppError, Result};

use super::{metadata_ms, now_ms};

pub fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

pub fn sha256_file(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path).map_err(|error| AppError::io(path, error))?;
    Ok(sha256_hex(&bytes))
}

pub fn read_text(path: &Path) -> Result<String> {
    let bytes = std::fs::read(path).map_err(|error| AppError::io(path, error))?;
    String::from_utf8(bytes)
        .map_err(|error| AppError::other(format!("{} is not valid UTF-8: {error}", path.display())))
}

pub fn modified_ms(path: &Path) -> Option<i64> {
    let metadata = std::fs::metadata(path).ok()?;
    metadata_ms(&metadata).into()
}

/// Outcome of an atomic write.
#[derive(Debug, Clone)]
pub struct WriteOutcome {
    pub sha256: String,
    pub size_bytes: u64,
    pub modified_ms: i64,
    pub backup_path: Option<String>,
    /// `true` when the file did not exist before.
    pub created: bool,
}

/// Directory holding the backups of one original file: `<root>/<hash12>`.
pub fn backup_dir_for(backup_root: &Path, original: &Path) -> PathBuf {
    let key = sha256_hex(original.to_string_lossy().as_bytes());
    backup_root.join(&key[..12])
}

/// Copy `original` into the backup store and return the backup path.
pub fn create_backup(original: &Path, backup_root: &Path) -> Result<PathBuf> {
    let file_name = original
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let directory = backup_dir_for(backup_root, original);
    std::fs::create_dir_all(&directory).map_err(|error| AppError::io(&directory, error))?;

    let meta_path = directory.join("meta.json");
    if !meta_path.exists() {
        let meta = serde_json::json!({
            "originalPath": original.to_string_lossy(),
            "createdAtMs": now_ms(),
        });
        let _ = std::fs::write(
            &meta_path,
            serde_json::to_vec_pretty(&meta).unwrap_or_default(),
        );
    }

    let stamp = chrono::Local::now().format("%Y%m%d-%H%M%S").to_string();
    let mut target = directory.join(format!("{stamp}__{file_name}"));
    let mut counter = 1;
    while target.exists() {
        target = directory.join(format!("{stamp}-{counter}__{file_name}"));
        counter += 1;
    }

    std::fs::copy(original, &target).map_err(|error| AppError::io(&target, error))?;
    Ok(target)
}

/// All backups of `original`, newest first.
pub fn list_backups(backup_root: &Path, original: &Path) -> Result<Vec<BackupEntry>> {
    let directory = backup_dir_for(backup_root, original);
    if !directory.is_dir() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    for entry in std::fs::read_dir(&directory)
        .map_err(|error| AppError::io(&directory, error))?
        .flatten()
    {
        let path = entry.path();
        if !path.is_file() || path.file_name().is_some_and(|name| name == "meta.json") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        entries.push(BackupEntry {
            path: path.to_string_lossy().to_string(),
            original_path: original.to_string_lossy().to_string(),
            created_ms: metadata_ms(&metadata),
            size_bytes: metadata.len(),
        });
    }
    entries.sort_by_key(|entry| std::cmp::Reverse(entry.created_ms));
    Ok(entries)
}

/// Remove one backup file from the store.
///
/// The path must be a direct child of this file's own backup directory, so a caller that did
/// not come through `list_backups` cannot delete anything else. The directory goes with the
/// last copy — an empty store holds nothing worth keeping.
pub fn delete_backup(backup_root: &Path, original: &Path, backup: &Path) -> Result<()> {
    let directory = backup_dir_for(backup_root, original);
    if backup.parent() != Some(directory.as_path()) {
        return Err(AppError::CommandNotAllowed(format!(
            "{} is not a backup of {}",
            backup.display(),
            original.display()
        )));
    }
    if !backup.is_file() {
        return Err(AppError::NotFound(backup.to_string_lossy().to_string()));
    }
    std::fs::remove_file(backup).map_err(|error| AppError::io(backup, error))?;

    let has_backups = std::fs::read_dir(&directory)
        .map_err(|error| AppError::io(&directory, error))?
        .flatten()
        .any(|entry| entry.file_name() != "meta.json");
    if !has_backups {
        let _ = std::fs::remove_dir_all(&directory);
    }
    Ok(())
}

/// Write `content` to `path` atomically, taking a backup first when the file exists.
pub fn write_atomic(
    path: &Path,
    content: &str,
    backup_root: Option<&Path>,
) -> Result<WriteOutcome> {
    write_atomic_bytes(path, content.as_bytes(), backup_root)
}

/// The same write for bytes rather than text.
///
/// A skill installed from the Hub is not always text — it may ship a font, a template or an
/// archive — and every write in Ahabby goes through one atomic path, so this is that path rather
/// than a second one that would have to repeat the backup and `fsync` rules.
pub fn write_atomic_bytes(
    path: &Path,
    bytes: &[u8],
    backup_root: Option<&Path>,
) -> Result<WriteOutcome> {
    let parent = path.parent().ok_or_else(|| {
        AppError::InvalidInput(format!("{} has no parent directory", path.display()))
    })?;
    std::fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;

    let existed = path.exists();
    let _original_permissions = std::fs::metadata(path).ok().map(|meta| meta.permissions());

    let backup_path = match (existed, backup_root) {
        (true, Some(root)) => Some(create_backup(path, root)?),
        _ => None,
    };

    let file_name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| "config".to_string());
    let temp_path = parent.join(format!(".{file_name}.ahabby.tmp"));

    let write_result = (|| -> Result<()> {
        {
            use std::io::Write;
            let mut file = std::fs::File::create(&temp_path)
                .map_err(|error| AppError::io(&temp_path, error))?;
            file.write_all(bytes)
                .map_err(|error| AppError::io(&temp_path, error))?;
            file.sync_all()
                .map_err(|error| AppError::io(&temp_path, error))?;
        }
        #[cfg(unix)]
        if let Some(permissions) = _original_permissions.clone() {
            let _ = std::fs::set_permissions(&temp_path, permissions);
        }
        std::fs::rename(&temp_path, path).map_err(|error| AppError::io(path, error))?;
        Ok(())
    })();

    if let Err(error) = write_result {
        let _ = std::fs::remove_file(&temp_path);
        return Err(error);
    }

    Ok(WriteOutcome {
        sha256: sha256_hex(bytes),
        size_bytes: bytes.len() as u64,
        modified_ms: modified_ms(path).unwrap_or_else(now_ms),
        backup_path: backup_path.map(|path| path.to_string_lossy().to_string()),
        created: !existed,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn writes_atomically_and_keeps_no_temp_files() {
        let dir = tempfile::tempdir().unwrap();
        let backups = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.json");

        let first = write_atomic(&file, "{\"a\":1}", Some(backups.path())).unwrap();
        assert!(first.created);
        assert!(first.backup_path.is_none());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"a\":1}");
        assert_eq!(first.sha256, sha256_hex(b"{\"a\":1}"));

        let second = write_atomic(&file, "{\"a\":2}", Some(backups.path())).unwrap();
        assert!(!second.created);
        let backup = second.backup_path.expect("second write must back up");
        assert_eq!(std::fs::read_to_string(&backup).unwrap(), "{\"a\":1}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "{\"a\":2}");

        // no leftovers
        let leftovers: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .flatten()
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .filter(|name| name.contains("ahabby.tmp"))
            .collect();
        assert!(
            leftovers.is_empty(),
            "temp files left behind: {leftovers:?}"
        );
    }

    #[test]
    fn creates_missing_parent_directories() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested/deeper/config.toml");
        let outcome = write_atomic(&file, "a = 1\n", None).unwrap();
        assert!(outcome.created);
        assert!(file.is_file());
    }

    #[test]
    fn lists_and_restores_backups() {
        let dir = tempfile::tempdir().unwrap();
        let backups = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.json");

        write_atomic(&file, "one", Some(backups.path())).unwrap();
        write_atomic(&file, "two", Some(backups.path())).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        write_atomic(&file, "three", Some(backups.path())).unwrap();

        let entries = list_backups(backups.path(), &file).unwrap();
        assert_eq!(entries.len(), 2);
        assert_eq!(entries[0].original_path, file.to_string_lossy());
        assert!(entries[0].size_bytes > 0);
        // newest first
        assert!(entries[0].created_ms >= entries[1].created_ms);

        let contents: Vec<String> = entries
            .iter()
            .map(|entry| std::fs::read_to_string(&entry.path).unwrap())
            .collect();
        assert!(contents.contains(&"one".to_string()));
        assert!(contents.contains(&"two".to_string()));
    }

    #[test]
    fn deletes_one_backup_and_refuses_a_path_outside_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let backups = tempfile::tempdir().unwrap();
        let file = dir.path().join("config.json");

        write_atomic(&file, "one", Some(backups.path())).unwrap();
        write_atomic(&file, "two", Some(backups.path())).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(10));
        write_atomic(&file, "three", Some(backups.path())).unwrap();

        let entries = list_backups(backups.path(), &file).unwrap();
        assert_eq!(entries.len(), 2);
        let newest = Path::new(&entries[0].path).to_path_buf();

        // A path that is not a backup of this file is refused, and nothing is removed.
        let stranger = dir.path().join("other.json");
        std::fs::write(&stranger, "keep me").unwrap();
        let refused = delete_backup(backups.path(), &file, &stranger);
        assert!(refused.is_err());
        assert!(stranger.is_file());

        delete_backup(backups.path(), &file, &newest).unwrap();
        assert!(!newest.exists());
        let remaining = list_backups(backups.path(), &file).unwrap();
        assert_eq!(remaining.len(), 1);

        // The last copy takes the directory with it.
        delete_backup(backups.path(), &file, Path::new(&remaining[0].path)).unwrap();
        assert!(list_backups(backups.path(), &file).unwrap().is_empty());
        assert!(!backup_dir_for(backups.path(), &file).exists());
    }

    #[cfg(unix)]
    #[test]
    fn preserves_file_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("secret.json");
        std::fs::write(&file, "{}").unwrap();
        std::fs::set_permissions(&file, std::fs::Permissions::from_mode(0o600)).unwrap();

        write_atomic(&file, "{\"token\":1}", None).unwrap();
        let mode = std::fs::metadata(&file).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}
