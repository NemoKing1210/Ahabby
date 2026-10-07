//! The Hub: a browsable, installable library of skills and MCP servers.
//!
//! A *hub source* is a declarative description of somewhere a large, always growing collection
//! of skills and MCP servers is published — the official MCP registry, a GitHub repository of
//! `SKILL.md` directories, or a JSON index. Sources are data, not code: a new one is a TOML file
//! (see `catalog/HUB.md`), exactly like adding support for a new agent is a manifest.
//!
//! What a source yields is a [`HubEntry`]: a *description* of one installable thing, never its
//! bytes. A skill's files are fetched when the user installs it (and cached meanwhile), which is
//! what keeps a library of thousands of entries cheap to browse.
//!
//! Nothing here talks to the network: [`services::hub`](crate::services::hub) does, and the
//! frontend only ever sees these models.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::mcp::{McpServer, McpTransport};
use super::skill::Skill;

/// What an entry installs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum HubResourceKind {
    /// A skill directory (`<skills dir>/<name>/SKILL.md` and the files next to it).
    Skill,
    /// One entry in an MCP config file.
    Mcp,
}

impl HubResourceKind {
    pub const fn label(self) -> &'static str {
        match self {
            HubResourceKind::Skill => "skill",
            HubResourceKind::Mcp => "mcp",
        }
    }
}

/// How a source is read. One kind per documented API/format, so a source declares *what* it is
/// and the reader knows *how* to talk to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum HubSourceKind {
    /// The official MCP registry (`GET <url>/v0/servers?search=&cursor=&limit=`), which is
    /// searched and paged server side.
    McpRegistry,
    /// A GitHub repository read as one tarball: every directory holding a `SKILL.md` is a skill.
    GithubSkills,
    /// A JSON document listing entries explicitly (`catalog/HUB.md` describes the shape).
    Index,
}

/// One place a library comes from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubSource {
    pub id: String,
    pub name: String,
    pub kind: HubSourceKind,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Kinds of resources this source offers. A source that declares neither installs nothing,
    /// which the loader reports as a problem.
    #[serde(default)]
    pub provides: Vec<HubResourceKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    /// Who publishes the collection — shown on an entry's card.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// `mcpRegistry` / `index`: where the document to read lives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    /// `githubSkills`: `owner/repo`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    /// Branch, tag or commit to read. Defaults to `main`.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "git_ref")]
    pub git_ref: Option<String>,
    /// `githubSkills`: only skills under this repository directory are offered.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// Repository paths (directories or globs) that are never offered as skills — a template
    /// skeleton, a vendored copy, an example.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub exclude: Vec<String>,
    /// `true` for a source embedded in the binary. A user source with the same id replaces it.
    #[serde(default)]
    pub builtin: bool,
    /// Where a user source was read from, for the UI to point at.
    ///
    /// Set by the loader, never by the file itself: the loader overwrites whatever it read.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        alias = "source_file"
    )]
    pub source_file: Option<String>,
}

impl HubSource {
    /// `owner/repo` of a GitHub source, or the repository an `index` document declares.
    pub fn repository(&self) -> Option<&str> {
        self.repository.as_deref().map(str::trim)
    }

    /// The branch/tag/commit to read, defaulting to `main`.
    pub fn git_ref(&self) -> &str {
        self.git_ref
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("main")
    }

    /// Whether this source offers entries of `kind`.
    pub fn offers(&self, kind: HubResourceKind) -> bool {
        self.provides.contains(&kind)
    }
}

/// Everything the hub knows where to look.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubSourceCatalog {
    pub sources: Vec<HubSource>,
    /// Sources that failed to load, reported instead of silently disappearing.
    pub problems: Vec<super::catalog::CatalogProblem>,
    /// Directory a user source may be dropped into, so the UI can tell the user where.
    pub user_dir: String,
}

/// What kind of payload a file of a skill is.
///
/// The distinction is what the install dialog shows as a warning: a skill is instructions, but it
/// may also carry scripts the agent will run, and the user deserves to see that before the write.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum HubFileKind {
    /// Markdown, JSON, YAML and other plain text.
    Text,
    /// Something an agent may execute (`.py`, `.sh`, `.js`, `.ps1`, `.bat`, …).
    Script,
    /// Anything else: images, fonts, archives.
    Binary,
}

/// One file an install would write, relative to the resource's own directory.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubFileInfo {
    pub path: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub kind: HubFileKind,
}

/// One value the user has to supply before an MCP server can be written: an environment variable
/// of a stdio server, or a header of a remote one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubInput {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// The publisher says the server does not work without it.
    #[serde(default)]
    pub required: bool,
    /// The publisher marks the value as a secret (a token, a key).
    #[serde(default)]
    pub secret: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default: Option<String>,
}

