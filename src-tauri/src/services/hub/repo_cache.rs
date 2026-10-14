//! Persisted facts about the GitHub repositories the Hub's collections live in.
//!
//! One `GET /repos/{owner}/{repo}` answers two things the screen uses: how many stars a collection
//! has — which is what orders the Hub — and the avatar of the account that publishes it. Both are
//! trivia read over the network, so a rate limit or an offline machine must not wipe what was
//! already read: a successful answer is kept in memory and on disk, and a failed refresh falls back
//! to the last known values instead of clearing them.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::Result;
use crate::platform::{self, now_ms};

use super::parse::RepoFacts;

/// File name inside `<app data>/cache/`.
const FILE_NAME: &str = "hub-repos.json";

/// How long a repository's facts are reused without asking GitHub again.
///
/// Stars move slowly; a day is plenty, and it keeps the Hub from burning the unauthenticated
/// GitHub rate limit every time the screen opens.
pub const REPOS_FRESH_MS: i64 = 24 * 60 * 60 * 1000;

/// One repository as the file holds it: never empty, because only an answer that carried
/// something is remembered.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct RepoEntry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    stars: Option<u64>,
    /// The owner's avatar, as a URL — the reader's image proxy is what turns it into pixels.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    avatar: Option<String>,
    at_ms: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReposFile {
    /// `owner/repo` → what was last read about it.
    repositories: HashMap<String, RepoEntry>,
}

/// In-memory + on-disk facts about the GitHub repositories of the Hub's sources.
pub struct RepoCache {
    path: PathBuf,
    entries: HashMap<String, RepoEntry>,
}

impl RepoCache {
    /// Load whatever was saved under `app_data`, or start empty.
    pub fn load(app_data: &Path) -> Self {
        let path = app_data.join("cache").join(FILE_NAME);
        let entries = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<ReposFile>(&raw).ok())
            .map(|file| file.repositories)
            .unwrap_or_default();
        Self { path, entries }
    }

    /// What was read about this repository, when it is still fresh enough that GitHub need not be
    /// asked again.
    pub fn get_fresh(&self, repository: &str) -> Option<RepoFacts> {
        let entry = self.entries.get(repository)?;
        if !fresh(entry.at_ms) {
            return None;
        }
        let facts = facts_of(entry);
        (!facts.is_empty()).then_some(facts)
    }

    /// The last known facts, even when they are older than the refresh window.
    pub fn get_any(&self, repository: &str) -> Option<RepoFacts> {
        let facts = facts_of(self.entries.get(repository)?);
        (!facts.is_empty()).then_some(facts)
    }

    /// Remember a freshly fetched answer and write the file (best-effort).
    pub fn put(&mut self, repository: &str, facts: &RepoFacts) {
        self.entries.insert(
            repository.to_string(),
            RepoEntry {
                stars: facts.stars,
                avatar: facts.avatar.clone(),
                at_ms: now_ms(),
            },
        );
        if let Err(error) = self.save() {
            tracing::warn!("could not persist hub repository facts: {error}");
        }
    }

    fn save(&self) -> Result<()> {
        let file = ReposFile {
            repositories: self.entries.clone(),
        };
        platform::write_atomic(&self.path, &serde_json::to_string_pretty(&file)?, None)?;
        Ok(())
    }
}

fn facts_of(entry: &RepoEntry) -> RepoFacts {
    RepoFacts {
        stars: entry.stars,
        avatar: entry.avatar.clone(),
    }
}

fn fresh(at_ms: i64) -> bool {
    now_ms() - at_ms < REPOS_FRESH_MS
}

