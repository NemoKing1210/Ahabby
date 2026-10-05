//! The default adapter: everything is driven by the manifest.
//!
//! If an agent can be described as "a binary, some config files, a skills directory and
//! an MCP map under a key path", it needs no Rust code at all — only TOML.

use std::path::{Path, PathBuf};

use async_trait::async_trait;

use crate::domain::{
    AgentManifest, ConfigFile, ConfigSpec, Detection, InstallAction, InstallPlan, Manager,
    McpServer, McpSpec, OtherResource, OtherSpec, Scope, Skill, SkillFormat, Version,
};
use crate::error::{AppError, Result};
use crate::platform::{self, PlatformContext};

use super::doc_edit;
use super::frontmatter;
use super::mcp_parse;
use super::{
    expand_glob, is_unverified, search_dirs, AgentAdapter, GlobTarget, PREVIEW_LIMIT_BYTES,
    VERSION_TIMEOUT,
};

const SKILL_FILE_NAMES: &[&str] = &["SKILL.md", "skill.md", "README.md", "readme.md"];
const OTHER_GLOB_DEPTH: usize = 3;

pub struct ManifestAdapter {
    manifest: AgentManifest,
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
        Self { manifest }
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

        let entry = match format {
            SkillFormat::SkillMd => directory.join("SKILL.md"),
            SkillFormat::Directory => SKILL_FILE_NAMES
                .iter()
                .map(|name| directory.join(name))
                .find(|candidate| candidate.is_file())?,
            SkillFormat::MarkdownFile => return None,
        };
        if !entry.is_file() {
            return None;
        }

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
            removable: true,
            unverified,
        })
    }

    /// A single markdown file that holds "the" instructions of an agent.
    fn skill_from_file(&self, path: &Path, unverified: bool) -> Option<Skill> {
        if !path.is_file() {
            return None;
        }
        let metadata = std::fs::metadata(path).ok();
        let size = metadata.as_ref().map(std::fs::Metadata::len);
        let text = platform::read_text(path).ok()?;
        let markdown = frontmatter::parse(&text);
        let name = markdown.name.clone().unwrap_or_else(|| {
            path.file_stem()
                .map(|stem| stem.to_string_lossy().to_string())
                .unwrap_or_else(|| "instructions".to_string())
        });
        Some(Skill {
            id: Skill::new_id(&name, &path.to_string_lossy()),
            name,
            description: markdown.summary(),
            path: path.to_string_lossy().to_string(),
            entry_path: Some(path.to_string_lossy().to_string()),
            scope: Scope::Global,
            agents: vec![self.agent_ref()],
            frontmatter: markdown.frontmatter.clone(),
            content: Some(markdown.body.clone()).filter(|body| !body.trim().is_empty()),
            size_bytes: size,
            created_ms: metadata.as_ref().and_then(platform::created_at_ms),
            modified_ms: metadata.as_ref().and_then(platform::modified_at_ms),
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
        let Some(map) = mcp_parse::value_at(&document, &spec.key_path) else {
            return Ok(Vec::new());
        };

        // Most agents store `name -> server`, but some (Continue) store an array of
        // servers that carry their own `name`. Removal is only supported for the map
        // shape, because only there is the entry addressable by key.
        let entries: Vec<(String, &serde_json::Value)> = match map {
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
            _ => return Ok(Vec::new()),
        };
        let addressable = map.is_object();

        let unverified = is_unverified(&self.manifest, "mcp.key_path");
        let mut servers = Vec::new();
        for (name, value) in entries {
            let normalized = mcp_parse::normalize(value);
            let mut key_path = spec.key_path.clone();
            key_path.push(name.clone());
            servers.push(McpServer {
                id: McpServer::new_id(&name, &source_config, &key_path),
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
                removable: addressable,
                unverified,
            });
        }
        Ok(servers)
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
        let Some(spec) = &self.manifest.skills else {
            return Ok(Vec::new());
        };
        let unverified = is_unverified(&self.manifest, "skills.path");
        let mut skills = Vec::new();

        match spec.format {
            SkillFormat::SkillMd => {
                let glob = spec.glob.as_deref().unwrap_or("**/SKILL.md");
                for entry in expand_glob(ctx, &spec.path, Some(glob), GlobTarget::Files, 4) {
                    let Some(directory) = entry.parent() else {
                        continue;
                    };
                    if let Some(skill) =
                        self.skill_from_directory(directory, spec.format, unverified)
                    {
                        skills.push(skill);
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
                        skills.push(skill);
                    }
                }
            }
            SkillFormat::MarkdownFile => {
                if let Some(path) = ctx.expand_map(&spec.path) {
                    if let Some(skill) = self.skill_from_file(&path, unverified) {
                        skills.push(skill);
                    }
                }
            }
        }

        skills.sort_by_key(|a| a.name.to_lowercase());
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
        if !skill
            .agents
            .iter()
            .any(|agent| agent.id == self.manifest.id)
        {
            return Err(AppError::InvalidInput(
                "this skill belongs to a different agent".to_string(),
            ));
        }
        if !skill.removable {
            return Err(AppError::NotSupported(
                "this skill is a shared document and cannot be deleted from Ahabby".to_string(),
            ));
        }

        // The path must live under a skills directory the manifest declared.
        let allowed: Vec<PathBuf> = self
            .manifest
            .skills
            .as_ref()
            .and_then(|spec| ctx.expand_map(&spec.path))
            .into_iter()
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

        trash::delete(&target).map_err(|error| {
            AppError::other(format!(
                "could not move {} to the trash: {error}",
                skill.path
            ))
        })?;
        Ok(())
    }

    async fn remove_mcp_server(&self, ctx: &PlatformContext, server: &McpServer) -> Result<()> {
        if server.agent.id != self.manifest.id {
            return Err(AppError::InvalidInput(
                "this MCP server belongs to a different agent".to_string(),
            ));
        }
        if !server.removable {
            return Err(AppError::NotSupported(
                "this MCP server cannot be removed from Ahabby".to_string(),
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

        let content = platform::read_text(&target)?;
        let Some(updated) = doc_edit::remove_entry(spec.format, &content, &server.key_path)? else {
            return Err(AppError::NotFound(format!(
                "{} is no longer present in {}",
                doc_edit::describe_path(&server.key_path),
                server.source_config
            )));
        };
        doc_edit::validate(spec.format, &updated, &server.source_config)?;
        platform::write_atomic(&target, &updated, Some(&ctx.backup_root))?;
        Ok(())
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
