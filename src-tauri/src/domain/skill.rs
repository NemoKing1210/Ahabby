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
    /// Creation time of the entry file (`SKILL.md`), when the platform reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub created_ms: Option<i64>,
    /// Modification time of that same file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub modified_ms: Option<i64>,
    /// `false` while the user has the skill switched off: its entry file is renamed to
    /// `<name>.disabled`, so the agent stops loading it while nothing is lost. The skill is
    /// still scanned so the UI can offer to switch it back on.
    #[serde(default = "super::default_true")]
    pub enabled: bool,
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

/// What the frontend sends to create a skill of its own.
///
/// Ahabby writes the `SKILL.md` convention (`<skills dir>/<slug>/SKILL.md` with YAML
/// frontmatter), which is what every skills-declaring manifest in the catalog uses. The
/// directory is derived from `name`, so the name is the only required field.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SkillDraft {
    /// Human-readable name; also the `name` of the frontmatter.
    pub name: String,
    /// One-line summary the agents show next to the skill.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Markdown body, frontmatter excluded. `None` writes the frontmatter alone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub content: Option<String>,
}

/// A skill whose files come from somewhere other than a form: the Hub.
///
/// Unlike [`SkillDraft`] the payload is not rendered — its `SKILL.md` is what the agent will
/// read, exactly as the collection published it — so the adapter writes every file under a
/// directory derived from `name` and nothing else.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillInstall {
    /// Human-readable name; the directory name is derived from it.
    pub name: String,
    /// Skill-relative path → contents. One of them must be the `SKILL.md` entry file.
    pub files: Vec<SkillInstallFile>,
}

/// One file of a [`SkillInstall`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SkillInstallFile {
    /// `/`-separated path inside the skill directory (`scripts/render.py`).
    pub path: String,
    /// The bytes to write. A skill may ship a font or an archive as readily as a script.
    pub bytes: Vec<u8>,
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
