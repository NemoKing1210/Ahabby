//! The project surface: the folders the user added, and what Ahabby finds inside them.
//!
//! Three jobs:
//!
//! 1. **Discover** project roots under an added folder. A directory is a project when it holds
//!    one of the markers the surface manifest declares (`.claude`, `.mcp.json`, `AGENTS.md`, …)
//!    or a git repository, so "a folder with projects" and "a folder with a project" are the
//!    same thing to the user; a folder holding nothing is still treated as one project, because
//!    that is what the user said it was.
//! 2. **Read** each project through the same [`ManifestAdapter`] as an agent, with a
//!    [`PlatformContext`] rooted at the project: `catalog/project.toml` is the single declarative
//!    description of where a project keeps skills, MCP servers and documents, and everything the
//!    adapter already does — globs, secret masking, formats — applies unchanged.
//! 3. **Address** a project's documents: [`resolve_document`] is what lets the reading, editing,
//!    creating and deleting commands serve a project without a second implementation.

use std::collections::{BTreeSet, VecDeque};
use std::path::{Path, PathBuf};
use std::sync::{Arc, LazyLock};
use std::time::{Duration, Instant};

use tracing::warn;

use crate::adapters::{AgentAdapter, ProjectAdapter};
use crate::catalog::parse_manifest;
use crate::domain::{
    AgentManifest, ConfigFile, McpServer, OtherResource, Project, ProjectFolder,
    ProjectFolderStatus, ProjectScan, Skill,
};
use crate::error::{AppError, Result};
use crate::platform::{self, PlatformContext};
use crate::state::{resolve_in, DocumentTarget};

const MANIFEST_TOML: &str = include_str!("../../catalog/project.toml");

/// How far below an added folder a project is looked for.
const DISCOVERY_DEPTH: usize = 3;
/// Upper bound on the directories one added folder may cost. A folder with a hundred projects is
/// ordinary; a folder holding an entire home directory is not, and must not freeze a scan.
const MAX_VISITED: usize = 20_000;
/// Reading one project must never hang the scan.
const PROJECT_TIMEOUT: Duration = Duration::from_secs(15);
/// Directories that never hold a project of their own: dependencies, build output, caches.
const SKIP_DIRS: &[&str] = &[
    "node_modules",
    "target",
    "dist",
    "build",
    "out",
    "bin",
    "obj",
    "vendor",
    "venv",
    "__pycache__",
    "coverage",
    "tmp",
    "temp",
    "Pods",
];
/// Markers too common to mean "a project" on their own: the item *inside* them is the marker.
const WEAK_MARKERS: &[&str] = &[".github"];

/// The parsed manifest of the project surface.
///
/// Compiled in and validated by a unit test, so construction can only fail if the file was
/// edited into an invalid state.
pub fn manifest() -> &'static AgentManifest {
    static MANIFEST: LazyLock<AgentManifest> = LazyLock::new(|| {
        parse_manifest(MANIFEST_TOML, "project").expect("catalog/project.toml must stay valid")
    });
    &MANIFEST
}

/// The adapter that reads one project's resources: the ordinary manifest-driven one, rooted at
/// the project and stamping it as the owner of everything it yields.
pub fn adapter(root: &Path) -> Arc<dyn AgentAdapter> {
    Arc::new(ProjectAdapter::new(manifest().clone(), root.to_path_buf()))
}

/// Keys a directory is identified as a project by: the first path segment of every location the
/// surface declares, plus the git directory every repository carries.
///
/// Deriving them from the manifest is what keeps discovery and reading in sync: adding an
/// `[[other]]` entry for a new tool also makes a folder holding it a project.
pub fn markers() -> &'static BTreeSet<String> {
    static MARKERS: LazyLock<BTreeSet<String>> = LazyLock::new(|| derive_markers(manifest()));
    &MARKERS
}

