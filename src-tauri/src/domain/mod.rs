//! Pure domain models: no I/O, no Tauri, no OS calls.
//!
//! Everything in this module is serializable and mirrored into TypeScript via `ts-rs`,
//! so the frontend and backend can never drift apart silently.

pub mod agent;
pub mod catalog;
pub mod config;
pub mod library;
pub mod manifest;
pub mod mcp;
pub mod os;
pub mod resource;
pub mod scope;
pub mod secrets;
pub mod skill;
pub mod version;

pub use agent::{
    Agent, AgentRef, AgentStatus, Detection, InstallAction, InstallOption, InstallPlan, UpdateInfo,
};
pub use catalog::CatalogProblem;
pub use config::{BackupEntry, ConfigFile, ConfigFormat, ConfigSnapshot, DiffPreview, SaveResult};
pub use library::{Library, LibraryStats};
pub use manifest::{
    AgentManifest, BinarySpec, ConfigSpec, InstallMethodSpec, Manager, ManifestProblem,
    ManifestSource, McpSpec, OsPathMap, OtherKind, OtherSpec, SearchPathSpec, Severity,
    SkillFormat, SkillSpec, VersionExtract,
};
pub use mcp::{EnvVar, McpServer, McpTransport};
pub use os::Os;
pub use resource::OtherResource;
pub use scope::Scope;
pub use skill::{FrontmatterEntry, Skill};
pub use version::Version;
