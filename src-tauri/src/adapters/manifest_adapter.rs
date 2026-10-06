//! The default adapter: everything is driven by the manifest.
//!
//! If an agent can be described as "a binary, some config files, a skills directory and
//! an MCP map under a key path", it needs no Rust code at all — only TOML.

use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::domain::{
    AgentManifest, ConfigFile, ConfigFormat, ConfigSpec, Detection, InstallAction, InstallPlan,
    Manager, McpEntryShape, McpServer, McpServerDraft, McpSpec, OtherResource, OtherSpec, Scope,
    Skill, SkillDraft, SkillFormat, Version,
};
use crate::error::{AppError, Result};
use crate::platform::{self, PlatformContext};

use super::doc_edit;
use super::frontmatter;
use super::mcp_parse;
use super::{
    expand_glob, is_unverified, mcp_entry_location, search_dirs, AgentAdapter, GlobTarget,
    PREVIEW_LIMIT_BYTES, VERSION_TIMEOUT,
};

const SKILL_FILE_NAMES: &[&str] = &["SKILL.md", "skill.md", "README.md", "readme.md"];
const OTHER_GLOB_DEPTH: usize = 3;

/// Suffix a skill's entry file carries while the skill is switched off.
///
/// Agents look for the exact file name (`SKILL.md`), so a renamed entry is a skill the agent
/// no longer sees — and renaming it back is the whole "switch it on" operation. Nothing is
/// deleted, and the file's contents are never touched.
const DISABLED_FILE_SUFFIX: &str = ".disabled";

/// `SKILL.md` → `SKILL.md.disabled`.
fn disabled_name(name: &str) -> String {
    format!("{name}{DISABLED_FILE_SUFFIX}")
}

/// `SKILL.md.disabled` → `SKILL.md`; a path without the suffix is returned unchanged.
fn without_disabled_suffix(path: &Path) -> PathBuf {
    let Some(name) = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
    else {
        return path.to_path_buf();
    };
    match name.strip_suffix(DISABLED_FILE_SUFFIX) {
        Some(base) => path.with_file_name(base),
        None => path.to_path_buf(),
    }
}

/// The entry file a skill directory is recognised by, with the state it is in: the recognised
/// name while the skill is on, the same name with the disabled suffix while it is off.
///
/// `None` when neither exists — the directory is not a skill.
fn skill_entry(directory: &Path, format: SkillFormat) -> Option<(PathBuf, bool)> {
    let names: Vec<&str> = match format {
        SkillFormat::SkillMd => vec!["SKILL.md"],
        SkillFormat::Directory => SKILL_FILE_NAMES.to_vec(),
        SkillFormat::MarkdownFile => return None,
    };
    for name in &names {
        let candidate = directory.join(name);
        if candidate.is_file() {
            return Some((candidate, true));
        }
    }
    for name in &names {
        let candidate = directory.join(disabled_name(name));
        if candidate.is_file() {
            return Some((candidate, false));
        }
    }
    None
}

/// Entries of a server map, in document order.
///
/// Most agents store `name -> server`, but some (Continue) store an array of servers that
/// carry their own `name`.
fn mcp_entries(map: &serde_json::Value) -> Vec<(String, &serde_json::Value)> {
    match map {
        serde_json::Value::Object(object) => object
            .iter()
            .map(|(name, value)| (name.clone(), value))
            .collect(),
        serde_json::Value::Array(items) => items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let name = item
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .map(str::to_string)
                    .unwrap_or_else(|| format!("server-{}", index + 1));
                (name, item)
            })
            .collect(),
        _ => Vec::new(),
    }
}

pub struct ManifestAdapter {
    manifest: AgentManifest,
    /// The id this adapter's resources report as their owner.
    ///
    /// For an agent it is the manifest's own id. An adapter that reads *for* a synthetic owner
    /// sets it: `catalog/project.toml` describes the project surface, but the owner of everything
    /// found through it is the project itself. The ownership guards below compare against this id
    /// rather than the manifest's, so they accept exactly the resources this adapter produced.
    owner_id: Option<String>,
}

/// Directory name a new skill is stored under: derived from the display name, keeping letters
/// and digits and turning every run of anything else into a single `-`.
fn skill_slug(name: &str) -> String {
    let mut slug = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_alphanumeric() {
            slug.extend(character.to_lowercase());
            separator = false;
        } else if !separator {
            slug.push('-');
            separator = true;
        }
    }
    slug.trim_matches('-').to_string()
}

/// The `SKILL.md` a new skill is written as: YAML frontmatter, then the markdown body.
fn render_skill(name: &str, description: Option<&str>, body: Option<&str>) -> String {
    // `name` first: that is the order every `SKILL.md` in the wild uses, and serde_yaml only
    // keeps field order for a struct — a map would be alphabetical.
    let mut frontmatter = format!("name: {}\n", yaml_scalar(name));
    if let Some(description) = description.map(str::trim).filter(|text| !text.is_empty()) {
        frontmatter.push_str(&format!("description: {}\n", yaml_scalar(description)));
    }
    let body = body.unwrap_or("").trim();
    format!("---\n{frontmatter}---\n\n{body}\n")
}

