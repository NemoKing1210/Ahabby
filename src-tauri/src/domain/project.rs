//! Project-scoped resources: the folders the user adds and what Ahabby finds inside them.
//!
//! A *project* is a directory the user works in — a repository, a workspace, a package. The
//! resources of a project (skills, MCP servers, instructions, rules, sub-agents, commands) are
//! the same entities the global scan produces, only rooted at that directory instead of the
//! user's home: they carry [`Scope::Project`](super::scope::Scope::Project) so every reader can
//! tell the two apart, and they are addressed through an owner id with the
//! [`PROJECT_OWNER_PREFIX`]. That is what lets the whole editing surface (read, preview, save,
//! create, switch off, delete) work on a project document without a second implementation.

use std::path::Path;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::config::ConfigFile;
use super::mcp::McpServer;
use super::resource::OtherResource;
use super::skill::{short_hash, Skill};

/// Prefix of the synthetic owner id of one project (`project:<hash>`).
///
/// Agent ids are restricted to lowercase letters, digits, `-` and `_` by manifest validation,
/// so this can never collide with a real agent — the same reasoning that makes the shared
/// surface's reserved `shared` id safe.
pub const PROJECT_OWNER_PREFIX: &str = "project:";

/// Id of the built-in project surface manifest (`catalog/project.toml`), reserved like
/// `shared`: a user manifest may not claim it.
pub const PROJECT_SURFACE_ID: &str = "project";

/// `true` when the owner id names a project rather than an agent or the shared surface.
pub fn is_project_owner(id: &str) -> bool {
    id.starts_with(PROJECT_OWNER_PREFIX)
}

/// Owner id of the project rooted at a normalized path. Stable across scans and restarts, so
/// a bookmarked project page keeps working.
pub fn project_owner_id(normalized_root: &str) -> String {
    format!("{PROJECT_OWNER_PREFIX}{}", short_hash(normalized_root))
}

/// The owner reference of the project rooted at `root`.
///
/// It is what every resource of that project reports as its owner, so anything the UI shows a
/// project's resource with (a card tag, a detail dialog) names the project and not the surface
/// manifest the project is read through.
pub fn project_owner_ref(root: &Path) -> AgentRef {
    AgentRef {
        id: project_owner_id(&ProjectFolder::normalize(&root.to_string_lossy())),
        name: display_name(root),
        icon: None,
    }
}

/// The name shown for a project: the directory's own name.
pub fn display_name(root: &Path) -> String {
    root.file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| root.to_string_lossy().to_string())
}

/// One folder the user added to Ahabby. Stored in the settings file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ProjectFolder {
    /// Stable id derived from the normalized path, so adding the same folder twice is caught.
    pub id: String,
    /// The folder as the user entered it.
    pub path: String,
    #[ts(type = "number")]
    pub added_at_ms: i64,
}

impl ProjectFolder {
    /// The comparison form of a folder path: one separator, no trailing one, and lowercase on
    /// Windows (where two spellings of the same path are the same folder). It is what the id is
    /// derived from, so the same folder is the same entry whichever way the user typed it.
    pub fn normalize(path: &str) -> String {
        let unified = path.trim().trim_end_matches(['/', '\\']).replace('\\', "/");
        if cfg!(windows) {
            unified.to_lowercase()
        } else {
            unified
        }
    }

    pub fn id_for(path: &str) -> String {
        format!("folder-{}", short_hash(&Self::normalize(path)))
    }
}

/// What one added folder turned out to be on this machine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ProjectFolderStatus {
    pub folder: ProjectFolder,
    /// Canonical path, when the directory could be resolved.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub resolved: Option<String>,
    /// `false` for a folder that has been moved or deleted: it is kept in Settings (the user
    /// may be on a machine where a drive is not mounted) and reported as missing.
    pub exists: bool,
    /// Why this folder contributed nothing, when something went wrong.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub problem: Option<String>,
}