/// One installable thing a source offers.
///
/// Deliberately a description, not a payload: the list view of a source with hundreds of skills
/// is one document read away from the repository, and the bytes of one skill are only fetched
/// when the user installs it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubEntry {
    /// `<source id>/<what the source calls it>` — what every command addresses.
    pub id: String,
    pub source_id: String,
    pub source_name: String,
    pub kind: HubResourceKind,
    pub name: String,
    /// The publisher's display title, when it differs from the addressable name.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    /// Files the install writes (skills), from the repository listing — no download needed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub file_count: Option<u32>,
    /// Total size of those files, when the source reports it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    /// `true` when Ahabby knows how to install it.
    #[serde(default)]
    pub installable: bool,
    /// Why it cannot be installed, when it cannot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_problem: Option<String>,
    /// How many values the install form will ask for.
    #[serde(default)]
    pub input_count: u32,
    /// `true` when the skill carries files an agent may execute.
    #[serde(default)]
    pub has_scripts: bool,
}

/// The entry file of a skill, read out of the collection so the user can read the instructions
/// *before* anything is written.
///
/// It is the file an agent would load (`SKILL.md`), already split the way the UI shows a skill it
/// found on disk: the frontmatter as key/value rows and the markdown body rendered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubPreview {
    /// Path of the file inside the skill's own directory.
    pub path: String,
    /// Markdown body (frontmatter stripped).
    pub content: String,
    /// Frontmatter of that file, in document order.
    #[serde(default)]
    pub frontmatter: Vec<super::skill::FrontmatterEntry>,
    /// `true` when the file is longer than a preview carries.
    #[serde(default)]
    pub truncated: bool,
}

/// One entry with everything the install dialog needs.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubEntryDetail {
    pub entry: HubEntry,
    /// Files the install writes, relative to the resource's own directory (skills).
    #[serde(default)]
    pub files: Vec<HubFileInfo>,
    /// The instructions themselves, for a preview before installing (skills).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub preview: Option<HubPreview>,
    /// The launch recipe, pre-filled from the entry and editable in the form (MCP servers).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<McpTransport>,
    /// Values the user has to supply.
    #[serde(default)]
    pub inputs: Vec<HubInput>,
    /// Where the entry's own description/documentation lives.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_url: Option<String>,
}

/// A page of one source's entries.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubPage {
    pub entries: Vec<HubEntry>,
    /// What the source answered, including its own failure — one source failing is a note next
    /// to its section, never a broken screen.
    pub report: HubSourceReport,
    #[ts(type = "number")]
    pub fetched_at_ms: i64,
}

/// What one source answered, including its own failure.
///
/// A source that times out or is down never fails the whole screen: the others are still listed,
/// and this report is what the UI shows next to the empty section.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubSourceReport {
    pub id: String,
    pub name: String,
    pub kind: HubSourceKind,
    pub provides: Vec<HubResourceKind>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default)]
    pub builtin: bool,
    /// Entries in this page.
    #[ts(type = "number")]
    pub count: u32,
    /// Entries the source holds in total, when it says so.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub total: Option<u32>,
    /// Opaque cursor for the next page, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_cursor: Option<String>,
    /// How long this source took to answer.
    #[ts(type = "number")]
    pub duration_ms: u64,
    /// `true` when the answer came from the in-memory cache.
    #[serde(default)]
    pub from_cache: bool,
    /// This source's own failure, when it failed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    /// Things this source said that the user should know without it being a failure: entries an
    /// index document had to skip, a payload too large to read whole.
    #[serde(default)]
    pub problems: Vec<String>,
}

/// What the frontend asks the hub for.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubQuery {
    /// Free text, matched by the source (the MCP registry searches server side) or by Ahabby.
    #[serde(default)]
    pub query: String,
    /// Restrict to one kind of resource.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub kind: Option<HubResourceKind>,
    /// Cursor returned by the previous page of the same source.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    /// Entries per source. Clamped to [`MIN_LIMIT`]..[`MAX_LIMIT`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Ignore the cache and fetch again — the "refresh" button.
    #[serde(default)]
    pub refresh: bool,
}

/// Bounds of one page of one source.
pub const MIN_LIMIT: u32 = 4;
pub const MAX_LIMIT: u32 = 100;
/// Page size used when the request does not say.
pub const DEFAULT_LIMIT: u32 = 24;

impl HubQuery {
    /// The page size to use, clamped to something a source and a screen can both live with.
    pub fn page_size(&self) -> u32 {
        self.limit
            .unwrap_or(DEFAULT_LIMIT)
            .clamp(MIN_LIMIT, MAX_LIMIT)
    }
}

/// What the user reviewed and confirmed in the install dialog.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubInstallRequest {
    /// Any owner the scan knows: an agent id, `shared`, or `project:<hash>`.
    pub owner_id: String,
    pub entry_id: String,
    /// Name to write it under; the entry's own name when omitted.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// The launch recipe as reviewed (and possibly edited) in the form; the entry's own recipe is
    /// used when omitted. Ignored for a skill.
    ///
    /// It carries the environment variables or headers the user filled in, which is why the form
    /// sends a whole recipe back instead of only the values: what is written is what was reviewed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub transport: Option<super::mcp::McpDraftTransport>,
    /// `true` only after the dialog listed what will be written. The backend refuses the write
    /// otherwise, so a UI that skips its review cannot put foreign files on disk.
    #[serde(default)]
    pub confirm: bool,
}

