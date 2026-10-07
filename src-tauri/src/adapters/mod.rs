//! Adapters: the bridge between a declarative manifest and the real filesystem.
//!
//! [`AgentAdapter`] is the seam. [`ManifestAdapter`] implements every method from the
//! manifest alone, which is enough for the overwhelming majority of agents (JSON / TOML /
//! YAML configs, `SKILL.md` skills, MCP maps under a configurable key path).
//! A specialised adapter only exists where a format genuinely cannot be described
//! declaratively — and a manifest opts into it with `adapter = "claude"`.
//!
//! Adapters are picked in [`registry`] and are the *only* place that knows about
//! agent-specific file layouts.

pub mod claude;
pub mod config_facts;
pub mod doc_edit;
pub mod frontmatter;
pub mod jsonc;
pub mod manifest_adapter;
pub mod mcp_parse;
pub mod project;
pub mod registry;

use std::path::{Path, PathBuf};
use std::time::Duration;

use async_trait::async_trait;

pub use manifest_adapter::ManifestAdapter;
pub use project::ProjectAdapter;
pub use registry::AdapterRegistry;

use crate::domain::{
    AgentManifest, AgentRef, ConfigFile, Detection, InstallAction, InstallPlan, Manager, McpServer,
    McpServerDraft, OsPathMap, OtherResource, Skill, SkillDraft, SkillInstall, Version,
};
use crate::error::{AppError, Result};
use crate::platform::PlatformContext;

/// Version commands must never hang a scan.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(8);

/// Files smaller than this are inlined into the UI payload.
pub const PREVIEW_LIMIT_BYTES: u64 = 256 * 1024;

/// Read any entity from one agent.
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    fn manifest(&self) -> &AgentManifest;

    /// Reference embedded into skills / MCP servers / configs.
    fn agent_ref(&self) -> AgentRef {
        AgentRef {
            id: self.manifest().id.clone(),
            name: self.manifest().name.clone(),
            icon: self.manifest().icon.clone(),
        }
    }

    /// `Ok(None)` means "not installed on this machine".
    async fn detect(&self, ctx: &PlatformContext) -> Result<Option<Detection>>;

    /// Best effort: a missing or unparsable version is not an error.
    async fn version(&self, ctx: &PlatformContext, detection: &Detection) -> Option<Version>;

    async fn config_files(&self, ctx: &PlatformContext) -> Result<Vec<ConfigFile>>;

    async fn list_skills(&self, ctx: &PlatformContext) -> Result<Vec<Skill>>;

    async fn list_mcp_servers(&self, ctx: &PlatformContext) -> Result<Vec<McpServer>>;

    async fn list_other_resources(&self, ctx: &PlatformContext) -> Result<Vec<OtherResource>>;

    /// Deletes a skill directory by moving it to the OS trash (never a hard delete).
    async fn remove_skill(&self, ctx: &PlatformContext, skill: &Skill) -> Result<()>;

    /// Removes an MCP server entry from its config file (backup + atomic write).
    async fn remove_mcp_server(&self, ctx: &PlatformContext, server: &McpServer) -> Result<()>;

    /// Switches a skill on or off. Off renames its entry file to `<name>.disabled`, which is
    /// enough to make the agent stop loading the skill; on renames it back. Nothing is deleted,
    /// and only a skill Ahabby could also delete is switchable.
    async fn set_skill_enabled(
        &self,
        ctx: &PlatformContext,
        skill: &Skill,
        enabled: bool,
    ) -> Result<()>;

    /// Switches an MCP server on or off by moving its entry between the container the agent
    /// reads (`mcpServers`) and its disabled sibling (`mcpServersDisabled`), where no agent
    /// looks for servers. Only a server Ahabby could also remove is switchable.
    async fn set_mcp_server_enabled(
        &self,
        ctx: &PlatformContext,
        server: &McpServer,
        enabled: bool,
    ) -> Result<()>;

    /// Writes a new skill of the user's own into the skills directory the manifest declares.
    ///
    /// Only a declarative manifest can do this: an adapter that reads skills but has no
    /// declarative directory to write into refuses instead of guessing a location.
    async fn create_skill(&self, _ctx: &PlatformContext, _draft: &SkillDraft) -> Result<Skill> {
        Err(AppError::NotSupported(format!(
            "{} does not support creating skills from Ahabby",
            self.manifest().name
        )))
    }

    /// Adds a new server to the MCP config file the manifest declares.
    ///
    /// Like [`AgentAdapter::create_skill`], this needs a declarative MCP spec to be possible.
    async fn create_mcp_server(
        &self,
        _ctx: &PlatformContext,
        _draft: &McpServerDraft,
    ) -> Result<McpServer> {
        Err(AppError::NotSupported(format!(
            "{} does not support adding MCP servers from Ahabby",
            self.manifest().name
        )))
    }

    /// Writes a skill whose files come from outside Ahabby — the Hub.
    ///
    /// Like [`AgentAdapter::create_skill`] it needs a declarative skills directory, and like
    /// every write in Ahabby it lands in one piece or not at all: the payload is written into a
    /// fresh directory, `SKILL.md` last, and a directory that already holds a skill is refused
    /// rather than merged into.
    async fn install_skill(
        &self,
        _ctx: &PlatformContext,
        _install: &SkillInstall,
    ) -> Result<Skill> {
        Err(AppError::NotSupported(format!(
            "{} does not support installing skills from Ahabby",
            self.manifest().name
        )))
    }

    /// Resolve an install/update/uninstall command for this machine.
    async fn install_plan(
        &self,
        ctx: &PlatformContext,
        action: InstallAction,
        method_id: Option<&str>,
    ) -> Result<InstallPlan>;
}