fn derive_markers(manifest: &AgentManifest) -> BTreeSet<String> {
    let mut markers: BTreeSet<String> = BTreeSet::new();
    // A git repository is a project in the broadest sense, and the most common marker by far.
    markers.insert(".git".to_string());

    let mut relative: Vec<String> = Vec::new();
    let mut collect = |path: &crate::domain::OsPathMap| {
        if let Some(template) = relative_template(path) {
            relative.push(template.to_string());
        }
    };
    for spec in &manifest.skills {
        collect(&spec.path);
    }
    for spec in &manifest.mcp {
        collect(&spec.path);
    }
    for spec in &manifest.configs {
        collect(&spec.path);
    }
    for spec in &manifest.other {
        collect(&spec.path);
    }

    for path in relative {
        let first = path
            .split(['/', '\\'])
            .find(|segment| !segment.is_empty())
            .unwrap_or_default()
            .to_string();
        if first.is_empty() {
            continue;
        }
        // `.github` alone says nothing; the file inside it is what marks a project.
        let marker = if WEAK_MARKERS.contains(&first.as_str()) {
            path
        } else {
            first
        };
        markers.insert(marker);
    }
    markers
}

/// The template of a path map, when every OS declares the same *relative* location.
///
/// An absolute template (`${HOME}/.claude/skills`, `C:\tools`) describes the machine, never a
/// project, so it contributes no marker.
fn relative_template(map: &crate::domain::OsPathMap) -> Option<&str> {
    let templates: Vec<&str> = map.templates().map(String::as_str).collect();
    if templates.is_empty() {
        return None;
    }
    templates
        .iter()
        .all(|path| is_relative(path))
        .then(|| templates[0])
}

fn is_relative(path: &str) -> bool {
    let trimmed = path.trim();
    // A drive-relative path (`C:tools`) is not something to root at a project either.
    let has_drive = trimmed.len() > 1 && trimmed.as_bytes()[1] == b':';
    !(trimmed.is_empty()
        || trimmed.starts_with(['/', '\\', '~'])
        || trimmed.contains("${")
        || has_drive)
}

/// `true` when `dir` holds one of the markers the project surface declares.
fn is_project_dir(dir: &Path, markers: &BTreeSet<String>) -> bool {
    markers.iter().any(|marker| dir.join(marker).exists())
}

/// Every project root at or below `root`, breadth first, stopping at each project it finds.
pub fn discover_roots(root: &Path, markers: &BTreeSet<String>) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = Vec::new();
    let mut visited: BTreeSet<PathBuf> = BTreeSet::new();
    let mut queue: VecDeque<(PathBuf, usize)> = VecDeque::new();
    queue.push_back((root.to_path_buf(), 0));

    while let Some((dir, depth)) = queue.pop_front() {
        // Symlinks are followed (a project is often linked into a work folder), so the walk is
        // guarded against a link that points back up the tree.
        let key = platform::canonical_dir(&dir).unwrap_or_else(|| dir.clone());
        if !visited.insert(key) {
            continue;
        }
        if visited.len() > MAX_VISITED {
            warn!(
                "stopped looking for projects under {}: too many directories",
                root.display()
            );
            break;
        }
        if is_project_dir(&dir, markers) {
            found.push(dir);
            // A project's own sub-directories belong to it: descending would report every
            // package of a monorepo as a project of its own.
            continue;
        }
        if depth >= DISCOVERY_DEPTH {
            continue;
        }
        let Ok(entries) = std::fs::read_dir(&dir) else {
            continue;
        };
        let mut children: Vec<PathBuf> = entries
            .flatten()
            .filter_map(|entry| {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.starts_with('.') || SKIP_DIRS.contains(&name.as_str()) {
                    return None;
                }
                // `metadata` follows a symlink, so a linked *directory* counts as one.
                let is_dir = entry.metadata().map(|meta| meta.is_dir()).unwrap_or(false);
                is_dir.then(|| entry.path())
            })
            .collect();
        children.sort_by_key(|path| path.to_string_lossy().to_lowercase());
        for child in children {
            queue.push_back((child, depth + 1));
        }
    }

    found.sort_by_key(|path| path.to_string_lossy().to_lowercase());
    found
}