/// One project discovered under an added folder.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Project {
    /// Owner id (`project:<hash>`) every resource of this project points at.
    pub id: String,
    /// Display name: the directory's own name.
    pub name: String,
    pub root: String,
    /// The added folder this project was discovered under.
    pub folder_id: String,
    #[serde(default)]
    pub skills: Vec<Skill>,
    #[serde(default)]
    pub mcp_servers: Vec<McpServer>,
    #[serde(default)]
    pub other: Vec<OtherResource>,
    /// Project files Ahabby may address in the editor (`AGENTS.md`, `.mcp.json`, settings…).
    #[serde(default)]
    pub configs: Vec<ConfigFile>,
    /// Newest modification time among the resources found, when the platform reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub modified_ms: Option<i64>,
    /// Non-fatal problems collected while reading this project.
    #[serde(default)]
    pub warnings: Vec<String>,
    #[ts(type = "number")]
    pub scan_ms: u64,
}

impl Project {
    /// The synthetic owner reference of this project. It is what a skill, an MCP server or a
    /// document reports as its owner, so every surface that names an owner keeps working.
    pub fn owner(&self) -> AgentRef {
        project_owner_ref(Path::new(&self.root))
    }

    /// Number of resources found in this project.
    pub fn resource_count(&self) -> usize {
        self.skills.len() + self.mcp_servers.len() + self.other.len()
    }
}

/// The whole project surface: the added folders and the projects found inside them.
#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ProjectScan {
    pub folders: Vec<ProjectFolderStatus>,
    pub projects: Vec<Project>,
    #[ts(type = "number")]
    pub scanned_at_ms: i64,
    #[ts(type = "number")]
    pub duration_ms: u64,
}

impl ProjectScan {
    pub fn project(&self, id: &str) -> Option<&Project> {
        self.projects.iter().find(|project| project.id == id)
    }

    /// Projects discovered under one added folder.
    pub fn of_folder<'a>(&'a self, folder_id: &'a str) -> impl Iterator<Item = &'a Project> + 'a {
        self.projects
            .iter()
            .filter(move |project| project.folder_id == folder_id)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn owner_ids_are_stable_and_cannot_collide_with_an_agent() {
        let id = project_owner_id("/home/u/code/app");
        assert_eq!(id, project_owner_id("/home/u/code/app"));
        assert_ne!(id, project_owner_id("/home/u/code/other"));
        assert!(is_project_owner(&id));
        // Agent ids are lowercase letters, digits, '-' and '_' only.
        assert!(!is_project_owner("claude-code"));
        assert!(!is_project_owner(crate::domain::SHARED_OWNER_ID));
    }

    #[test]
    fn folder_ids_follow_the_normalized_path() {
        assert_eq!(
            ProjectFolder::id_for("/home/u/code"),
            ProjectFolder::id_for("/home/u/code")
        );
        assert_ne!(
            ProjectFolder::id_for("/home/u/code"),
            ProjectFolder::id_for("/home/u/code2")
        );
        // A trailing separator and a Windows-style one name the same folder.
        assert_eq!(
            ProjectFolder::id_for("/home/u/code"),
            ProjectFolder::id_for("/home/u/code/")
        );
        assert_eq!(
            ProjectFolder::id_for("C:\\work\\app\\"),
            ProjectFolder::id_for("C:/work/app")
        );
    }

    /// A project as the scanner stores it: id and name derived from the root, the way the scan
    /// derives them, so the tests below exercise that derivation and not a hand-written id.
    fn project_at(root: &str, folder_id: &str) -> Project {
        Project {
            id: project_owner_id(&ProjectFolder::normalize(root)),
            name: display_name(std::path::Path::new(root)),
            root: root.to_string(),
            folder_id: folder_id.to_string(),
            skills: Vec::new(),
            mcp_servers: Vec::new(),
            other: Vec::new(),
            configs: Vec::new(),
            modified_ms: None,
            warnings: Vec::new(),
            scan_ms: 3,
        }
    }

