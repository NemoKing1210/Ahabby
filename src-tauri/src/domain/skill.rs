use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::scope::Scope;

/// A key/value pair read from a skill's YAML frontmatter (order preserved).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct FrontmatterEntry {
    pub key: String,
    pub value: String,
}

/// A global skill of one or more agents.
///
/// The library view merges the *same* skill discovered for several agents into a single
/// entry (see `services::library`), which is why `agents` is a list.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Skill {
    /// Stable id: `<name>#<short path hash>`.
    pub id: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Directory that holds the skill (what gets trashed when the user deletes it).
    pub path: String,
    /// The markdown file itself, when the skill is file based.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub entry_path: Option<String>,
    pub scope: Scope,
    pub agents: Vec<AgentRef>,
    #[serde(default)]
    pub frontmatter: Vec<FrontmatterEntry>,
    /// Markdown body (frontmatter stripped). `None` when the skill is a bare directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    /// `false` for skills Ahabby refuses to delete (e.g. a plugin-managed directory).
    pub removable: bool,
    /// `true` when the manifest path for this skill has not been verified against docs.
    pub unverified: bool,
}

impl Skill {
    pub fn new_id(name: &str, path: &str) -> String {
        format!("{}#{}", name, crate::domain::skill::short_hash(path))
    }
}

/// Short, stable, collision-resistant-enough hash used in ids.
pub fn short_hash(value: &str) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = hasher.finalize();
    hex::encode(&digest[..6])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_are_stable_and_distinct() {
        assert_eq!(
            Skill::new_id("pdf", "/a/pdf"),
            Skill::new_id("pdf", "/a/pdf")
        );
        assert_ne!(
            Skill::new_id("pdf", "/a/pdf"),
            Skill::new_id("pdf", "/b/pdf")
        );
        assert_eq!(short_hash("/a/pdf").len(), 12);
    }
}