/// A folder the user wants to add, resolved and validated.
pub fn folder_for(path: &str) -> Result<ProjectFolder> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput(
            "a folder path is required".to_string(),
        ));
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_dir() {
        return Err(AppError::InvalidInput(format!(
            "{} is not a folder Ahabby can read",
            candidate.display()
        )));
    }
    let canonical = platform::canonical_dir(&candidate)
        .ok_or_else(|| AppError::NotFound(candidate.to_string_lossy().to_string()))?;
    let resolved = canonical.to_string_lossy().to_string();
    Ok(ProjectFolder {
        id: ProjectFolder::id_for(&resolved),
        path: resolved,
        added_at_ms: platform::now_ms(),
    })
}

/// Read every added folder. A folder that failed never fails the scan: its problem is reported
/// on the folder itself.
pub async fn scan(ctx: &PlatformContext, folders: &[ProjectFolder]) -> ProjectScan {
    let started = Instant::now();
    let markers = markers();
    let mut statuses: Vec<ProjectFolderStatus> = Vec::new();
    let mut projects: Vec<Project> = Vec::new();

    for folder in folders {
        let (status, mut found) = scan_folder(ctx, folder, markers).await;
        statuses.push(status);
        projects.append(&mut found);
    }

    ProjectScan {
        folders: statuses,
        projects,
        scanned_at_ms: platform::now_ms(),
        duration_ms: started.elapsed().as_millis() as u64,
    }
}

async fn scan_folder(
    ctx: &PlatformContext,
    folder: &ProjectFolder,
    markers: &BTreeSet<String>,
) -> (ProjectFolderStatus, Vec<Project>) {
    let path = PathBuf::from(&folder.path);
    let Some(root) = platform::canonical_dir(&path) else {
        return (
            ProjectFolderStatus {
                folder: folder.clone(),
                resolved: None,
                exists: false,
                problem: Some(format!("{} does not exist (yet)", folder.path)),
            },
            Vec::new(),
        );
    };

    let mut roots = discover_roots(&root, markers);
    // The user may have added one repository that carries no marker Ahabby knows about; the
    // folder they picked is then the project, which is exactly what they meant by adding it.
    if roots.is_empty() {
        roots.push(root.clone());
    }

    let mut projects = Vec::new();
    for project_root in roots {
        projects.push(read_project(ctx, &folder.id, &project_root).await);
    }

    (
        ProjectFolderStatus {
            folder: folder.clone(),
            resolved: Some(root.to_string_lossy().to_string()),
            exists: true,
            problem: None,
        },
        projects,
    )
}