/// Where an MCP entry actually lives inside its document: its own `key_path` while the server
/// is on, the sibling `<container>Disabled` object while the user has switched it off.
///
/// `key_path` always describes the *enabled* position (that is what keeps a server's id stable
/// across the switch), so every reader of a single entry — reveal, removal, toggle — has to go
/// through this.
pub fn mcp_entry_location(key_path: &[String], enabled: bool) -> Result<Vec<String>> {
    if enabled {
        return Ok(key_path.to_vec());
    }
    doc_edit::disabled_entry_path(key_path).ok_or_else(|| {
        AppError::InvalidInput("this MCP entry has no address in its config file".to_string())
    })
}

/// Directories to search for an agent's binary: manifest search paths, then the user's
/// extra scan paths from Settings.
pub fn search_dirs(ctx: &PlatformContext, manifest: &AgentManifest) -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = manifest
        .search_paths
        .iter()
        .flat_map(|spec| {
            spec.templates(ctx.os)
                .iter()
                .filter_map(|template| ctx.expand(template))
        })
        .collect();
    for extra in &ctx.extra_scan_paths {
        if !dirs.contains(extra) {
            dirs.push(extra.clone());
        }
    }
    dirs
}

/// Where each manager installs binaries, as far as we can tell from the path alone.
///
/// This is a *heuristic*: Ahabby never runs `npm ls -g` during a scan (too slow), it
/// inspects the location of the binary it already found. The UI labels the result as
/// "detected from the binary location" accordingly.
fn manager_roots(ctx: &PlatformContext, manager: Manager) -> Vec<PathBuf> {
    let home = ctx.home.clone();
    let appdata = ctx.env_var("APPDATA").map(PathBuf::from);
    let localappdata = ctx.env_var("LOCALAPPDATA").map(PathBuf::from);
    let push_opt = |list: &mut Vec<PathBuf>, value: Option<PathBuf>| {
        if let Some(value) = value {
            list.push(value);
        }
    };

    match manager {
        Manager::Npm => {
            let mut roots = Vec::new();
            push_opt(&mut roots, appdata.map(|base| base.join("npm")));
            roots.push(home.join(".nvm/versions/node"));
            roots.push(home.join(".volta/bin"));
            roots.push(home.join(".fnm/node-versions"));
            roots.push(PathBuf::from("/usr/local/bin"));
            roots.push(PathBuf::from("/usr/bin"));
            roots
        }
        Manager::Script => vec![
            // Where the official installers of the agents in this catalog put their binary.
            home.join(".local/bin"),
            home.join(".local/share"),
        ],
        Manager::Pnpm => {
            let mut roots = vec![home.join("Library/pnpm"), home.join(".local/share/pnpm")];
            push_opt(&mut roots, localappdata.map(|base| base.join("pnpm")));
            roots
        }
        Manager::Yarn => {
            let mut roots = vec![home.join(".yarn/bin")];
            push_opt(&mut roots, localappdata.map(|base| base.join("Yarn/bin")));
            roots
        }
        Manager::Bun => vec![home.join(".bun/bin")],
        Manager::Brew => vec![
            PathBuf::from("/opt/homebrew"),
            PathBuf::from("/usr/local/Cellar"),
            PathBuf::from("/usr/local/opt"),
            PathBuf::from("/home/linuxbrew/.linuxbrew"),
            home.join(".linuxbrew"),
        ],
        Manager::Winget => {
            let mut roots = Vec::new();
            push_opt(
                &mut roots,
                localappdata.map(|base| base.join("Microsoft/WinGet/Links")),
            );
            roots
        }
        Manager::Scoop => vec![home.join("scoop/shims")],
        Manager::Pipx => {
            let mut roots = vec![home.join(".local/bin")];
            push_opt(&mut roots, appdata.map(|base| base.join("Python")));
            push_opt(
                &mut roots,
                localappdata.map(|base| base.join("Programs/Python")),
            );
            roots
        }
        Manager::Pip => vec![home.join(".local/bin")],
        Manager::Cargo => vec![home.join(".cargo/bin")],
        Manager::Go => vec![home.join("go/bin")],
        Manager::Manual => Vec::new(),
    }
}

