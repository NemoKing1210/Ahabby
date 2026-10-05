//! Persisted snapshot of the last scan.
//!
//! A scan shells out to every known agent binary and reads its config files, which takes
//! seconds. Keeping the last report on disk is what lets a restart paint the whole app
//! immediately and *then* refresh it in the background, instead of showing skeletons again.
//!
//! This is a cache, not state: a missing, unreadable or foreign file is not an error, the
//! next scan simply replaces it. It is never the source of truth for a write — the live scan
//! is — it only makes the first paint instant.

use std::path::{Path, PathBuf};

use crate::domain::Os;
use crate::error::Result;
use crate::platform;

use super::ScanReport;

/// File name inside `<app data>/cache/`.
const FILE_NAME: &str = "last-scan.json";

pub struct ScanCache {
    path: PathBuf,
}

impl ScanCache {
    pub fn new(app_data: &Path) -> Self {
        Self {
            path: app_data.join("cache").join(FILE_NAME),
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    /// The report of the previous run, when it is readable and was written on this platform.
    pub fn load(&self) -> Option<ScanReport> {
        let raw = std::fs::read_to_string(&self.path).ok()?;
        let report = serde_json::from_str::<ScanReport>(&raw).ok()?;
        // A report from another OS describes binaries and paths that cannot exist here.
        (report.os == Os::current()).then_some(report)
    }

    /// Persist the report atomically (no backup: the previous cache has no value).
    pub fn save(&self, report: &ScanReport) -> Result<()> {
        let content = serde_json::to_string(report)?;
        platform::write_atomic(&self.path, &content, None)?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Os;

    fn report(os: Os, scanned_at_ms: i64) -> ScanReport {
        ScanReport {
            agents: Vec::new(),
            problems: Vec::new(),
            scanned_at_ms,
            duration_ms: 12,
            installed: 0,
            available_to_install: 0,
            os,
        }
    }

    #[test]
    fn round_trips_the_last_report() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ScanCache::new(dir.path());
        assert!(cache.load().is_none(), "nothing cached yet");

        cache.save(&report(Os::current(), 1234)).unwrap();
        let loaded = cache.load().expect("cached report");
        assert_eq!(loaded.scanned_at_ms, 1234);
        assert_eq!(loaded.duration_ms, 12);

        // A second save replaces the first one instead of stacking up.
        cache.save(&report(Os::current(), 5678)).unwrap();
        assert_eq!(cache.load().unwrap().scanned_at_ms, 5678);
    }

    #[test]
    fn a_corrupt_cache_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ScanCache::new(dir.path());

        std::fs::create_dir_all(cache.path().parent().unwrap()).unwrap();
        std::fs::write(cache.path(), "{not json").unwrap();
        assert!(cache.load().is_none());
    }

    #[test]
    fn a_report_from_another_platform_is_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let cache = ScanCache::new(dir.path());
        let other = if Os::current() == Os::Windows {
            Os::Linux
        } else {
            Os::Windows
        };

        cache.save(&report(other, 42)).unwrap();
        assert!(cache.load().is_none());
    }
}