/// Read one project: its skills, MCP servers, documents and addressable files.
async fn read_project(ctx: &PlatformContext, folder_id: &str, root: &Path) -> Project {
    let started = Instant::now();
    let surface = ProjectAdapter::new(manifest().clone(), root.to_path_buf());
    let resolved = root.to_string_lossy().to_string();
    let owner = surface.agent_ref();

    let mut configs: Vec<ConfigFile> = Vec::new();
    let mut skills: Vec<Skill> = Vec::new();
    let mut mcp_servers: Vec<McpServer> = Vec::new();
    let mut other: Vec<OtherResource> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();

    let read = async {
        futures::join!(
            surface.config_files(ctx),
            surface.list_skills(ctx),
            surface.list_mcp_servers(ctx),
            surface.list_other_resources(ctx),
        )
    };

    match tokio::time::timeout(PROJECT_TIMEOUT, read).await {
        Ok((configs_result, skills_result, servers_result, other_result)) => {
            match configs_result {
                Ok(found) => configs = found,
                Err(error) => warnings.push(format!("configs: {error}")),
            }
            match skills_result {
                Ok(found) => skills = found,
                Err(error) => warnings.push(format!("skills: {error}")),
            }
            match servers_result {
                Ok(found) => mcp_servers = found,
                Err(error) => warnings.push(format!("mcp servers: {error}")),
            }
            match other_result {
                Ok(mut found) => {
                    // A declared document that is not there is noise in a project: the project
                    // page lists what the project *has*, not what it could have.
                    found.retain(|resource| resource.exists);
                    OtherResource::sort_for_display(&mut found);
                    other = found;
                }
                Err(error) => warnings.push(format!("documents: {error}")),
            }
        }
        Err(_) => warnings.push(format!(
            "reading this project timed out after {}s",
            PROJECT_TIMEOUT.as_secs()
        )),
    }

    let modified_ms = skills
        .iter()
        .filter_map(|skill| skill.modified_ms)
        .chain(mcp_servers.iter().filter_map(|server| server.modified_ms))
        .chain(other.iter().filter_map(|resource| resource.modified_ms))
        .chain(configs.iter().filter_map(|config| config.modified_ms))
        .max();

    Project {
        id: owner.id,
        name: owner.name,
        root: resolved,
        folder_id: folder_id.to_string(),
        skills,
        mcp_servers,
        other,
        configs,
        modified_ms,
        warnings,
        scan_ms: started.elapsed().as_millis() as u64,
    }
}
/// Resolve an addressable document of one project (reading, editing, revealing).
pub fn resolve_document(project: &Project, path: &str) -> Result<DocumentTarget> {
    resolve_in(
        &project.configs,
        &project.other,
        &project.skills,
        // The project surface declares no extensions.
        &[],
        &project.name,
        path,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Os, OtherKind, Scope, SkillFormat, PROJECT_SURFACE_ID};

    /// A context whose "home" is the temp directory, so nothing touches the real machine.
    fn context(dir: &Path) -> PlatformContext {
        PlatformContext::for_tests(Os::current(), dir, dir.join("data"), dir.join("cfg"))
    }

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn the_surface_manifest_is_valid_and_project_scoped() {
        let manifest = manifest();
        assert_eq!(manifest.id, PROJECT_SURFACE_ID);
        assert!(manifest
            .validate()
            .iter()
            .all(|problem| problem.severity != crate::domain::Severity::Error));

        // Every declared location is relative: an absolute one would describe this machine
        // rather than a project, and could never be rooted at the project being read.
        for template in manifest
            .skills
            .iter()
            .flat_map(|spec| spec.path.templates())
            .chain(manifest.mcp.iter().flat_map(|spec| spec.path.templates()))
            .chain(
                manifest
                    .configs
                    .iter()
                    .flat_map(|spec| spec.path.templates()),
            )
            .chain(manifest.other.iter().flat_map(|spec| spec.path.templates()))
        {
            assert!(is_relative(template), "{template} is not project scoped");
        }

        // The first skills and MCP entries are what Ahabby writes into, so they must be the
        // locations the tools share.
        assert_eq!(
            manifest.skills.first().map(|spec| spec.format),
            Some(SkillFormat::SkillMd)
        );
        assert_eq!(
            manifest
                .skills
                .first()
                .and_then(|spec| spec.path.get(Os::Linux)),
            Some(".claude/skills")
        );
        assert_eq!(
            manifest.mcp.first().map(|spec| spec.key_path.clone()),
            Some(vec!["mcpServers".to_string()])
        );
    }

    #[test]
    fn markers_come_from_the_manifest() {
        let markers = markers();
        for expected in [
            ".git",
            ".claude",
            ".agents",
            ".cursor",
            ".vscode",
            ".mcp.json",
            "AGENTS.md",
        ] {
            assert!(markers.contains(expected), "missing marker {expected}");
        }
        // `.github` alone says nothing; the copilot instructions inside it do.
        assert!(!markers.contains(".github"));
        assert!(markers.contains(".github/copilot-instructions.md"));
    }

    #[test]
    fn discovery_finds_repositories_and_stops_at_a_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        // A folder with three projects and one directory that is itself a project's interior.
        write(&root.join("alpha/.git/HEAD"), "ref: refs/heads/main\n");
        write(
            &root.join("nested/beta/.claude/skills/pdf/SKILL.md"),
            "---\nname: pdf\n---\n",
        );
        write(&root.join("gamma/AGENTS.md"), "# rules\n");
        write(&root.join("not-a-project/readme.txt"), "nothing to see");
        // Noise that must never be walked into.
        write(&root.join("node_modules/pkg/.git/HEAD"), "x");
        // A project's own sub-directory stays part of it.
        write(&root.join("alpha/packages/inner/.git/HEAD"), "x");

        let found: Vec<String> = discover_roots(root, markers())
            .iter()
            .map(|path| {
                path.strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/")
            })
            .collect();
        assert_eq!(found, vec!["alpha", "gamma", "nested/beta"]);
    }

    #[tokio::test]
    async fn a_folder_is_its_own_project_when_it_holds_no_marker() {
        let dir = tempfile::tempdir().unwrap();
        write(&dir.path().join("app/main.go"), "package main\n");
        let folder = folder_for(dir.path().to_str().unwrap()).unwrap();

        let report = scan(&context(dir.path()), std::slice::from_ref(&folder)).await;
        assert_eq!(report.projects.len(), 1);
        assert_eq!(report.projects[0].folder_id, folder.id);
        assert!(report.folders[0].exists);
        assert!(report.folders[0].problem.is_none());
    }

    #[tokio::test]
    async fn a_project_is_read_and_owned_by_itself() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("work/app");
        write(
            &root.join(".claude/skills/review/SKILL.md"),
            "---\nname: review\ndescription: Review code\n---\n# Review\n",
        );
        write(
            &root.join(".mcp.json"),
            r#"{"mcpServers":{"github":{"command":"npx","args":["-y","server-github"]}}}"#,
        );
        write(&root.join("AGENTS.md"), "# House rules\n");
        write(&root.join(".cursor/rules/style.mdc"), "always be terse\n");
        write(&root.join("CLAUDE.md"), "# Claude\n");

        let folder = folder_for(dir.path().to_str().unwrap()).unwrap();
        let report = scan(&context(dir.path()), std::slice::from_ref(&folder)).await;
        let project = &report.projects[0];

        assert_eq!(
            project.root,
            platform::canonical_dir(&root).unwrap().to_string_lossy()
        );
        assert_eq!(project.name, "app");
        assert_eq!(project.skills.len(), 1, "{:?}", project.skills);
        assert_eq!(project.mcp_servers.len(), 1);
        assert_eq!(project.mcp_servers[0].name, "github");
        assert_eq!(
            project
                .other
                .iter()
                .filter(|resource| resource.kind == OtherKind::Rules)
                .count(),
            1
        );

        // Every resource is project-scoped and owned by the project, never by an agent.
        assert!(project.skills.iter().all(|skill| {
            skill.agents.len() == 1
                && skill.agents[0].id == project.id
                && matches!(skill.scope, Scope::Project { .. })
        }));

        // …and the documents of the project are addressable through the project itself.
        let skill_entry = project.skills[0].entry_path.clone().unwrap();
        assert!(resolve_document(project, &skill_entry).is_ok());
        assert!(resolve_document(project, &project.root).is_err());
        assert!(resolve_document(project, "/etc/passwd").is_err());
    }

    #[tokio::test]
    async fn parsing_the_project_surface_never_touches_the_real_machine() {
        // The project surface has no absolute path, so a context without a project root cannot
        // accidentally read the user's home directory.
        let dir = tempfile::tempdir().unwrap();
        let report = scan(&context(dir.path()), &[]).await;
        assert!(report.projects.is_empty());

        let folder = folder_for(dir.path().to_str().unwrap()).unwrap();
        let report = scan(
            &context(dir.path()),
            &[ProjectFolder {
                path: dir.path().join("gone").to_string_lossy().to_string(),
                ..folder
            }],
        )
        .await;
        assert!(!report.folders[0].exists);
        assert!(report.folders[0].problem.is_some());
    }

    #[test]
    fn folder_paths_are_normalized_before_they_become_ids() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().to_string_lossy().to_string();
        let with_separator = format!("{path}{}", std::path::MAIN_SEPARATOR);
        assert_eq!(
            folder_for(&path).unwrap().id,
            folder_for(&with_separator).unwrap().id
        );
        assert!(folder_for(&dir.path().join("nope").to_string_lossy()).is_err());
        assert!(folder_for("   ").is_err());
    }
}