/// One YAML scalar, quoted when the text needs it (`a: b` must not become a mapping).
fn yaml_scalar(value: &str) -> String {
    serde_yaml::to_string(value)
        .unwrap_or_else(|_| format!("{value:?}"))
        .trim_end()
        .to_string()
}

/// The content a config file starts with when Ahabby creates it to hold its first entry.
fn empty_document(format: ConfigFormat) -> &'static str {
    match format {
        ConfigFormat::Json | ConfigFormat::Jsonc | ConfigFormat::Yaml => "{\n}\n",
        ConfigFormat::Toml | ConfigFormat::Markdown | ConfigFormat::Text => "",
    }
}

/// Files an MCP spec applies to: one path, or every file matching its glob.
fn mcp_files(ctx: &PlatformContext, spec: &McpSpec) -> Vec<PathBuf> {
    match spec.glob.as_deref() {
        Some(glob) => expand_glob(ctx, &spec.path, Some(glob), GlobTarget::Files, 3),
        None => ctx
            .expand_map(&spec.path)
            .filter(|path| path.is_file())
            .into_iter()
            .collect(),
    }
}

impl ManifestAdapter {
    pub fn new(manifest: AgentManifest) -> Self {
        Self {
            manifest,
            owner_id: None,
        }
    }

    /// Read for a synthetic owner: everything this adapter yields is stamped with `id` (by the
    /// caller that wraps it), and the ownership guards compare against that same id.
    pub fn owned_by(mut self, id: impl Into<String>) -> Self {
        self.owner_id = Some(id.into());
        self
    }

    /// The id the resources of this adapter carry as their owner.
    fn owner_id(&self) -> &str {
        self.owner_id.as_deref().unwrap_or(&self.manifest.id)
    }

    pub fn into_boxed(self) -> Box<dyn AgentAdapter> {
        Box::new(self)
    }

    /// Every file this adapter is allowed to write to.
    ///
    /// `remove_mcp_server` re-checks the target against this list, so a forged request
    /// from the frontend can never make the backend write somewhere else.
    fn writable_paths(&self, ctx: &PlatformContext) -> Vec<PathBuf> {
        let mut paths: Vec<PathBuf> = Vec::new();
        for spec in &self.manifest.configs {
            match spec.glob.as_deref() {
                Some(glob) => paths.extend(expand_glob(
                    ctx,
                    &spec.path,
                    Some(glob),
                    GlobTarget::Files,
                    3,
                )),
                None => paths.extend(ctx.expand_map(&spec.path)),
            }
        }
        for spec in self.mcp_specs() {
            paths.extend(mcp_files(ctx, spec));
        }
        paths
    }

    /// MCP specs of this manifest, in order.
    fn mcp_specs(&self) -> Vec<&McpSpec> {
        self.manifest.mcp.iter().collect()
    }

    /// The path of a skill this manifest may change, after every guard: it must belong to this
    /// agent, be one Ahabby is allowed to act on (not a document owned by someone else), live
    /// under a skills root the manifest declared, and still exist.
    ///
    /// Shared by deletion and the on/off switch, so both are guarded identically.
    fn checked_skill_path(&self, ctx: &PlatformContext, skill: &Skill) -> Result<PathBuf> {
        if !skill.agents.iter().any(|agent| agent.id == self.owner_id()) {
            return Err(AppError::InvalidInput(
                "this skill belongs to a different owner".to_string(),
            ));
        }
        if !skill.removable {
            return Err(AppError::NotSupported(
                "this skill is managed elsewhere and cannot be changed from Ahabby".to_string(),
            ));
        }

        // The path must live under a skills directory the manifest declared.
        let allowed: Vec<PathBuf> = self
            .manifest
            .skills
            .iter()
            .flat_map(|spec| ctx.expand_map(&spec.path))
            .collect();
        let target = PathBuf::from(&skill.path);
        if !allowed.iter().any(|root| target.starts_with(root)) {
            return Err(AppError::CommandNotAllowed(format!(
                "{} is outside the skills directory declared by {}",
                skill.path, self.manifest.id
            )));
        }
        if !target.exists() {
            return Err(AppError::NotFound(skill.path.clone()));
        }
        Ok(target)
    }

