//! Cloud sync: what Ahabby can put into the user's cloud, where it lands, and how it comes back.
//!
//! Everything here is a pure model — no I/O, no Tauri — so the same shapes cross the IPC
//! boundary (`ts-rs`) and describe the document the provider stores. The one document format is
//! owned by [`SyncPayload`], and the provider only ever sees it as bytes plus a marker file.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a remote copy lives. Only GitHub Gist is implemented; the enum is what makes a second
/// backend one variant plus one provider file instead of a rewrite.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum SyncProviderId {
    #[default]
    Gist,
}

impl SyncProviderId {
    pub const fn label(self) -> &'static str {
        match self {
            SyncProviderId::Gist => "GitHub Gist",
        }
    }
}

/// Whether Ahabby uploads on its own.
///
/// Uploading is the only thing this governs: *restoring* is always manual, because a cloud copy
/// may never overwrite the machine without the user asking for that one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum SyncMode {
    /// Nothing leaves the machine until the user presses Save.
    #[default]
    Manual,
    /// Key files are uploaded after a scan and on a timer.
    Automatic,
}

/// What one synced thing is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SyncKind {
    /// A config file an agent manifest declares (JSON/JSONC/TOML/YAML).
    Config,
    /// A `.env`-style file: part of the same surface, but its own kind because it holds secrets.
    Env,
    /// A skill directory, `SKILL.md` included.
    Skill,
    /// The MCP config file an entry lives in — the *file*, because an entry alone has no address
    /// to write back to.
    Mcp,
    Instruction,
    Command,
    Subagent,
    Hook,
    Rule,
    Prompt,
    Memory,
    /// Anything else the manifest declares as a document.
    Other,
    /// A local extension module (its entry file). A package is owned by the agent's own CLI and
    /// is deliberately never synced.
    Extension,
}

impl SyncKind {
    /// Every kind, in the order the pickers show them. The one place that has to grow when a
    /// variant is added — the automatic default set is derived from it.
    pub const ALL: [SyncKind; 13] = [
        SyncKind::Config,
        SyncKind::Env,
        SyncKind::Skill,
        SyncKind::Mcp,
        SyncKind::Instruction,
        SyncKind::Command,
        SyncKind::Subagent,
        SyncKind::Hook,
        SyncKind::Rule,
        SyncKind::Prompt,
        SyncKind::Memory,
        SyncKind::Other,
        SyncKind::Extension,
    ];

    /// The kinds Ahabby actually puts in the cloud: the files an agent page shows — a config file
    /// (its `.env` included), a skill and an MCP config file. Everything *else* a manifest declares
    /// (instructions, commands, hooks, rules, prompts, memory, other documents) and a local
    /// extension stay on this machine, so a cloud account holds one machine's working set and
    /// nothing beside it. The rest of the enum survives for reading a document written by an older
    /// schema.
    pub const SYNCABLE: [SyncKind; 4] = [
        SyncKind::Config,
        SyncKind::Env,
        SyncKind::Skill,
        SyncKind::Mcp,
    ];

    /// Stable machine id: the marker file, the description prefix and the frontend all use it.
    pub const fn name(self) -> &'static str {
        match self {
            SyncKind::Config => "config",
            SyncKind::Env => "env",
            SyncKind::Skill => "skill",
            SyncKind::Mcp => "mcp",
            SyncKind::Instruction => "instruction",
            SyncKind::Command => "command",
            SyncKind::Subagent => "subagent",
            SyncKind::Hook => "hook",
            SyncKind::Rule => "rule",
            SyncKind::Prompt => "prompt",
            SyncKind::Memory => "memory",
            SyncKind::Other => "other",
            SyncKind::Extension => "extension",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|kind| kind.name() == name)
    }
}

/// Which addressable surface an item belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SyncOwnerKind {
    Agent,
    Shared,
    Project,
}

impl SyncOwnerKind {
    pub const fn name(self) -> &'static str {
        match self {
            SyncOwnerKind::Agent => "agent",
            SyncOwnerKind::Shared => "shared",
            SyncOwnerKind::Project => "project",
        }
    }

    pub fn from_name(name: &str) -> Option<Self> {
        match name {
            "agent" => Some(SyncOwnerKind::Agent),
            "shared" => Some(SyncOwnerKind::Shared),
            "project" => Some(SyncOwnerKind::Project),
            _ => None,
        }
    }
}

