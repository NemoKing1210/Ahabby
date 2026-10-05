//! Adapter registry: manifest → adapter instance.
//!
//! Selection is manifest driven (`adapter = "claude"` in the TOML), so adding an agent
//! still never touches Rust code. An unknown adapter id is logged and falls back to the
//! default manifest driven implementation instead of failing the whole scan.
//!
//! Adapters are shared through `Arc` so the registry is cheap to clone — the scanner keeps
//! a snapshot while a rescan can swap in a freshly loaded catalog.

use std::sync::Arc;

use tracing::warn;

use crate::catalog::Catalog;
use crate::domain::AgentManifest;

use super::claude::ClaudeAdapter;
use super::manifest_adapter::ManifestAdapter;
use super::AgentAdapter;

/// Build the adapter for one manifest.
pub fn create(manifest: AgentManifest) -> Arc<dyn AgentAdapter> {
    match manifest.adapter.as_deref() {
        None | Some("manifest") => Arc::new(ManifestAdapter::new(manifest)),
        Some("claude" | "claude-code") => Arc::new(ClaudeAdapter::new(manifest)),
        Some(unknown) => {
            warn!(
                manifest = %manifest.id,
                adapter = %unknown,
                "unknown adapter id in manifest; falling back to the manifest driven adapter"
            );
            Arc::new(ManifestAdapter::new(manifest))
        }
    }
}

/// All adapters of a loaded catalog.
#[derive(Clone, Default)]
pub struct AdapterRegistry {
    adapters: Vec<Arc<dyn AgentAdapter>>,
}

impl AdapterRegistry {
    pub fn from_catalog(catalog: &Catalog) -> Self {
        Self {
            adapters: catalog.manifests.iter().cloned().map(create).collect(),
        }
    }

    pub fn all(&self) -> &[Arc<dyn AgentAdapter>] {
        &self.adapters
    }

    pub fn get(&self, id: &str) -> Option<&dyn AgentAdapter> {
        self.adapters
            .iter()
            .find(|adapter| adapter.manifest().id == id)
            .map(Arc::as_ref)
    }

    pub fn len(&self) -> usize {
        self.adapters.len()
    }

    pub fn is_empty(&self) -> bool {
        self.adapters.is_empty()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(id: &str, adapter: Option<&str>) -> AgentManifest {
        let adapter_line = adapter
            .map(|adapter| format!("adapter = \"{adapter}\"\n"))
            .unwrap_or_default();
        toml_edit::de::from_str(&format!(
            r#"
id = "{id}"
name = "{id}"
description = "d"
{adapter_line}
[binaries]
names = ["{id}"]
"#
        ))
        .unwrap()
    }

    #[test]
    fn default_is_the_manifest_adapter() {
        let adapter = create(manifest("demo", None));
        assert_eq!(adapter.manifest().id, "demo");
        assert!(adapter.manifest().skills.is_none());
        assert_eq!(
            create(manifest("demo", Some("manifest"))).manifest().id,
            "demo"
        );
    }

    #[test]
    fn unknown_adapter_id_falls_back_instead_of_panicking() {
        let adapter = create(manifest("demo", Some("definitely-not-real")));
        assert_eq!(adapter.manifest().id, "demo");
    }

    #[test]
    fn claude_adapter_is_selectable() {
        let adapter = create(manifest("claude-code", Some("claude")));
        assert_eq!(adapter.manifest().id, "claude-code");
    }

    #[test]
    fn registry_indexes_by_id() {
        let mut catalog = Catalog::default();
        catalog.manifests.push(manifest("b", None));
        catalog.manifests.push(manifest("a", None));
        let registry = AdapterRegistry::from_catalog(&catalog);
        assert_eq!(registry.len(), 2);
        assert!(registry.get("a").is_some());
        assert!(registry.get("zzz").is_none());
        assert_eq!(registry.clone().len(), 2);
    }
}