    /// The config file an MCP removal or on/off switch may touch, plus the spec that describes
    /// how to edit it. Shared by both, so the path checks cannot drift apart.
    fn checked_mcp_target(
        &self,
        ctx: &PlatformContext,
        server: &McpServer,
    ) -> Result<(PathBuf, &McpSpec)> {
        if server.agent.id != self.owner_id() {
            return Err(AppError::InvalidInput(
                "this MCP server belongs to a different owner".to_string(),
            ));
        }
        if !server.removable {
            return Err(AppError::NotSupported(
                "this MCP server cannot be changed from Ahabby".to_string(),
            ));
        }

        let target = PathBuf::from(&server.source_config);
        let allowed = self.writable_paths(ctx);
        if !allowed.iter().any(|path| path == &target) {
            return Err(AppError::CommandNotAllowed(format!(
                "{} is not a config file declared by {}",
                server.source_config, self.manifest.id
            )));
        }
        let Some(spec) = self
            .mcp_specs()
            .into_iter()
            .find(|spec| mcp_files(ctx, spec).contains(&target))
        else {
            return Err(AppError::InvalidInput(
                "no MCP config declared at this path".to_string(),
            ));
        };
        if !target.is_file() {
            return Err(AppError::NotFound(server.source_config.clone()));
        }
        Ok((target, spec))
    }

    fn config_entry(&self, spec: &ConfigSpec, path: PathBuf) -> ConfigFile {
        let metadata = std::fs::metadata(&path).ok();
        ConfigFile {
            id: spec.id.clone(),
            label: spec.label.clone(),
            description: spec.description.clone(),
            path: path.to_string_lossy().to_string(),
            format: spec.format,
            scope: spec.scope.clone(),
            agent: self.agent_ref(),
            exists: metadata.is_some(),
            size_bytes: metadata.as_ref().map(std::fs::Metadata::len),
            modified_ms: metadata
                .as_ref()
                .map(platform::metadata_ms)
                .filter(|value| *value > 0),
            editable: spec.editable,
        }
    }

    /// Read one skill directory (`<dir>/SKILL.md` or a directory with a README).
    ///
    /// A directory whose entry file carries the disabled suffix is still a skill: it is
    /// reported with `enabled = false` so the UI can switch it back on.
    fn skill_from_directory(
        &self,
        directory: &Path,
        format: SkillFormat,
        unverified: bool,
    ) -> Option<Skill> {
        let fallback_name = directory
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "skill".to_string());

        let (entry, enabled) = skill_entry(directory, format)?;

        let metadata = std::fs::metadata(&entry).ok();
        let size = metadata.as_ref().map(std::fs::Metadata::len);
        let text = if size.unwrap_or(0) <= PREVIEW_LIMIT_BYTES {
            platform::read_text(&entry).ok()
        } else {
            None
        };
        let markdown = text.as_deref().map(frontmatter::parse);
        let name = markdown
            .as_ref()
            .and_then(|markdown| markdown.name.clone())
            .unwrap_or(fallback_name);
        let description = markdown.as_ref().and_then(frontmatter::Markdown::summary);