/// Where a local copy stands relative to the cloud.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum SyncItemStatus {
    /// Never uploaded (or the cloud copy was deleted).
    #[default]
    Unsynced,
    /// The local content is what was last uploaded.
    Synced,
    /// Uploaded once, changed since.
    Modified,
    /// Recorded as uploaded, but the file is gone from disk.
    Missing,
}

/// One addressable thing of one owner — what the UI lists and what a push or a pull addresses.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncItem {
    /// Local, path-derived id (`<key>#<hash of the absolute path>`). What a command is addressed
    /// by, so two files with the same basename stay distinct on *this* machine.
    pub id: String,
    /// Machine-independent identity inside the owner: `<kind>|<basename>`. What matches a local
    /// item to a remote one across machines.
    pub key: String,
    pub owner_id: String,
    pub owner_name: String,
    pub owner_kind: SyncOwnerKind,
    pub kind: SyncKind,
    pub name: String,
    pub label: String,
    pub path: String,
    /// Where the item sits, as the owner describes it (`SKILL.md`, `.claude/settings.json`).
    pub relative_path: String,
    pub is_directory: bool,
    pub files: usize,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub editable: bool,
    pub exists: bool,
    /// `true` when the scan found secret-looking values in it (or it is a `.env` file).
    pub has_secrets: bool,
    pub status: SyncItemStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_uri: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub synced_at_ms: Option<i64>,
}

impl Default for SyncItem {
    fn default() -> Self {
        Self {
            id: String::new(),
            key: String::new(),
            owner_id: String::new(),
            owner_name: String::new(),
            owner_kind: SyncOwnerKind::Agent,
            kind: SyncKind::Config,
            name: String::new(),
            label: String::new(),
            path: String::new(),
            relative_path: String::new(),
            is_directory: false,
            files: 0,
            size_bytes: 0,
            editable: true,
            exists: false,
            has_secrets: false,
            status: SyncItemStatus::Unsynced,
            remote_id: None,
            remote_uri: None,
            synced_at_ms: None,
        }
    }
}

/// The cloud's own record of one pushed item.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct RemoteItem {
    /// Provider id of the remote copy (a gist id).
    pub remote_id: String,
    pub key: String,
    pub owner_id: String,
    pub owner_name: String,
    pub owner_kind: SyncOwnerKind,
    pub kind: SyncKind,
    pub name: String,
    pub label: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub files: usize,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub hash: String,
    pub description: String,
    pub uri: String,
    #[ts(type = "number")]
    pub updated_at_ms: i64,
    /// `true` when the payload declared secret-looking content (recorded at push time).
    pub has_secrets: bool,
}

impl Default for RemoteItem {
    fn default() -> Self {
        Self {
            remote_id: String::new(),
            key: String::new(),
            owner_id: String::new(),
            owner_name: String::new(),
            owner_kind: SyncOwnerKind::Agent,
            kind: SyncKind::Config,
            name: String::new(),
            label: String::new(),
            relative_path: String::new(),
            is_directory: false,
            files: 0,
            size_bytes: 0,
            hash: String::new(),
            description: String::new(),
            uri: String::new(),
            updated_at_ms: 0,
            has_secrets: false,
        }
    }
}

/// Who the connected account is.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncAccount {
    pub provider: SyncProviderId,
    pub login: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub avatar: Option<String>,
    /// Number of sync gists this account holds, as the last listing saw it.
    #[ts(type = "number")]
    pub gists: usize,
}

/// Everything the Sync screen needs about the connection and the last runs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncStatus {
    pub provider: SyncProviderId,
    pub enabled: bool,
    pub mode: SyncMode,
    pub connected: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub token_hint: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub account: Option<SyncAccount>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub last_push_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub last_pull_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    /// `true` while a run (manual or automatic) is in flight.
    pub running: bool,
}

/// The user's own sync configuration. Non-secret by construction: the token lives in its own
/// file and never enters the settings document (which the frontend reads and writes whole).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncSettings {
    /// Master switch. Off means no automatic run and no upload of anything, even by hand.
    pub enabled: bool,
    pub provider: SyncProviderId,
    pub mode: SyncMode,
    /// Minutes between two automatic runs. Clamped to [`SyncSettings::MIN_INTERVAL`] ..
    /// [`SyncSettings::MAX_INTERVAL`].
    pub auto_interval_minutes: u32,
    /// Kinds automatic saving covers.
    pub auto_kinds: Vec<SyncKind>,
    /// Owner ids automatic saving covers. Empty = every installed owner.
    pub auto_owners: Vec<String>,
    /// Whether an automatic run happens right after a scan, instead of waiting for the timer.
    pub auto_on_scan: bool,
    /// Whether secret-bearing items may be uploaded at all. Off by default: a secret gist is
    /// unlisted, not private.
    pub include_secrets: bool,
    /// Glob patterns (against the item's relative path) that are never uploaded.
    pub exclude_patterns: Vec<String>,
    /// Largest item, in bytes, that may be uploaded. Larger items are reported as skipped.
    #[ts(type = "number")]
    pub max_file_bytes: u64,
}

