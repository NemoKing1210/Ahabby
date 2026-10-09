//! Persisted star counts for Hub GitHub collections.
//!
//! Star counts are trivia read from GitHub's API, so a rate limit or an offline machine must not
//! wipe the screen's order. A successful count is kept in memory and on disk; a failed refresh
//! falls back to the last known value instead of clearing it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::platform::{self, now_ms};

/// File name inside `<app data>/cache/`.
const FILE_NAME: &str = "hub-stars.json";

/// How long a count is reused without asking GitHub again.
///
/// Stars move slowly; a day is plenty, and it keeps the Hub from burning the unauthenticated
/// GitHub rate limit every time the screen opens.
pub const STARS_FRESH_MS: i64 = 24 * 60 * 60 * 1000;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct StarEntry {
    count: u64,
    at_ms: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StarsFile {
    /// `owner/repo` → last known star count.
    repositories: HashMap<String, StarEntry>,
}

/// In-memory + on-disk star counts for Hub GitHub sources.
pub struct StarsCache {
    path: PathBuf,
    entries: HashMap<String, StarEntry>,
}

impl StarsCache {
    /// Load whatever was saved under `app_data`, or start empty.
    pub fn load(app_data: &Path) -> Self {
        let path = app_data.join("cache").join(FILE_NAME);
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<StarsFile>(&raw).ok())
            .map(|file| file.repositories)
            .unwrap_or_default();
        Self { path, entries }
    }

    /// A count that is still fresh enough that GitHub need not be asked.
    pub fn get_fresh(&self, repository: &str) -> Option<u64> {
        let entry = self.entries.get(repository)?;
        fresh(entry.at_ms).then_some(entry.count)
    }

    /// The last known count, even when it is older than the refresh window.
    pub fn get_any(&self, repository: &str) -> Option<u64> {
        self.entries.get(repository).map(|entry| entry.count)
    }

    /// Remember a freshly fetched count and write the file (best-effort).
    pub fn put(&mut self, repository: &str, count: u64) {
        self.entries.insert(
            repository.to_string(),
            StarEntry {
                count,
                at_ms: now_ms(),
            },
        );
        if let Err(error) = self.save() {
            tracing::warn!("could not persist hub star counts: {error}");
        }
    }

    fn save(&self) -> Result<()> {
        let file = StarsFile {
            repositories: self.entries.clone(),
        };
        platform::write_atomic(&self.path, &serde_json::to_string_pretty(&file)?, None)?;
        Ok(())
    }
}

fn fresh(at_ms: i64) -> bool {
    now_ms() - at_ms < STARS_FRESH_MS
}

/// Resolve a star count: prefer a fresh cache hit, else `fetched`, else the stale cache.
///
/// Pure helper so the fallback rule is unit-tested without a live HubService or network.
pub fn resolve_star_count(
    fresh: Option<u64>,
    fetched: Option<u64>,
    stale: Option<u64>,
) -> Option<u64> {
    if let Some(count) = fresh {
        return Some(count);
    }
    fetched.or(stale)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trips_star_counts_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let mut cache = StarsCache::load(dir.path());
        assert!(cache.get_any("owner/repo").is_none());

        cache.put("owner/repo", 18432);
        assert_eq!(cache.get_fresh("owner/repo"), Some(18432));
        assert_eq!(cache.get_any("owner/repo"), Some(18432));

        let reloaded = StarsCache::load(dir.path());
        assert_eq!(reloaded.get_any("owner/repo"), Some(18432));
        assert_eq!(reloaded.get_fresh("owner/repo"), Some(18432));
    }

    #[test]
    fn a_failed_refresh_keeps_the_last_known_count() {
        assert_eq!(
            resolve_star_count(None, None, Some(900)),
            Some(900),
            "rate limit / offline must not clear the sort key"
        );
        assert_eq!(resolve_star_count(Some(10), None, Some(900)), Some(10));
        assert_eq!(resolve_star_count(None, Some(42), Some(900)), Some(42));
        assert_eq!(resolve_star_count(None, None, None), None);
    }

    #[test]
    fn a_stale_entry_is_still_returned_by_get_any() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache").join(FILE_NAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = StarsFile {
            repositories: HashMap::from([(
                "owner/old".to_string(),
                StarEntry {
                    count: 7,
                    // Far enough in the past that it is never "fresh".
                    at_ms: 1,
                },
            )]),
        };
        std::fs::write(&path, serde_json::to_string(&file).unwrap()).unwrap();

        let cache = StarsCache::load(dir.path());
        assert_eq!(cache.get_fresh("owner/old"), None);
        assert_eq!(cache.get_any("owner/old"), Some(7));
    }
}