        Some(Skill {
            id: Skill::new_id(&name, &directory.to_string_lossy()),
            name,
            description,
            path: directory.to_string_lossy().to_string(),
            entry_path: Some(entry.to_string_lossy().to_string()),
            scope: Scope::Global,
            agents: vec![self.agent_ref()],
            frontmatter: markdown
                .as_ref()
                .map(|markdown| markdown.frontmatter.clone())
                .unwrap_or_default(),
            content: markdown
                .as_ref()
                .map(|markdown| markdown.body.clone())
                .filter(|body| !body.trim().is_empty()),
            size_bytes: size,
            created_ms: metadata.as_ref().and_then(platform::created_at_ms),
            modified_ms: metadata.as_ref().and_then(platform::modified_at_ms),
            enabled,
            removable: true,
            unverified,
        })
    }

    /// A single markdown file that holds "the" instructions of an agent.
    ///
    /// `entry` is the file as it exists right now; the canonical (un-suffixed) name is what the
    /// skill keeps as its path and id, so switching it off never renames it in the UI.
    fn skill_from_file(&self, entry: &Path, enabled: bool, unverified: bool) -> Option<Skill> {
        if !entry.is_file() {
            return None;
        }
        let canonical = without_disabled_suffix(entry);
        let metadata = std::fs::metadata(entry).ok();
        let size = metadata.as_ref().map(std::fs::Metadata::len);
        let text = platform::read_text(entry).ok()?;
        let markdown = frontmatter::parse(&text);
        let name = markdown.name.clone().unwrap_or_else(|| {
            canonical
                .file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "instructions".to_string())
        });
        Some(Skill {
            id: Skill::new_id(&name, &canonical.to_string_lossy()),
            name,
            description: markdown.summary(),
            path: canonical.to_string_lossy().to_string(),
            entry_path: Some(entry.to_string_lossy().to_string()),
            scope: Scope::Global,
            agents: vec![self.agent_ref()],
            frontmatter: markdown.frontmatter.clone(),
            content: Some(markdown.body.clone()).filter(|body| !body.trim().is_empty()),
            size_bytes: size,
            created_ms: metadata.as_ref().and_then(platform::created_at_ms),
            modified_ms: metadata.as_ref().and_then(platform::modified_at_ms),
            enabled,
            // A standalone file is a document, not a deletable skill directory.
            removable: false,
            unverified,
        })
    }

    /// Read every MCP source declared by the manifest.
    ///
    /// A spec is usually one file, but `glob` makes it a pattern (`opencode.json*`), so a
    /// config that is `opencode.jsonc` today and `opencode.json` tomorrow keeps working.
    pub(crate) fn read_mcp_spec(
        &self,
        ctx: &PlatformContext,
        spec: &McpSpec,
    ) -> Result<Vec<McpServer>> {
        let mut servers = Vec::new();
        for path in mcp_files(ctx, spec) {
            servers.extend(self.read_mcp_file(spec, &path)?);
        }
        Ok(servers)
    }

    fn read_mcp_file(&self, spec: &McpSpec, path: &Path) -> Result<Vec<McpServer>> {
        let source_config = path.to_string_lossy().to_string();
        let metadata = std::fs::metadata(path).ok();
        let content = platform::read_text(path)?;
        let document = mcp_parse::document_to_value(spec.format, &content)?;
        let unverified = is_unverified(&self.manifest, "mcp.key_path");
        let mut servers = Vec::new();

        // A switched-off server lives in the sibling `<container>Disabled` object of the same
        // file, where no agent looks for servers. Its `key_path` still addresses the *enabled*
        // position (that is what the toggle moves it back to, and what keeps its id stable
        // across the switch), so only the container it is read from changes.
        let mut containers: Vec<(Vec<String>, bool)> = vec![(spec.key_path.clone(), true)];
        if let Some(disabled) = doc_edit::disabled_container(&spec.key_path) {
            containers.push((disabled, false));
        }

        for (container, enabled) in containers {
            let Some(map) = mcp_parse::value_at(&document, &container) else {
                continue;
            };
            // Only the map shape is addressable by key, and that is what removal *and* the
            // on/off switch need: the array shape (Continue) keeps the name inside the entry.
            let addressable = map.is_object();
            for (name, value) in mcp_entries(map) {
                let mut key_path = spec.key_path.clone();
                key_path.push(name.clone());
                let id = McpServer::new_id(&name, &source_config, &key_path);
                // A leftover disabled copy never shadows the server the agent actually sees.
                if servers.iter().any(|server: &McpServer| server.id == id) {
                    continue;
                }
                let normalized = mcp_parse::normalize(value);
                servers.push(McpServer {
                    id,
                    name,
                    transport: normalized.transport,
                    scope: Scope::Global,
                    agent: self.agent_ref(),
                    source_config: source_config.clone(),
                    key_path,
                    env: normalized.env,
                    headers: normalized.headers,
                    raw: normalized.raw,
                    created_ms: metadata.as_ref().and_then(platform::created_at_ms),
                    modified_ms: metadata.as_ref().and_then(platform::modified_at_ms),
                    has_secrets: normalized.has_secrets,
                    enabled,
                    removable: addressable,
                    unverified,
                });
            }
        }
        Ok(servers)
    }

    /// The skills directory a new skill is written into, plus the format to read it back with.
    ///
    /// The first declared location that can hold a skill wins: a manifest that reads several
    /// directories writes into the one it lists first, so the choice is the manifest's own and
    /// not a guess made here. Refuses the agents that keep their instructions in a single
    /// markdown file: there is no directory to create a skill in, and overwriting that file is
    /// not a skill creation.
    fn writable_skills_root(&self, ctx: &PlatformContext) -> Result<(PathBuf, SkillFormat)> {
        if self.manifest.skills.is_empty() {
            return Err(AppError::NotSupported(format!(
                "{} does not declare a skills directory",
                self.manifest.name
            )));
        }
        if self
            .manifest
            .skills
            .iter()
            .all(|spec| matches!(spec.format, SkillFormat::MarkdownFile))
        {
            return Err(AppError::NotSupported(format!(
                "{} keeps its instructions in a single file, which cannot hold a new skill",
                self.manifest.name
            )));
        }
        for spec in &self.manifest.skills {
            if matches!(spec.format, SkillFormat::MarkdownFile) {
                continue;
            }
            if let Some(root) = ctx.expand_map(&spec.path) {
                return Ok((root, spec.format));
            }
        }
        Err(AppError::NotSupported(
            "the skills directory of this agent does not resolve on this system".to_string(),
        ))
    }

    /// The config file a new server is written into: the file the spec already resolves to, or
    /// the declared path when it does not exist yet.
    ///
    /// A glob spec with no match cannot be created from nothing — Ahabby would have to guess
    /// the file name — so it is refused instead.
    fn mcp_target_file(&self, ctx: &PlatformContext, spec: &McpSpec) -> Result<PathBuf> {
        if let Some(path) = mcp_files(ctx, spec).into_iter().next() {
            return Ok(path);
        }
        if spec.glob.is_some() {
            return Err(AppError::NotSupported(format!(
                "{} has no MCP config file yet; create one before adding servers",
                self.manifest.name
            )));
        }
        ctx.expand_map(&spec.path).ok_or_else(|| {
            AppError::NotSupported(
                "the MCP config path of this agent does not resolve on this system".to_string(),
            )
        })
    }

    fn other_resource(&self, spec: &OtherSpec, path: PathBuf, label: String) -> OtherResource {
        let metadata = std::fs::metadata(&path).ok();
        let is_directory = metadata.as_ref().is_some_and(std::fs::Metadata::is_dir);
        let size_bytes = metadata
            .as_ref()
            .filter(|meta| meta.is_file())
            .map(std::fs::Metadata::len);

        let mut content = None;
        let mut item_count = None;
        if is_directory {
            item_count = std::fs::read_dir(&path).ok().map(|entries| {
                entries
                    .flatten()
                    .filter(|entry| !entry.file_name().to_string_lossy().starts_with('.'))
                    .count()
            });
        } else if metadata.is_some() && size_bytes.unwrap_or(0) <= PREVIEW_LIMIT_BYTES {
            content = platform::read_text(&path).ok();
        }

        OtherResource {
            id: format!(
                "{}.{}.{}",
                self.manifest.id,
                spec.id,
                crate::domain::skill::short_hash(&path.to_string_lossy())
            ),
            kind: spec.kind,
            label,
            path: path.to_string_lossy().to_string(),
            agent: self.agent_ref(),
            scope: spec.scope.clone(),
            format: spec.format,
            description: spec.description.clone(),
            content,
            size_bytes,
            created_ms: metadata.as_ref().and_then(platform::created_at_ms),
            modified_ms: metadata.as_ref().and_then(platform::modified_at_ms),
            is_directory,
            exists: metadata.is_some(),
            item_count,
            unverified: is_unverified(&self.manifest, &format!("other.{}.path", spec.id)),
        }
    }
}