impl SyncSettings {
    pub const MIN_INTERVAL: u32 = 5;
    pub const MAX_INTERVAL: u32 = 1440;
    /// 512 KiB. The gist API rejects very large files, and this is far above a config or a skill.
    pub const DEFAULT_MAX_BYTES: u64 = 512 * 1024;
    pub const MAX_MAX_BYTES: u64 = 5 * 1024 * 1024;
}

impl Default for SyncSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            provider: SyncProviderId::Gist,
            mode: SyncMode::Manual,
            auto_interval_minutes: 30,
            // Exactly the kinds the cloud accepts — a config, a `.env`, a skill, an MCP file.
            auto_kinds: SyncKind::SYNCABLE.to_vec(),
            auto_owners: Vec::new(),
            auto_on_scan: true,
            include_secrets: false,
            exclude_patterns: Vec::new(),
            max_file_bytes: Self::DEFAULT_MAX_BYTES,
        }
    }
}

/// Address of one local item, as a command receives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncItemRef {
    pub owner_id: String,
    pub item_id: String,
}

/// What to restore, and where: one cloud copy and the owner that should receive it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncPullTarget {
    pub remote_id: String,
    pub owner_id: String,
}

/// What a pull would do to one file.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SyncFileAction {
    /// The file is not on disk yet.
    Add,
    /// It exists and differs.
    Replace,
    /// It exists and is byte-identical.
    Same,
    /// It cannot be written (no destination, a read-only document, too large).
    Blocked,
}

/// One file of a pull preview.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncPreviewFile {
    pub path: String,
    pub action: SyncFileAction,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub binary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unified: Option<String>,
}

/// What restoring one remote item would do, before anything is written.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncPreview {
    pub remote_id: String,
    pub owner_id: String,
    pub owner_name: String,
    pub kind: SyncKind,
    pub name: String,
    pub label: String,
    /// Absolute path a file lands on, or the directory a skill is created in.
    pub destination: String,
    pub is_directory: bool,
    pub can_apply: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blocked_reason: Option<String>,
    pub files: Vec<SyncPreviewFile>,
    pub remote_hash: String,
}

/// Which side of an item a reader is looking at.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SyncContentSide {
    /// The file (or the skill directory) on this machine.
    Local,
    /// The copy the cloud holds.
    Remote,
}

/// One file of an item, as a reader shows it.
///
/// The text is what the viewer renders; a binary file carries none and is reported by its size
/// alone, so a skill's asset never arrives as half a megabyte of base64 nobody can read. The
/// hash is over the *whole* file, which is what lets two binaries be compared at all.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncFileContent {
    /// `/`-separated path inside the item (`SKILL.md`, `scripts/render.py`).
    pub path: String,
    /// The text, when the file is text and inside the viewer's limit.
    pub text: Option<String>,
    #[ts(type = "number")]
    pub size_bytes: u64,
    pub binary: bool,
    /// `true` when the file is larger than the viewer reads — `text` is its beginning.
    pub truncated: bool,
    /// `sha256:<hex>` of the whole file, cut or not.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
}

/// One side of an item, read for viewing and comparing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncContent {
    pub side: SyncContentSide,
    pub key: String,
    pub name: String,
    pub label: String,
    pub owner_id: String,
    pub owner_name: String,
    pub kind: SyncKind,
    pub is_directory: bool,
    /// `false` for a declared file that does not exist on this machine (or a copy that is gone).
    pub exists: bool,
    pub files: Vec<SyncFileContent>,
    /// Content hash of the whole item, when the reader knows one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hash: Option<String>,
    /// Id of the cloud copy this side belongs to, when there is one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub uri: Option<String>,
    /// When this side was last written: the file's own timestamp, or the copy's `updatedAt`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub modified_ms: Option<i64>,
}