/// Which of `candidates` owns this binary, judging by the directory it lives in.
/// The most specific (longest) matching root wins.
pub fn infer_manager(
    ctx: &PlatformContext,
    binary_path: &Path,
    candidates: &[Manager],
) -> Option<Manager> {
    let mut best: Option<(usize, Manager)> = None;
    for manager in candidates {
        for root in manager_roots(ctx, *manager) {
            let depth = root.components().count();
            if binary_path.starts_with(&root) && best.map(|(len, _)| depth > len).unwrap_or(true) {
                best = Some((depth, *manager));
            }
        }
    }
    best.map(|(_, manager)| manager)
}

/// `true` when a manifest flagged one of the paths it needs as unverified.
///
/// Entries are dotted paths (`skills.path`, `configs.settings.path`); a match on either
/// side counts, so `configs` also marks `configs.settings.path`.
pub fn is_unverified(manifest: &AgentManifest, field: &str) -> bool {
    manifest.unverified.iter().any(|entry| {
        entry == field || field.starts_with(entry.as_str()) || entry.starts_with(field)
    })
}

/// Target of a glob expansion.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GlobTarget {
    Files,
    Directories,
}

/// Expand a manifest path and, when `glob` is given, every entry underneath that matches it.
///
/// Ordering is deterministic (sorted by file name) so scans are reproducible.
pub fn expand_glob(
    ctx: &PlatformContext,
    map: &OsPathMap,
    glob: Option<&str>,
    target: GlobTarget,
    max_depth: usize,
) -> Vec<PathBuf> {
    let Some(base) = ctx.expand_map(map) else {
        return Vec::new();
    };
    let Some(pattern) = glob else {
        return if base.exists() {
            vec![base]
        } else {
            Vec::new()
        };
    };
    if !base.is_dir() {
        return Vec::new();
    }
    let matcher = match globset::GlobBuilder::new(pattern)
        .literal_separator(false)
        .build()
    {
        Ok(glob) => glob.compile_matcher(),
        Err(_) => return Vec::new(),
    };

    let mut found: Vec<PathBuf> = Vec::new();
    // Symlinks are followed on purpose: `~/.claude/skills/<name>` is very often a link into a
    // shared `~/.agents/skills` directory. `walkdir` detects link loops and reports them as
    // errors, which are filtered out below, and `max_depth` bounds the walk either way.
    let walker = walkdir::WalkDir::new(&base)
        .min_depth(1)
        .max_depth(max_depth)
        .follow_links(true)
        .sort_by_file_name();
    for entry in walker.into_iter().filter_map(std::result::Result::ok) {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        let is_dir = entry.file_type().is_dir();
        if (target == GlobTarget::Directories) != is_dir {
            continue;
        }
        let Ok(relative) = entry.path().strip_prefix(&base) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        if matcher.is_match(&relative) {
            found.push(entry.path().to_path_buf());
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::Os;

    fn context() -> PlatformContext {
        PlatformContext::for_tests(Os::Linux, "/home/tester", "/data", "/cfg")
            .with_extra_scan_paths(vec![PathBuf::from("/extra")])
    }

    #[test]
    fn infers_manager_from_the_most_specific_root() {
        let ctx = context();
        let candidates = [Manager::Npm, Manager::Brew, Manager::Cargo];
        assert_eq!(
            infer_manager(&ctx, Path::new("/usr/local/bin/claude"), &candidates),
            Some(Manager::Npm)
        );
        assert_eq!(
            infer_manager(&ctx, Path::new("/opt/homebrew/bin/x"), &candidates),
            Some(Manager::Brew)
        );
        assert_eq!(
            infer_manager(&ctx, Path::new("/home/tester/.cargo/bin/x"), &candidates),
            Some(Manager::Cargo)
        );
    }

    #[test]
    fn inference_respects_the_manifest_methods() {
        let ctx = context();
        // /usr/local/bin belongs to npm, but the manifest only offers cargo.
        assert_eq!(
            infer_manager(&ctx, Path::new("/usr/local/bin/x"), &[Manager::Cargo]),
            None
        );
    }

    #[test]
    fn search_dirs_appends_user_paths() {
        let ctx = context();
        let manifest = toml_edit::de::from_str::<AgentManifest>(
            r#"
id = "x"
name = "X"
description = "d"

[binaries]
names = ["x"]

[[search_paths]]
linux = ["${HOME}/.x/bin"]
macos = ["/opt/homebrew/bin"]
"#,
        )
        .unwrap();
        let dirs = search_dirs(&ctx, &manifest);
        assert_eq!(dirs[0], PathBuf::from("/home/tester/.x/bin"));
        assert_eq!(dirs[1], PathBuf::from("/extra"));
    }

    #[test]
    fn unverified_matching_handles_dotted_paths() {
        let manifest = toml_edit::de::from_str::<AgentManifest>(
            r#"
id = "x"
name = "X"
description = "d"
unverified = ["skills.path", "mcp"]

[binaries]
names = ["x"]
"#,
        )
        .unwrap();
        assert!(is_unverified(&manifest, "skills.path"));
        assert!(is_unverified(&manifest, "mcp.key_path"));
        assert!(!is_unverified(&manifest, "configs.settings.path"));
    }

    #[test]
    fn expand_glob_is_deterministic_and_skips_hidden_entries() {
        let dir = tempfile::tempdir().unwrap();
        let skills = dir.path().join("skills");
        std::fs::create_dir_all(skills.join("beta")).unwrap();
        std::fs::create_dir_all(skills.join("alpha")).unwrap();
        std::fs::create_dir_all(skills.join(".hidden")).unwrap();
        for name in ["beta", "alpha"] {
            std::fs::write(skills.join(name).join("SKILL.md"), "---\nname: x\n---\n").unwrap();
        }

        let ctx = PlatformContext::for_tests(Os::Linux, dir.path(), "/data", "/cfg");
        let map = OsPathMap {
            linux: Some("${HOME}/skills".to_string()),
            ..Default::default()
        };
        let files = expand_glob(&ctx, &map, Some("*/SKILL.md"), GlobTarget::Files, 3);
        assert_eq!(files.len(), 2);
        assert!(files[0].ends_with("alpha/SKILL.md"));
        assert!(files[1].ends_with("beta/SKILL.md"));

        let dirs = expand_glob(&ctx, &map, Some("*"), GlobTarget::Directories, 2);
        assert_eq!(dirs.len(), 2);

        // No glob: the base path itself, and only when it exists.
        let single = expand_glob(&ctx, &map, None, GlobTarget::Files, 1);
        assert_eq!(single, vec![skills.clone()]);
        let missing = OsPathMap {
            linux: Some("${HOME}/nope".to_string()),
            ..Default::default()
        };
        assert!(expand_glob(&ctx, &missing, None, GlobTarget::Files, 1).is_empty());
    }
}