#[async_trait]
impl AgentAdapter for ManifestAdapter {
    fn manifest(&self) -> &AgentManifest {
        &self.manifest
    }

    async fn detect(&self, ctx: &PlatformContext) -> Result<Option<Detection>> {
        let directories = search_dirs(ctx, &self.manifest);
        let Some(found) = platform::find_binary(&self.manifest.binaries.names, &directories) else {
            return Ok(None);
        };
        let candidates: Vec<Manager> = self
            .manifest
            .methods_for(ctx.os)
            .into_iter()
            .map(|method| method.manager)
            .filter(|manager| !matches!(manager, Manager::Manual))
            .collect();
        Ok(Some(Detection {
            manager: super::infer_manager(ctx, &found.path, &candidates),
            binary_path: found.path.to_string_lossy().to_string(),
            found_in: found.found_in,
        }))
    }

    async fn version(&self, _ctx: &PlatformContext, detection: &Detection) -> Option<Version> {
        let args = self.manifest.binaries.version_args.clone();
        if args.is_empty() {
            return None;
        }
        let output = platform::run_binary(&detection.binary_path, &args, VERSION_TIMEOUT)
            .await
            .ok()?;
        if output.timed_out {
            return None;
        }
        Version::from_output(output.best_text(), self.manifest.binaries.version_extract)
    }

    async fn config_files(&self, ctx: &PlatformContext) -> Result<Vec<ConfigFile>> {
        let mut files = Vec::new();
        for spec in &self.manifest.configs {
            match spec.glob.as_deref() {
                None => {
                    if let Some(path) = ctx.expand_map(&spec.path) {
                        files.push(self.config_entry(spec, path));
                    }
                }
                Some(glob) => {
                    for path in expand_glob(ctx, &spec.path, Some(glob), GlobTarget::Files, 3) {
                        files.push(self.config_entry(spec, path));
                    }
                }
            }
        }
        Ok(files)
    }