impl Default for SyncContent {
    fn default() -> Self {
        Self {
            side: SyncContentSide::Local,
            key: String::new(),
            name: String::new(),
            label: String::new(),
            owner_id: String::new(),
            owner_name: String::new(),
            kind: SyncKind::Config,
            is_directory: false,
            exists: false,
            files: Vec::new(),
            hash: None,
            remote_id: None,
            uri: None,
            modified_ms: None,
        }
    }
}

/// How one file of an item stands between this machine and the cloud.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SyncFileStatus {
    /// Present on both sides, byte for byte.
    Same,
    /// Present on both sides, different.
    Changed,
    /// Present here only.
    LocalOnly,
    /// Present in the cloud only.
    CloudOnly,
    /// Present on both sides, but with nothing a reader could diff or compare.
    Binary,
}

/// One file of a comparison, with the two texts a diff is built from.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncComparedFile {
    pub path: String,
    pub status: SyncFileStatus,
    pub binary: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub local_size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub cloud_size_bytes: Option<u64>,
    /// The local text, for the diff. `None` when the file is not here or is not text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub left: Option<String>,
    /// The cloud text, for the diff. `None` when the copy has no such file or it is not text.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub right: Option<String>,
    /// `true` when either side was read only in part, so the diff is not the whole story.
    pub truncated: bool,
}

impl Default for SyncComparedFile {
    fn default() -> Self {
        Self {
            path: String::new(),
            status: SyncFileStatus::Same,
            binary: false,
            local_size_bytes: None,
            cloud_size_bytes: None,
            left: None,
            right: None,
            truncated: false,
        }
    }
}

/// One item against its cloud copy — what the compare dialog renders.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", default)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncComparison {
    pub key: String,
    pub name: String,
    pub label: String,
    pub kind: SyncKind,
    pub owner_id: String,
    pub owner_name: String,
    pub local: SyncContent,
    pub cloud: SyncContent,
    pub files: Vec<SyncComparedFile>,
    /// Files that differ, are only on one side, or are binary — everything but `Same`.
    pub changed: usize,
    /// `true` when every file is byte-identical on both sides.
    pub identical: bool,
}

impl Default for SyncComparison {
    fn default() -> Self {
        Self {
            key: String::new(),
            name: String::new(),
            label: String::new(),
            kind: SyncKind::Config,
            owner_id: String::new(),
            owner_name: String::new(),
            local: SyncContent::default(),
            cloud: SyncContent::default(),
            files: Vec::new(),
            changed: 0,
            identical: true,
        }
    }
}

/// Outcome of one item inside a run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncItemResult {
    pub name: String,
    pub owner_id: String,
    pub kind: SyncKind,
    pub ok: bool,
    pub skipped: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,
}

/// What a push, a pull, a delete or an automatic run did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SyncRunKind {
    Push,
    Pull,
    Delete,
    Automatic,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncRun {
    pub kind: SyncRunKind,
    pub uploaded: usize,
    pub downloaded: usize,
    pub deleted: usize,
    pub skipped: usize,
    pub failed: usize,
    pub results: Vec<SyncItemResult>,
    #[ts(type = "number")]
    pub at_ms: i64,
}

/// What the `sync://done` event carries: the run, or the error that stopped it before it began.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncEvent {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub run: Option<SyncRun>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

/// The local half of the Sync library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncItemList {
    pub items: Vec<SyncItem>,
    /// Items the user has not uploaded yet.
    pub unsynced: usize,
    /// Items whose local content changed since the last upload.
    pub modified: usize,
    /// Items that were uploaded but are no longer on disk.
    pub missing: usize,
}

/// The cloud half of the Sync library.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct RemoteList {
    pub items: Vec<RemoteItem>,
    #[ts(type = "number")]
    pub fetched_at_ms: i64,
    pub from_cache: bool,
}

/// One file inside a [`SyncPayload`]: text as it is, anything else base64.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncPayloadFile {
    /// `/`-separated path inside the item (`SKILL.md`, `scripts/render.py`).
    pub path: String,
    /// `utf8` or `base64`.
    pub encoding: String,
    pub content: String,
}

/// The document a provider stores: the item's metadata and its bytes, together.
///
/// Keeping them in one file is what makes a remote copy self-describing — listing needs no
/// second request, and restoring needs nothing but the file itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SyncPayload {
    pub schema: u32,
    pub app: String,
    pub kind: SyncKind,
    pub key: String,
    pub owner_kind: SyncOwnerKind,
    pub owner_id: String,
    pub owner_name: String,
    pub name: String,
    pub label: String,
    pub relative_path: String,
    pub is_directory: bool,
    pub files: Vec<SyncPayloadFile>,
    pub hash: String,
    #[ts(type = "number")]
    pub pushed_at_ms: i64,
    pub source_path: String,
    pub app_version: String,
    pub os: String,
    /// `true` when the payload deliberately carries secret-looking values.
    pub has_secrets: bool,
}

