//! Pure domain models: no I/O, no Tauri, no OS calls.
//!
//! Everything in this module is serializable and mirrored into TypeScript via `ts-rs`,
//! so the frontend and backend can never drift apart silently.

pub mod agent;
pub mod catalog;
pub mod config;
pub mod fact;
pub mod hub;
pub mod library;
pub mod manifest;
pub mod mcp;
pub mod os;
pub mod project;
pub mod proxy;
pub mod resource;
pub mod scope;
pub mod secrets;
pub mod shared;
pub mod skill;
pub mod terminal;
pub mod version;
pub mod web;

pub use agent::{
    Agent, AgentRef, AgentRemoval, AgentStatus, Detection, HiddenAgent, InstallAction,
    InstallOption, InstallPlan, RemovalKind, RemovalMode, UpdateInfo,
};
pub use catalog::CatalogProblem;
pub use config::{BackupEntry, ConfigFile, ConfigFormat, ConfigSnapshot, DiffPreview, SaveResult};
pub use fact::{ConfigFact, FactKind};
pub use hub::{
    normalize_tags, plain_git_ref, plain_relative_path, plain_repository, tag_rule_matches,
    tags_match, HubEntry, HubEntryDetail, HubEntryInstall, HubFileInfo, HubFileKind, HubInput,
    HubInstall, HubInstallRequest, HubPage, HubPreview, HubQuery, HubResourceKind, HubSource,
    HubSourceCatalog, HubSourceKind, HubSourceReport, HubTagRule, MAX_TAGS, MAX_TAG_LEN,
};
pub use library::{Library, LibraryStats};
pub use manifest::{
    AgentManifest, BinarySpec, ConfigSpec, InstallMethodSpec, Manager, ManifestProblem,
    ManifestSource, McpEntryShape, McpSpec, OsPathMap, OtherKind, OtherSpec, SearchPathSpec,
    Severity, SkillFormat, SkillSpec, VersionExtract,
};
pub use mcp::{EnvVar, McpDraftTransport, McpKeyValue, McpServer, McpServerDraft, McpTransport};
pub use os::Os;
pub use project::{
    is_project_owner, project_owner_id, project_owner_ref, Project, ProjectFolder,
    ProjectFolderStatus, ProjectScan, PROJECT_OWNER_PREFIX, PROJECT_SURFACE_ID,
};
pub use proxy::{Proxy, ProxyMode};
pub use resource::OtherResource;
pub use scope::Scope;
pub use shared::{SharedResources, SHARED_OWNER_ID};
pub use skill::{FrontmatterEntry, Skill, SkillDraft, SkillInstall, SkillInstallFile};
pub use terminal::{
    TerminalCapability, TerminalCatalog, TerminalExit, TerminalKind, TerminalOption,
    TerminalOutput, TerminalSession,
};
pub use version::Version;
pub use web::{WebImage, WebPage, WebPageKind};

/// Default for a `bool` field added after a report was cached.
///
/// The last scan is cached on disk to make the first paint instant, so a report written by an
/// older version has no value for such a field; the honest reading of a missing one is "nothing
/// was switched off" rather than "everything is off".
pub(crate) fn default_true() -> bool {
    true
}