    async fn list_skills(&self, ctx: &PlatformContext) -> Result<Vec<Skill>> {
        if self.manifest.skills.is_empty() {
            return Ok(Vec::new());
        }
        let unverified = is_unverified(&self.manifest, "skills.path");
        let mut skills: Vec<Skill> = Vec::new();

        // Every declared location is read: a tool can keep skills in more than one directory
        // (Claude Code reads `.claude/skills` and `.agents/skills` in a project), and each of
        // them is a real directory the user can edit and delete.
        for spec in &self.manifest.skills {
            let mut found: Vec<Skill> = Vec::new();
            match spec.format {
                SkillFormat::SkillMd => {
                    let glob = spec.glob.as_deref().unwrap_or("**/SKILL.md");
                    // A switched-off skill is the same entry file with the disabled suffix, so the
                    // second pattern is the first one plus that suffix: the manifest names the entry
                    // file in the glob's last segment (`**/SKILL.md`, `{skills,skills-cursor}/*/SKILL.md`).
                    let disabled = disabled_name(glob);
                    let mut directories: Vec<PathBuf> = Vec::new();
                    for pattern in [glob, disabled.as_str()] {
                        for entry in
                            expand_glob(ctx, &spec.path, Some(pattern), GlobTarget::Files, 4)
                        {
                            let Some(directory) = entry.parent().map(Path::to_path_buf) else {
                                continue;
                            };
                            // An enabled entry wins over a leftover disabled copy in the same
                            // directory: `skill_entry` would report the enabled one anyway.
                            if !directories.contains(&directory) {
                                directories.push(directory);
                            }
                        }
                    }
                    for directory in directories {
                        if let Some(skill) =
                            self.skill_from_directory(&directory, spec.format, unverified)
                        {
                            found.push(skill);
                        }
                    }
                }
                SkillFormat::Directory => {
                    let glob = spec.glob.as_deref().unwrap_or("*");
                    for directory in
                        expand_glob(ctx, &spec.path, Some(glob), GlobTarget::Directories, 2)
                    {
                        if let Some(skill) =
                            self.skill_from_directory(&directory, spec.format, unverified)
                        {
                            found.push(skill);
                        }
                    }
                }
                SkillFormat::MarkdownFile => {
                    if let Some(path) = ctx.expand_map(&spec.path) {
                        let disabled = path.file_name().map(|name| {
                            path.with_file_name(disabled_name(&name.to_string_lossy()))
                        });
                        for (entry, enabled) in
                            [(path.clone(), true), (disabled.unwrap_or(path), false)]
                        {
                            if let Some(skill) = self.skill_from_file(&entry, enabled, unverified) {
                                found.push(skill);
                                break;
                            }
                        }
                    }
                }
            };
            skills.append(&mut found);
        }

        skills.sort_by_key(|a| a.name.to_lowercase());
        // The same directory can be declared twice (or reached through a symlink); a skill's id
        // is derived from its path, so identical entries collapse here.
        skills.dedup_by(|a, b| a.id == b.id);
        Ok(skills)
    }

    async fn list_mcp_servers(&self, ctx: &PlatformContext) -> Result<Vec<McpServer>> {
        let mut servers = Vec::new();
        for spec in self.mcp_specs() {
            servers.extend(self.read_mcp_spec(ctx, spec)?);
        }
        servers.sort_by_key(|a| a.name.to_lowercase());
        Ok(servers)
    }

    async fn list_other_resources(&self, ctx: &PlatformContext) -> Result<Vec<OtherResource>> {
        let mut resources = Vec::new();
        for spec in &self.manifest.other {
            match spec.glob.as_deref() {
                None => {
                    if let Some(path) = ctx.expand_map(&spec.path) {
                        resources.push(self.other_resource(spec, path, spec.label.clone()));
                    }
                }
                Some(glob) => {
                    for path in expand_glob(
                        ctx,
                        &spec.path,
                        Some(glob),
                        GlobTarget::Files,
                        OTHER_GLOB_DEPTH,
                    ) {
                        let stem = path
                            .file_stem()
                            .map(|stem| stem.to_string_lossy().to_string())
                            .unwrap_or_else(|| spec.label.clone());
                        let label = format!("{}: {stem}", spec.label);
                        resources.push(self.other_resource(spec, path, label));
                    }
                }
            }
        }
        Ok(resources)
    }

    async fn remove_skill(&self, ctx: &PlatformContext, skill: &Skill) -> Result<()> {
        let target = self.checked_skill_path(ctx, skill)?;

        trash::delete(&target).map_err(|error| {
            AppError::other(format!(
                "could not move {} to the trash: {error}",
                skill.path
            ))
        })?;
        Ok(())
    }

    /// Rename the skill's entry file so the agent stops seeing it, or rename it back.
    ///
    /// The agent looks the skill up by the exact file name (`SKILL.md`), so nothing else has to
    /// change and nothing is lost: the reverse rename is the whole operation.
    async fn set_skill_enabled(
        &self,
        ctx: &PlatformContext,
        skill: &Skill,
        enabled: bool,
    ) -> Result<()> {
        let directory = self.checked_skill_path(ctx, skill)?;
        let entry = skill
            .entry_path
            .as_deref()
            .map(PathBuf::from)
            .ok_or_else(|| {
                AppError::NotSupported("this skill has no entry file to switch".to_string())
            })?;
        if !entry.starts_with(&directory) || !entry.is_file() {
            return Err(AppError::NotFound(entry.to_string_lossy().to_string()));
        }

        // The name on disk decides the direction, so a stale report cannot turn a double click
        // into a rename back and forth.
        let name = entry
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let target_name = match name.strip_suffix(DISABLED_FILE_SUFFIX) {
            Some(base) if enabled => base.to_string(),
            Some(_) => return Ok(()),
            None if enabled => return Ok(()),
            None => disabled_name(&name),
        };

        let target = entry.with_file_name(&target_name);
        if target.exists() {
            return Err(AppError::InvalidInput(format!(
                "{} already exists",
                target.display()
            )));
        }
        std::fs::rename(&entry, &target).map_err(|error| AppError::io(&entry, error))?;
        Ok(())
    }