/// The schema version of [`SyncPayload`]. A reader refuses a document from a newer schema.
pub const SYNC_SCHEMA: u32 = 1;

/// The one file a gist holds.
pub const SYNC_MARKER_FILE: &str = "ahabby.json";

/// Prefix of a gist description Ahabby owns.
pub const SYNC_DESCRIPTION_PREFIX: &str = "[Ahabby] ";

#[cfg(test)]
mod tests {
    use super::*;
    // The reader of the document a provider stores: what a push writes and a pull reads.
    use crate::services::sync::plan::{decode_file, decode_marker, payload_file};

    #[test]
    fn every_kind_round_trips_through_its_name() {
        for kind in SyncKind::ALL {
            assert_eq!(SyncKind::from_name(kind.name()), Some(kind));
        }
        assert_eq!(SyncKind::from_name("nope"), None);
    }

    #[test]
    fn default_settings_cover_only_the_syncable_kinds_and_no_secrets() {
        let settings = SyncSettings::default();
        assert!(!settings.include_secrets);
        assert!(!settings.enabled);
        // A scan is the moment the local set changes, so saving right after one is the default.
        assert!(settings.auto_on_scan);
        assert_eq!(settings.auto_kinds, SyncKind::SYNCABLE.to_vec());
        assert!(!settings.auto_kinds.contains(&SyncKind::Extension));
        assert!(settings.auto_kinds.contains(&SyncKind::Skill));
    }

    #[test]
    fn owner_kind_names_round_trip() {
        for kind in [
            SyncOwnerKind::Agent,
            SyncOwnerKind::Shared,
            SyncOwnerKind::Project,
        ] {
            assert_eq!(SyncOwnerKind::from_name(kind.name()), Some(kind));
        }
        // A document naming a surface this build does not have is refused, never folded into one.
        assert_eq!(SyncOwnerKind::from_name("workspace"), None);
    }

    #[test]
    fn a_provider_id_is_the_wire_id_the_document_declares() {
        // Gist is the only variant; the match in `label` is exhaustive, so a second backend
        // cannot be added without giving it one.
        assert_eq!(SyncProviderId::default(), SyncProviderId::Gist);
        assert_eq!(SyncProviderId::Gist.label(), "GitHub Gist");
        // The id a settings document and a payload carry is the lowercase name, not the label.
        assert_eq!(
            serde_json::to_string(&SyncProviderId::Gist).unwrap(),
            "\"gist\""
        );
        assert_eq!(
            serde_json::from_str::<SyncProviderId>("\"gist\"").unwrap(),
            SyncProviderId::Gist
        );

        // A document naming a provider this build does not implement is refused, never read as
        // the one backend that exists: pushing to the wrong account is worse than not pushing.
        assert!(serde_json::from_str::<SyncProviderId>("\"gitlab\"").is_err());
        let error =
            serde_json::from_value::<SyncSettings>(serde_json::json!({ "provider": "gitlab" }))
                .unwrap_err();
        assert!(error.to_string().contains("gitlab"));

        // Absent, by contrast, is the documented default: a settings file written before sync
        // existed still loads, with the only backend selected.
        let old = serde_json::from_value::<SyncSettings>(serde_json::json!({})).unwrap();
        assert_eq!(old.provider, SyncProviderId::Gist);
    }

    #[test]
    fn an_untouched_item_and_an_unread_file_claim_nothing() {
        // What the UI lists before anything was pushed: no remote copy, nothing on disk and no
        // secret flag the scan has not set — the three things that gate a push.
        let item = SyncItem::default();
        assert_eq!(item.status, SyncItemStatus::Unsynced);
        assert!(item.editable);
        assert!(!item.exists);
        assert!(!item.has_secrets);
        assert!(item.remote_id.is_none());
        assert!(item.synced_at_ms.is_none());
        assert_eq!(item.size_bytes, 0);
        assert_eq!(item.owner_kind, SyncOwnerKind::Agent);
        assert_eq!(item.kind, SyncKind::Config);

        // The record of a cloud copy: a listing that never read a size or a secret must not show
        // one, and an empty hash must not be mistaken for the hash of an empty item.
        let remote = RemoteItem::default();
        assert!(!remote.has_secrets);
        assert_eq!(remote.size_bytes, 0);
        assert!(remote.hash.is_empty());
        assert_eq!(remote.updated_at_ms, 0);

        // A file nobody read carries no text and no hash: the viewer must not render an empty
        // file, and a compare must not treat two unread files as identical.
        let content = SyncFileContent::default();
        assert!(content.text.is_none());
        assert!(content.hash.is_none());
        assert!(!content.binary);
        assert!(!content.truncated);
        assert_eq!(content.size_bytes, 0);
    }

