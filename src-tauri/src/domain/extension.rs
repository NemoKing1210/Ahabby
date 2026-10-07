use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::scope::Scope;
use super::skill::short_hash;

/// Where an extension comes from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum ExtensionKind {
    /// A package the agent installed and tracks (npm, git or a local path).
    Package,
    /// A single file or directory the user dropped into the agent's extensions directory.
    Local,
    /// An extension the agent itself ships.
    Builtin,
}

/// How a package is fetched. `Local` is a package declared by path rather than published.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum ExtensionManager {
    Npm,
    Git,
    Local,
}

/// What a package contributes, so the UI can say "3 extensions, 2 skills" without opening it.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ExtensionResources {
    pub extensions: u32,
    pub skills: u32,
    pub prompts: u32,
    pub themes: u32,
}

impl ExtensionResources {
    pub fn is_empty(&self) -> bool {
        self.extensions == 0 && self.skills == 0 && self.prompts == 0 && self.themes == 0
    }
}

/// What the user asked to do with one extension.
///
/// Only the action is sent across the IPC boundary — the command line itself is resolved from
/// the manifest inside the backend, exactly like an install plan.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum ExtensionAction {
    Update,
    Remove,
}

/// One extension of an agent.
///
/// The same shape covers the three origins so the UI renders one card: a declared package, a
/// file in the extensions directory and a built-in extension.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Extension {
    /// Stable id: `<kind>:<short hash>` — survives a switched-off rename and a version bump.
    pub id: String,
    /// Id of the `[[extensions]]` entry this row was read from. A package's files live wherever
    /// the agent put them, so this — not the directory a path happens to be in — is what binds a
    /// row to the surface that declared it.
    pub surface: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub kind: ExtensionKind,
    /// How a package is fetched; `None` for a local file or a built-in.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manager: Option<ExtensionManager>,
    /// The source exactly as the agent declares it (`npm:foo@1.2.3`, `git:github.com/a/b`,
    /// `./tools/pi-ext`, a file path, `builtin:codemode`).
    pub source: String,
    /// The file or directory on disk. `None` when a package is declared but not installed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The entry file the agent loads, when it is file based (what Ahabby edits).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub author: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    /// `false` while the agent has stopped loading it (the entry file carries the disabled
    /// suffix, or the settings declare it off).
    #[serde(default = "super::default_true")]
    pub enabled: bool,
    /// `true` when the agent can reconcile the package from its source.
    #[serde(default)]
    pub can_update: bool,
    /// `true` when Ahabby can remove it (a package through the agent, a local file to the trash).
    #[serde(default)]
    pub can_remove: bool,
    /// `true` when the entry file can be renamed aside and back.
    #[serde(default)]
    pub can_toggle: bool,
    pub scope: Scope,
    pub agent: AgentRef,
    /// What the package ships, all four resource kinds of the agent.
    #[serde(default)]
    pub resources: ExtensionResources,
    /// `true` when the manifest path for this extension has not been verified against docs.
    pub unverified: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub modified_ms: Option<i64>,
}

impl Extension {
    /// A package id is derived from its source without the pinned version, so bumping the pin
    /// does not turn the row into a new one; a local id is derived from the path.
    pub fn new_id(kind: ExtensionKind, key: &str) -> String {
        let prefix = match kind {
            ExtensionKind::Package => "package",
            ExtensionKind::Local => "local",
            ExtensionKind::Builtin => "builtin",
        };
        format!("{prefix}:{}", short_hash(key))
    }
}

/// What `delete_extension` did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ExtensionRemoval {
    pub removed_extension_id: String,
    pub name: String,
    pub path: String,
    /// `true` when the file went to the OS trash rather than being deleted in place.
    pub trashed: bool,
}

/// What `set_extension_enabled` did.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ExtensionToggle {
    pub extension_id: String,
    pub name: String,
    pub enabled: bool,
    pub path: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_ids_ignore_the_pinned_version() {
        // The reader strips the version before hashing, which is what keeps a bump stable.
        assert_eq!(
            Extension::new_id(ExtensionKind::Package, "npm:foo"),
            Extension::new_id(ExtensionKind::Package, "npm:foo")
        );
        assert_ne!(
            Extension::new_id(ExtensionKind::Package, "npm:foo"),
            Extension::new_id(ExtensionKind::Package, "npm:bar")
        );
    }

    #[test]
    fn resources_default_is_empty() {
        assert!(ExtensionResources::default().is_empty());
    }
}