    async fn remove_mcp_server(&self, ctx: &PlatformContext, server: &McpServer) -> Result<()> {
        let (target, spec) = self.checked_mcp_target(ctx, server)?;
        let location = mcp_entry_location(&server.key_path, server.enabled)?;

        let content = platform::read_text(&target)?;
        let Some(updated) = doc_edit::remove_entry(spec.format, &content, &location)? else {
            return Err(AppError::NotFound(format!(
                "{} is no longer present in {}",
                doc_edit::describe_path(&location),
                server.source_config
            )));
        };
        doc_edit::validate(spec.format, &updated, &server.source_config)?;
        platform::write_atomic(&target, &updated, Some(&ctx.backup_root))?;
        Ok(())
    }

    /// Move the entry between the container the agent reads and its disabled sibling.
    async fn set_mcp_server_enabled(
        &self,
        ctx: &PlatformContext,
        server: &McpServer,
        enabled: bool,
    ) -> Result<()> {
        let (target, spec) = self.checked_mcp_target(ctx, server)?;
        if server.enabled == enabled {
            return Ok(());
        }

        let from = mcp_entry_location(&server.key_path, server.enabled)?;
        let to = mcp_entry_location(&server.key_path, enabled)?;
        let content = platform::read_text(&target)?;
        let Some(updated) = doc_edit::move_entry(spec.format, &content, &from, &to)? else {
            return Err(AppError::NotFound(format!(
                "{} is no longer present in {}",
                doc_edit::describe_path(&from),
                server.source_config
            )));
        };
        doc_edit::validate(spec.format, &updated, &server.source_config)?;
        platform::write_atomic(&target, &updated, Some(&ctx.backup_root))?;
        Ok(())
    }

    /// Write a new skill as `<skills dir>/<slug>/SKILL.md` with YAML frontmatter.
    ///
    /// This is the layout every skills-declaring manifest in the catalog reads, so the new
    /// skill is a first-class one from the moment it appears on disk: switchable, editable and
    /// deletable like any scanned skill.
    async fn create_skill(&self, ctx: &PlatformContext, draft: &SkillDraft) -> Result<Skill> {
        let (root, format) = self.writable_skills_root(ctx)?;
        let name = draft.name.trim();
        if name.is_empty() {
            return Err(AppError::InvalidInput("a skill needs a name".to_string()));
        }
        let slug = skill_slug(name);
        if slug.is_empty() {
            return Err(AppError::InvalidInput(
                "the skill name must contain at least one letter or digit".to_string(),
            ));
        }

        let directory = root.join(slug);
        if directory.exists() {
            return Err(AppError::InvalidInput(format!(
                "{} already exists",
                directory.display()
            )));
        }

        let entry = directory.join("SKILL.md");
        let content = render_skill(name, draft.description.as_deref(), draft.content.as_deref());
        platform::write_atomic(&entry, &content, Some(&ctx.backup_root))?;

        let unverified = is_unverified(&self.manifest, "skills.path");
        self.skill_from_directory(&directory, format, unverified)
            .ok_or_else(|| {
                AppError::other("the skill was written but could not be read back".to_string())
            })
    }

    /// Add a server to the MCP config file the manifest declares, at the `name -> server`
    /// position the reader uses.
    ///
    /// The missing file and the missing containers are created; an existing file keeps every
    /// comment and every byte that is not the new entry.
    async fn create_mcp_server(
        &self,
        ctx: &PlatformContext,
        draft: &McpServerDraft,
    ) -> Result<McpServer> {
        // A new server goes into the first declared MCP source — the same rule the skills
        // directory follows, so *which* file receives it is the manifest's own decision.
        let spec = self.manifest.mcp.first().ok_or_else(|| {
            AppError::NotSupported(format!(
                "{} does not declare an MCP config file",
                self.manifest.name
            ))
        })?;
        let name = draft.name.trim();
        if name.is_empty() {
            return Err(AppError::InvalidInput("a server needs a name".to_string()));
        }

        let target = self.mcp_target_file(ctx, spec)?;
        let source_config = target.to_string_lossy().to_string();
        let content = if target.is_file() {
            platform::read_text(&target)?
        } else {
            empty_document(spec.format).to_string()
        };

        // The container has to be a map keyed by name. An agent that keeps its servers in a
        // list (`goose`'s `extensions`, Continue's `mcpServers`, gptme's `[[mcp.servers]]`)
        // declares that shape in its manifest and is refused here, instead of getting an entry
        // no agent would read.
        if matches!(spec.entry_shape, McpEntryShape::List) {
            return Err(AppError::NotSupported(format!(
                "{} keeps its MCP servers in a list, which Ahabby can read but not extend",
                self.manifest.name
            )));
        }
        // Belt and braces: a manifest that forgets to declare a list container would otherwise
        // have a map written into it.
        let document = mcp_parse::document_to_value(spec.format, &content)?;
        if matches!(
            mcp_parse::value_at(&document, &spec.key_path),
            Some(serde_json::Value::Array(_))
        ) {
            return Err(AppError::NotSupported(format!(
                "{} stores its MCP servers as a list, which Ahabby cannot add to",
                self.manifest.name
            )));
        }
        // A name that is already taken — on or off — would silently shadow an existing entry
        // once the scan reads the file back.
        let mut containers = vec![spec.key_path.clone()];
        containers.extend(doc_edit::disabled_container(&spec.key_path));
        for container in containers {
            let taken = mcp_parse::value_at(&document, &container)
                .and_then(serde_json::Value::as_object)
                .is_some_and(|object| object.contains_key(name));
            if taken {
                return Err(AppError::InvalidInput(format!(
                    "'{name}' is already defined in {source_config}"
                )));
            }
        }

        let mut key_path = spec.key_path.clone();
        key_path.push(name.to_string());
        let updated = doc_edit::insert_entry(
            spec.format,
            &content,
            &key_path,
            &draft.transport.to_entry(spec.entry_shape),
        )?;
        doc_edit::validate(spec.format, &updated, &source_config)?;
        platform::write_atomic(&target, &updated, Some(&ctx.backup_root))?;

        self.read_mcp_file(spec, &target)?
            .into_iter()
            .find(|server| server.name == name)
            .ok_or_else(|| {
                AppError::other("the server was written but could not be read back".to_string())
            })
    }

