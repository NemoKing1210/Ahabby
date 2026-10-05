//! Optional "a newer version exists" checks.
//!
//! Deliberately decoupled from scanning: results are cached, failures are silent, and the
//! whole feature can be switched off in Settings. Ahabby never sends anything except a
//! plain GET to the public registry of the package the agent is installed from.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use crate::domain::{AgentManifest, Version};
use crate::platform::now_ms;

/// Where a "latest version" can be read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ReleaseSource {
    /// npm / pnpm / yarn / bun package.
    Npm { package: String },
    /// GitHub releases (`owner/repo`).
    Github { repository: String },
}

impl ReleaseSource {
    pub fn label(&self) -> &'static str {
        match self {
            ReleaseSource::Npm { .. } => "npm",
            ReleaseSource::Github { .. } => "github",
        }
    }
}

/// Sources derivable from a manifest, in the order they are tried.
pub fn sources_for(manifest: &AgentManifest) -> Vec<ReleaseSource> {
    let mut sources = Vec::new();
    if let Some(package) = manifest.npm_package() {
        sources.push(ReleaseSource::Npm { package });
    }
    if let Some(repository) = &manifest.github {
        sources.push(ReleaseSource::Github {
            repository: repository.clone(),
        });
    }
    sources
}

#[derive(Debug, Clone)]
struct Cached {
    latest: Version,
    source: String,
    checked_at_ms: i64,
}

pub struct VersionChecker {
    client: reqwest::Client,
    cache: Mutex<HashMap<String, Cached>>,
    ttl_ms: i64,
    enabled: bool,
}

impl VersionChecker {
    pub fn new(enabled: bool, cache_minutes: u32) -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Ahabby/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(8))
            .build()
            .unwrap_or_default();
        Self {
            client,
            cache: Mutex::new(HashMap::new()),
            ttl_ms: i64::from(cache_minutes.max(1)) * 60_000,
            enabled,
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    /// Latest published version of an agent, or `None` when there is nothing to check,
    /// the network is off, or the registry does not answer.
    pub async fn latest_for(&self, manifest: &AgentManifest) -> Option<(Version, String)> {
        if !self.enabled {
            return None;
        }
        if let Some(cached) = self.cached(&manifest.id) {
            return Some((cached.latest, cached.source));
        }

        for source in sources_for(manifest) {
            let version = match &source {
                ReleaseSource::Npm { package } => self.latest_from_npm(package).await,
                ReleaseSource::Github { repository } => self.latest_from_github(repository).await,
            };
            if let Some(latest) = version {
                let source = source.label().to_string();
                self.store(
                    &manifest.id,
                    Cached {
                        latest: latest.clone(),
                        source: source.clone(),
                        checked_at_ms: now_ms(),
                    },
                );
                return Some((latest, source));
            }
        }
        None
    }

    fn cached(&self, key: &str) -> Option<Cached> {
        let cache = self.cache.lock().ok()?;
        let entry = cache.get(key)?;
        if now_ms() - entry.checked_at_ms > self.ttl_ms {
            return None;
        }
        Some(entry.clone())
    }

    fn store(&self, key: &str, value: Cached) {
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key.to_string(), value);
        }
    }

    async fn latest_from_npm(&self, package: &str) -> Option<Version> {
        // Scoped packages need their slash escaped inside the path segment.
        let encoded = package.replace('/', "%2F");
        let url = format!("https://registry.npmjs.org/{encoded}/latest");
        let response = self.client.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let body: serde_json::Value = response.json().await.ok()?;
        let version = body.get("version")?.as_str()?;
        Version::parse(version)
    }

    async fn latest_from_github(&self, repository: &str) -> Option<Version> {
        let url = format!("https://api.github.com/repos/{repository}/releases/latest");
        let response = self.client.get(url).send().await.ok()?;
        if !response.status().is_success() {
            return None;
        }
        let body: serde_json::Value = response.json().await.ok()?;
        let tag = body.get("tag_name")?.as_str()?;
        Version::parse(tag)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(toml: &str) -> AgentManifest {
        toml_edit::de::from_str(toml).unwrap()
    }

    #[test]
    fn sources_come_from_the_manifest() {
        let manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "d"
github = "owner/demo"

[binaries]
names = ["demo"]

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g @scope/demo"
"#,
        );
        assert_eq!(
            sources_for(&manifest),
            vec![
                ReleaseSource::Npm {
                    package: "@scope/demo".to_string()
                },
                ReleaseSource::Github {
                    repository: "owner/demo".to_string()
                },
            ]
        );
    }

    #[test]
    fn disabled_checker_never_touches_the_network() {
        let checker = VersionChecker::new(false, 60);
        assert!(!checker.enabled());
        let manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "d"

[binaries]
names = ["demo"]

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g demo"
"#,
        );
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        assert!(runtime.block_on(checker.latest_for(&manifest)).is_none());
    }

    #[test]
    fn manifest_without_release_source_has_none() {
        let manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "d"

[binaries]
names = ["demo"]

[[methods]]
id = "script"
manager = "script"
command = "curl -fsSL https://example.com/install.sh | sh"
"#,
        );
        assert!(sources_for(&manifest).is_empty());
    }

    #[test]
    fn cache_honours_ttl() {
        let checker = VersionChecker::new(true, 60);
        checker.store(
            "demo",
            Cached {
                latest: Version::parse("9.9.9").unwrap(),
                source: "npm".to_string(),
                checked_at_ms: now_ms(),
            },
        );
        assert_eq!(checker.cached("demo").unwrap().latest.raw, "9.9.9");

        checker.store(
            "stale",
            Cached {
                latest: Version::parse("1.0.0").unwrap(),
                source: "npm".to_string(),
                checked_at_ms: now_ms() - 61 * 60_000,
            },
        );
        assert!(checker.cached("stale").is_none());
    }
}