/// What an install wrote.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct HubInstall {
    pub kind: HubResourceKind,
    pub entry_id: String,
    /// The owner the resource was written for.
    pub owner: AgentRef,
    /// Skill directory, or the config file the server was added to.
    pub path: String,
    /// How many files were written (skills).
    #[ts(type = "number")]
    pub files_written: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skill: Option<Skill>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub server: Option<McpServer>,
}

/// `owner/repo`, with both halves plain enough to be a URL path segment.
///
/// A source's repository becomes part of a `codeload.github.com` URL and an index entry's skill
/// does the same, so this is the one place the rule lives: neither of them may reach outside the
/// two-segment shape, whatever a hand-written file or a published document says.
pub fn plain_repository(repository: &str) -> bool {
    let mut parts = repository.trim().split('/');
    let (Some(owner), Some(repo), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    [owner, repo].iter().all(|part| {
        !part.is_empty()
            && *part != "."
            && *part != ".."
            && part
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
    })
}

/// A branch, tag or commit: it is pasted into a URL, so nothing that could redirect it.
pub fn plain_git_ref(git_ref: &str) -> bool {
    !git_ref.is_empty()
        && git_ref.len() <= 200
        && !git_ref.contains("..")
        && !git_ref
            .chars()
            .any(|c| c.is_whitespace() || matches!(c, '?' | '#' | '%' | '\\' | ':'))
}

/// A `/`-separated path that can only ever resolve inside the directory it is joined to.
///
/// Used for the paths a source declares (a repository subdirectory) and for the paths a payload
/// carries (the files of a skill): both end up joined to a real directory, so neither may be
/// absolute, step up with `..`, or carry a Windows drive or a backslash.
pub fn plain_relative_path(path: &str) -> bool {
    let trimmed = path.trim();
    !trimmed.is_empty()
        && !trimmed.starts_with('/')
        && !trimmed.contains('\\')
        && !trimmed.contains(':')
        && trimmed
            .split('/')
            .all(|segment| !segment.is_empty() && segment != "." && segment != "..")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_page_size_is_always_within_bounds() {
        let query = |limit| HubQuery {
            limit,
            ..HubQuery::default()
        };
        assert_eq!(query(None).page_size(), DEFAULT_LIMIT);
        assert_eq!(query(Some(0)).page_size(), MIN_LIMIT);
        assert_eq!(query(Some(1_000)).page_size(), MAX_LIMIT);
        assert_eq!(query(Some(40)).page_size(), 40);
    }

    #[test]
    fn only_plain_repositories_refs_and_paths_are_accepted() {
        for repository in ["owner/repo", "a-b/c.d", "x_1/y2"] {
            assert!(plain_repository(repository), "rejected '{repository}'");
        }
        for repository in [
            "owner",
            "owner/repo/extra",
            "own er/repo",
            "../etc/passwd",
            "/etc/passwd",
            "owner/..",
            "",
        ] {
            assert!(!plain_repository(repository), "accepted '{repository}'");
        }

        for git_ref in ["main", "v1.2.3", "feature/x", "a1b2c3d"] {
            assert!(plain_git_ref(git_ref), "rejected '{git_ref}'");
        }
        for git_ref in ["", "main?x=1", "../main", "main ref", "a#b", "a:b"] {
            assert!(!plain_git_ref(git_ref), "accepted '{git_ref}'");
        }

        for path in ["skills/pdf", "a/b/c.md", "SKILL.md"] {
            assert!(plain_relative_path(path), "rejected '{path}'");
        }
        for path in [
            "",
            "/etc",
            "a/../../b",
            "a//b",
            "a\\b",
            "C:/x",
            "./a",
            "a/./b",
        ] {
            assert!(!plain_relative_path(path), "accepted '{path}'");
        }
    }

    #[test]
    fn a_github_ref_defaults_to_main() {
        let mut source = HubSource {
            id: "demo".into(),
            name: "Demo".into(),
            kind: HubSourceKind::GithubSkills,
            description: None,
            provides: vec![HubResourceKind::Skill],
            homepage: None,
            docs: None,
            license: None,
            vendor: None,
            url: None,
            repository: Some("owner/repo".into()),
            git_ref: None,
            path: None,
            exclude: Vec::new(),
            builtin: false,
            source_file: None,
        };
        assert_eq!(source.git_ref(), "main");
        assert!(source.offers(HubResourceKind::Skill));
        assert!(!source.offers(HubResourceKind::Mcp));

        source.git_ref = Some("  ".into());
        assert_eq!(source.git_ref(), "main");
        source.git_ref = Some("v2".into());
        assert_eq!(source.git_ref(), "v2");
    }
}