    #[test]
    fn a_comparison_that_was_never_run_reports_nothing_changed() {
        // `Same` is the one status that does not mark an item as changed, so a row that was never
        // diffed must not claim a difference the user would be offered to restore over.
        let file = SyncComparedFile::default();
        assert_eq!(file.status, SyncFileStatus::Same);
        assert!(!file.binary);
        assert!(file.left.is_none() && file.right.is_none());
        assert!(file.local_size_bytes.is_none() && file.cloud_size_bytes.is_none());
        assert!(!file.truncated);

        let comparison = SyncComparison::default();
        assert!(comparison.identical);
        assert_eq!(comparison.changed, 0);
        assert!(comparison.files.is_empty());
        assert_eq!(comparison.kind, SyncKind::Config);
        // Neither side has been read yet, and both start from the same neutral empty content.
        assert_eq!(comparison.local, SyncContent::default());
        assert_eq!(comparison.cloud, SyncContent::default());
    }

    /// The one document a provider stores, with one text file and one binary file.
    fn sample_payload() -> SyncPayload {
        SyncPayload {
            schema: SYNC_SCHEMA,
            app: "ahabby".to_string(),
            kind: SyncKind::Skill,
            key: "skill|pdf".to_string(),
            owner_kind: SyncOwnerKind::Agent,
            owner_id: "claude-code".to_string(),
            owner_name: "Claude Code".to_string(),
            name: "pdf".to_string(),
            label: "PDF".to_string(),
            relative_path: ".claude/skills/pdf".to_string(),
            is_directory: true,
            files: vec![
                payload_file("SKILL.md", b"# PDF\n"),
                // Not valid UTF-8, so the codec has to store it base64.
                payload_file("assets/logo.png", &[0x00, 0x9F, 0x92, 0x96, 0xFF]),
            ],
            hash: "sha256:0f1e2d".to_string(),
            pushed_at_ms: 1_700_000_000_000,
            source_path: "/home/u/.claude/skills/pdf".to_string(),
            app_version: "0.2.0".to_string(),
            os: "windows".to_string(),
            has_secrets: false,
        }
    }

    #[test]
    fn the_stored_document_keeps_its_metadata_and_its_binary_files() {
        let payload = sample_payload();
        assert_eq!(payload.files[0].encoding, "utf8");
        assert_eq!(payload.files[1].encoding, "base64");

        // The provider only ever hands the document over as JSON, so this round trip is the
        // contract between a push on one machine and a pull on another.
        let json = serde_json::to_string(&payload).unwrap();
        let parsed: SyncPayload = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed, payload);
        // The metadata a listing and a restore read, still there and still in camelCase.
        assert_eq!(parsed.schema, SYNC_SCHEMA);
        assert_eq!(parsed.owner_kind, SyncOwnerKind::Agent);
        assert_eq!(parsed.owner_id, "claude-code");
        assert_eq!(parsed.key, "skill|pdf");
        assert_eq!(parsed.pushed_at_ms, 1_700_000_000_000);
        assert!(!parsed.has_secrets);
        assert_eq!(
            serde_json::to_value(&parsed).unwrap()["pushedAtMs"],
            serde_json::json!(1_700_000_000_000i64)
        );
        // A binary file comes back as the bytes it was: base64 is only its carrier.
        assert_eq!(
            decode_file(&parsed.files[1]).unwrap(),
            vec![0x00, 0x9F, 0x92, 0x96, 0xFF]
        );

        // SYNC_SCHEMA is the version a reader compares against: this document is accepted, and
        // the same one with a bumped schema is refused, so a newer writer is never read as this
        // one — a mis-read restore would overwrite files this build cannot describe.
        let document = serde_json::to_value(&payload).unwrap();
        assert_eq!(decode_marker(&document).unwrap(), payload);
        let mut newer = document;
        newer["schema"] = serde_json::json!(SYNC_SCHEMA + 1);
        assert!(decode_marker(&newer).is_err());
    }
}