    fn skill(name: &str, path: &str) -> Skill {
        Skill {
            id: Skill::new_id(name, path),
            name: name.to_string(),
            description: None,
            path: path.to_string(),
            entry_path: Some(format!("{path}/SKILL.md")),
            scope: crate::domain::Scope::Global,
            agents: Vec::new(),
            frontmatter: Vec::new(),
            content: None,
            size_bytes: None,
            created_ms: None,
            modified_ms: None,
            enabled: true,
            removable: true,
            unverified: false,
        }
    }

    #[test]
    fn a_project_is_its_own_resources_owner() {
        let root = "/home/u/work/Ahabby";
        let project = project_at(root, "folder-a1b2");

        let owner = project.owner();
        // The id every resource of this project reports as its owner, and the one the scan put on
        // the project — a card tag and a detail dialog must name the same surface.
        assert_eq!(owner.id, project.id);
        assert_eq!(owner.id, project_owner_ref(std::path::Path::new(root)).id);
        assert!(is_project_owner(&owner.id));
        assert!(owner.id.starts_with(PROJECT_OWNER_PREFIX));
        // The UI names a project's resource under the project's own directory name, never under
        // the reserved surface manifest it is read through.
        assert_eq!(owner.name, "Ahabby");
        assert_ne!(owner.id, PROJECT_SURFACE_ID);
        assert!(!is_project_owner(PROJECT_SURFACE_ID));
        assert!(owner.icon.is_none());
    }

    #[test]
    fn an_owner_id_is_a_hash_of_the_normalized_root_not_the_root() {
        // Two spellings of one folder are one project, so a page bookmarked on one machine keeps
        // resolving and the same folder cannot appear twice under different ids.
        assert_eq!(
            project_owner_id(&ProjectFolder::normalize("C:\\work\\app\\")),
            project_owner_id(&ProjectFolder::normalize("C:/work/app"))
        );

        // The path itself never enters the id: it is usable as a filename, and the cloud never
        // learns the user's directory names.
        let id = project_owner_id(&ProjectFolder::normalize("/home/u/work/secret-client"));
        assert!(id.starts_with(PROJECT_OWNER_PREFIX));
        let hash = &id[PROJECT_OWNER_PREFIX.len()..];
        assert!(!hash.is_empty());
        assert!(!hash.contains(['/', '\\']));
        assert!(!id.contains("secret-client"));
        assert_ne!(
            id,
            project_owner_id(&ProjectFolder::normalize("/home/u/work/other"))
        );
    }

    #[test]
    fn the_display_name_is_the_directory_itself() {
        assert_eq!(
            display_name(std::path::Path::new("/home/u/work/Ahabby")),
            "Ahabby"
        );
        assert_eq!(display_name(std::path::Path::new("C:/work/app")), "app");
        // A path with no last component still gets a name, so a project is never shown nameless.
        assert_eq!(display_name(std::path::Path::new("/")), "/");
    }

    #[test]
    fn resource_count_is_the_number_of_resources_found() {
        let mut project = project_at("/home/u/work/app", "folder-1");
        assert_eq!(project.resource_count(), 0);

        project
            .skills
            .push(skill("pdf", "/home/u/work/app/.claude/skills/pdf"));
        project
            .skills
            .push(skill("xlsx", "/home/u/work/app/.claude/skills/xlsx"));
        assert_eq!(project.resource_count(), 2);
    }

    #[test]
    fn a_scan_looks_projects_up_by_owner_id_and_by_folder() {
        let scan = ProjectScan {
            folders: Vec::new(),
            projects: vec![
                project_at("/home/u/work/a", "folder-a"),
                project_at("/home/u/work/b", "folder-b"),
                project_at("/home/u/work/c", "folder-a"),
            ],
            scanned_at_ms: 7,
            duration_ms: 3,
        };

        assert_eq!(
            scan.project(&scan.projects[2].id).unwrap().root,
            "/home/u/work/c"
        );
        assert!(scan.project("project:nope").is_none());

        let roots: Vec<&str> = scan
            .of_folder("folder-a")
            .map(|project| project.root.as_str())
            .collect();
        assert_eq!(roots, vec!["/home/u/work/a", "/home/u/work/c"]);
        assert_eq!(scan.of_folder("folder-z").count(), 0);
    }
}