    async fn install_plan(
        &self,
        ctx: &PlatformContext,
        action: InstallAction,
        method_id: Option<&str>,
    ) -> Result<InstallPlan> {
        plan_for(&self.manifest, ctx, action, method_id)
    }
}

/// Resolve an install/update/uninstall command for the current machine.
pub fn plan_for(
    manifest: &AgentManifest,
    ctx: &PlatformContext,
    action: InstallAction,
    method_id: Option<&str>,
) -> Result<InstallPlan> {
    let methods = manifest.methods_for(ctx.os);
    if methods.is_empty() {
        return Err(AppError::NoInstallMethod {
            agent: manifest.name.clone(),
        });
    }

    let requires_uninstall = action == InstallAction::Uninstall;
    let available = |method: &crate::domain::InstallMethodSpec| -> (bool, Option<String>) {
        match method.manager {
            Manager::Manual => (false, Some("manual installation only".to_string())),
            Manager::Script => (true, None),
            manager => match platform::packages::lookup(manager, &[]) {
                Some(found) => (true, Some(found.path)),
                None => (
                    false,
                    Some(format!(
                        "{} is not installed",
                        manager.binary().unwrap_or("the package manager")
                    )),
                ),
            },
        }
    };

    let selected = match method_id {
        Some(id) => methods
            .iter()
            .find(|method| method.id == id)
            .cloned()
            .ok_or_else(|| {
                AppError::InvalidInput(format!("{} has no install method '{id}'", manifest.name))
            })?,
        None => {
            let candidates: Vec<_> = methods
                .iter()
                .filter(|method| method.manager != Manager::Manual)
                .filter(|method| !requires_uninstall || method.uninstall_command.is_some())
                .collect();
            let chosen = candidates
                .iter()
                .find(|method| available(method).0)
                .or_else(|| candidates.first())
                .ok_or_else(|| AppError::NoInstallMethod {
                    agent: manifest.name.clone(),
                })?;
            (*chosen).clone()
        }
    };

    let (manager_available, reason) = available(&selected);
    let mut warnings = Vec::new();
    if let Some(reason) = &reason {
        warnings.push(reason.clone());
    }
    for requirement in &selected.requires {
        warnings.push(format!("requires {requirement}"));
    }

    let command = match action {
        InstallAction::Install => selected.command.clone(),
        InstallAction::Update => selected.effective_update_command().to_string(),
        InstallAction::Uninstall => selected.uninstall_command.clone().ok_or_else(|| {
            AppError::NotSupported(format!(
                "{} cannot be uninstalled with {}",
                manifest.name, selected.id
            ))
        })?,
    };

    let (program, args, uses_shell) = if selected.manager == Manager::Manual {
        return Err(AppError::NoInstallMethod {
            agent: manifest.name.clone(),
        });
    } else if selected.manager == Manager::Script {
        let (program, args) = platform::shell_invocation(ctx.os, &command);
        (program, args, true)
    } else {
        let tokens = crate::domain::manifest::split_command(&command);
        let mut tokens = tokens.into_iter();
        let program = tokens.next().ok_or_else(|| {
            AppError::InvalidInput(format!(
                "install method '{}' has an empty command",
                selected.id
            ))
        })?;
        (program, tokens.collect::<Vec<String>>(), false)
    };

    Ok(InstallPlan {
        agent_id: manifest.id.clone(),
        agent_name: manifest.name.clone(),
        action,
        method_id: selected.id.clone(),
        manager: selected.manager,
        program,
        args,
        display_command: command,
        uses_shell,
        manager_available,
        warnings,
        target_os: ctx.os,
    })
}