/// Resolve one repository's facts: a fresh cache hit, else what GitHub just answered, else the
/// stale cache.
///
/// A failed refresh keeps what was read before — the count that ordered the Hub once, and the
/// picture that came with it — and an answer that carried only one of the two keeps the other.
///
/// Pure helper so the fallback rule is unit-tested without a live HubService or network.
pub fn resolve_repo_facts(
    fresh: Option<RepoFacts>,
    fetched: Option<RepoFacts>,
    stale: Option<RepoFacts>,
) -> RepoFacts {
    if let Some(facts) = fresh {
        return facts;
    }
    let stale = stale.unwrap_or_default();
    match fetched {
        Some(facts) => facts.or(&stale),
        None => stale,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts(stars: u64, avatar: &str) -> RepoFacts {
        RepoFacts {
            stars: Some(stars),
            avatar: Some(avatar.to_string()),
        }
    }

    #[test]
    fn round_trips_repository_facts_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let mut cache = RepoCache::load(dir.path());
        assert!(cache.get_any("owner/repo").is_none());

        cache.put(
            "owner/repo",
            &facts(18432, "https://avatars.githubusercontent.com/u/1"),
        );
        let expected = facts(18432, "https://avatars.githubusercontent.com/u/1");
        assert_eq!(cache.get_fresh("owner/repo"), Some(expected.clone()));
        assert_eq!(cache.get_any("owner/repo"), Some(expected.clone()));

        let reloaded = RepoCache::load(dir.path());
        assert_eq!(reloaded.get_any("owner/repo"), Some(expected.clone()));
        assert_eq!(reloaded.get_fresh("owner/repo"), Some(expected));
    }

    #[test]
    fn a_failed_refresh_keeps_the_last_known_facts() {
        let stale = facts(900, "https://avatars.githubusercontent.com/u/1");
        assert_eq!(resolve_repo_facts(None, None, Some(stale.clone())), stale);
        assert_eq!(
            resolve_repo_facts(
                Some(facts(10, "https://avatars.githubusercontent.com/u/2")),
                None,
                Some(stale.clone())
            ),
            facts(10, "https://avatars.githubusercontent.com/u/2"),
            "a fresh cache hit is not re-read"
        );
        assert_eq!(
            resolve_repo_facts(
                None,
                Some(facts(42, "https://avatars.githubusercontent.com/u/3")),
                Some(stale.clone())
            ),
            facts(42, "https://avatars.githubusercontent.com/u/3")
        );
        // An answer that named the stars but not the avatar keeps the picture read before it.
        let partial = RepoFacts {
            stars: Some(42),
            avatar: None,
        };
        assert_eq!(
            resolve_repo_facts(None, Some(partial), Some(stale)),
            facts(42, "https://avatars.githubusercontent.com/u/1")
        );
        assert_eq!(
            resolve_repo_facts(None, None, None),
            RepoFacts::default(),
            "nothing was ever known"
        );
    }

    #[test]
    fn a_stale_entry_is_still_returned_by_get_any() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache").join(FILE_NAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = ReposFile {
            repositories: HashMap::from([(
                "owner/old".to_string(),
                RepoEntry {
                    stars: Some(7),
                    avatar: None,
                    // Far enough in the past that it is never "fresh".
                    at_ms: 1,
                },
            )]),
        };
        std::fs::write(&path, serde_json::to_string(&file).unwrap()).unwrap();

        let cache = RepoCache::load(dir.path());
        assert_eq!(cache.get_fresh("owner/old"), None);
        assert_eq!(
            cache.get_any("owner/old"),
            Some(RepoFacts {
                stars: Some(7),
                avatar: None,
            })
        );
    }

    #[test]
    fn an_entry_that_carries_nothing_is_not_a_hit() {
        // A file written before the cache held avatars, or by a build that read nothing, must not
        // pass for an answer: a fresh hit with no facts would stop the Hub asking for a day.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cache").join(FILE_NAME);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let file = ReposFile {
            repositories: HashMap::from([(
                "owner/empty".to_string(),
                RepoEntry {
                    stars: None,
                    avatar: None,
                    at_ms: now_ms(),
                },
            )]),
        };
        std::fs::write(&path, serde_json::to_string(&file).unwrap()).unwrap();

        let cache = RepoCache::load(dir.path());
        assert_eq!(cache.get_fresh("owner/empty"), None);
        assert_eq!(cache.get_any("owner/empty"), None);
    }
}
