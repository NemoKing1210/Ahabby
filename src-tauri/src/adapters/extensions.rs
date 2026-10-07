//! The extensions an agent loads.
//!
//! One format exists so far — Pi's — and it reads from two places at once: the `packages` list of
//! a JSON settings document (npm, git and local packages, each with its own on-disk root) and the
//! module files of the extensions directory. Keeping both in one module means the scan, the
//! removal, the on/off switch and the update all describe the same layout.
//!
//! The layout itself comes from Pi: `pi install` writes a declaration into the settings document
//! and unpacks npm sources under `<agent dir>/npm/node_modules/<name>`, git sources under
//! `<agent dir>/git/<host>/<path>`; the extensions directory holds `.ts`/`.js` files and
//! directories with an `index.ts`, an `index.js` or a `pi.extensions` manifest.

use std::path::{Path, PathBuf};

use globset::Glob;
use serde_json::Value;

use crate::adapters::search_dirs;
use crate::domain::{
    AgentManifest, AgentRef, Extension, ExtensionAction, ExtensionKind, ExtensionManager,
    ExtensionResources, ExtensionSpec, InstallAction, InstallPlan, Manager, Scope,
};
use crate::error::{AppError, Result};
use crate::platform::{self, PlatformContext};

/// Suffix a switched-off entry file carries. The agent only matches `.ts`/`.js`, so renaming the
/// entry aside is the whole switch — the same convention a skill's `SKILL.md` uses.
const DISABLED_SUFFIX: &str = ".disabled";

/// Entry files an extension directory is loaded from.
const ENTRY_FILES: [&str; 2] = ["index.ts", "index.js"];

/// Keys that turn a string into a git source when they are not prefixed with `git:`.
const GIT_PREFIXES: [&str; 5] = ["https://", "http://", "ssh://", "git://", "git@"];

/// The part of `settings.json` this reader needs.
#[derive(Default)]
struct PiSettings {
    /// Raw `packages` entries: a source string, or an object with a `source`.
    packages: Vec<Value>,
    /// The `extensions` list: explicit paths plus the `+`/`-`/`!` on/off overrides.
    extensions: Vec<String>,
}

/// What every row of one extensions surface shares: whose it is, where its files live, and what
/// the settings switch off.
struct ReadScope<'a> {
    agent: &'a AgentRef,
    surface: &'a str,
    base: &'a Path,
    overrides: &'a [String],
    unverified: bool,
}

/// Read one agent's extensions, in the order they are shown: packages, local modules, built-ins.
pub fn read(
    ctx: &PlatformContext,
    spec: &ExtensionSpec,
    agent: &AgentRef,
    unverified: bool,
) -> Result<Vec<Extension>> {
    let Some(root) = ctx.expand_map(&spec.path) else {
        return Ok(Vec::new());
    };
    let settings_path = spec.settings.as_ref().and_then(|map| ctx.expand_map(map));
    let settings = match settings_path.as_deref() {
        Some(path) => read_settings(path)?,
        None => PiSettings::default(),
    };
    // Packages are declared relative to the agent directory, which is the parent of the
    // extensions directory it is read from.
    let base = root.parent().map(Path::to_path_buf).unwrap_or(root.clone());

    let scope = ReadScope {
        agent,
        surface: &spec.id,
        base: &base,
        overrides: &settings.extensions,
        unverified,
    };

    let mut extensions: Vec<Extension> = Vec::new();
    for raw in &settings.packages {
        if let Some(extension) = package_extension(raw, ctx, &scope) {
            extensions.push(extension);
        }
    }
    extensions.extend(local_extensions(&root, &scope));
    extensions.extend(builtins(spec, &scope));

    extensions.sort_by_key(|extension| extension.name.to_lowercase());
    // The same file can be reached twice (a symlink, or a directory that is also a package root);
    // an extension's id is derived from its path, so identical rows collapse here.
    extensions.dedup_by(|a, b| a.id == b.id);
    Ok(extensions)
}

fn read_settings(path: &Path) -> Result<PiSettings> {
    if !path.is_file() {
        return Ok(PiSettings::default());
    }
    let raw = platform::read_text(path)?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|error| AppError::invalid_format("json", path, error.to_string()))?;
    let packages = value
        .get("packages")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let extensions = string_list(value.get("extensions"));
    Ok(PiSettings {
        packages,
        extensions,
    })
}

/// The strings of a JSON array field, ignoring anything else in it.
fn string_list(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default()
}

// --- packages ------------------------------------------------------------------------------

/// One `packages` entry as an extension row, or `None` when it is not a usable declaration.
fn package_extension(
    raw: &Value,
    ctx: &PlatformContext,
    scope: &ReadScope<'_>,
) -> Option<Extension> {
    let source = match raw {
        Value::String(source) => source.trim().to_string(),
        Value::Object(object) => object.get("source")?.as_str()?.trim().to_string(),
        _ => return None,
    };
    if source.is_empty() {
        return None;
    }
    let (manager, key, directory) = resolve_package(&source, scope.base, ctx)?;
    let installed = directory.is_dir();
    let metadata = installed
        .then(|| read_json(&directory.join("package.json")))
        .flatten();
    let display_name = metadata
        .as_ref()
        .and_then(|pkg| pkg.get("name"))
        .and_then(Value::as_str)
        .map(str::to_string)
        .unwrap_or_else(|| key.clone());

    Some(Extension {
        id: Extension::new_id(ExtensionKind::Package, &key),
        surface: scope.surface.to_string(),
        name: display_name,
        description: metadata
            .as_ref()
            .and_then(|pkg| text_field(pkg, "description")),
        kind: ExtensionKind::Package,
        manager: Some(manager),
        source: source.clone(),
        path: installed.then(|| directory.display().to_string()),
        entry_path: None,
        version: metadata.as_ref().and_then(|pkg| text_field(pkg, "version")),
        author: metadata
            .as_ref()
            .and_then(|pkg| person_field(pkg, "author")),
        homepage: metadata
            .as_ref()
            .and_then(|pkg| text_field(pkg, "homepage")),
        repository: metadata
            .as_ref()
            .and_then(|pkg| person_field(pkg, "repository")),
        license: metadata.as_ref().and_then(licence_field),
        enabled: true,
        can_update: true,
        can_remove: true,
        can_toggle: false,
        scope: Scope::Global,
        agent: scope.agent.clone(),
        resources: metadata.as_ref().map(resource_counts).unwrap_or_default(),
        unverified: scope.unverified,
        modified_ms: installed
            .then(|| std::fs::metadata(directory.join("package.json")).ok())
            .flatten()
            .map(|metadata| platform::metadata_ms(&metadata)),
    })
}

/// Where a source lives on disk, plus the stable key its id is derived from.
///
/// The key never carries a version or a git ref: bumping a pin must not turn the row into a new
/// extension, because the user is looking at the same package.
fn resolve_package(
    source: &str,
    base: &Path,
    ctx: &PlatformContext,
) -> Option<(ExtensionManager, String, PathBuf)> {
    if let Some(spec) = source.strip_prefix("npm:") {
        let name = crate::domain::manifest::strip_version_suffix(spec.trim());
        // A scoped name contains a slash (`@scope/pkg`); joining it as one segment would leave a
        // separator the platform does not expect.
        let directory = name
            .split('/')
            .fold(base.join("npm").join("node_modules"), |parent, part| {
                parent.join(part)
            });
        return Some((ExtensionManager::Npm, format!("npm:{name}"), directory));
    }
    if let Some(rest) = source.strip_prefix("git:") {
        let (host, path) = git_location(rest)?;
        let directory = base.join("git").join(&host).join(&path);
        return Some((
            ExtensionManager::Git,
            format!("git:{host}/{path}"),
            directory,
        ));
    }
    if GIT_PREFIXES.iter().any(|prefix| source.starts_with(prefix)) {
        let (host, path) = git_location(source)?;
        let directory = base.join("git").join(&host).join(&path);
        return Some((
            ExtensionManager::Git,
            format!("git:{host}/{path}"),
            directory,
        ));
    }

    // A local source is a path, relative to the settings document that declares it; `~` and
    // `${VAR}` are the same placeholders every other manifest path uses.
    let expanded = if source.contains("${") || source.starts_with('~') {
        ctx.expand(source)
    } else if Path::new(source).is_absolute() {
        Some(PathBuf::from(source))
    } else {
        Some(base.join(source))
    }?;
    let key = expanded.display().to_string();
    Some((ExtensionManager::Local, key, expanded))
}

/// `github.com/example/pi-tools@v1` → host `github.com`, repository `example/pi-tools`.
fn git_location(raw: &str) -> Option<(String, String)> {
    let body = raw.trim().trim_end_matches('/');
    // A ref follows the last `@`, unless that `@` is the one in `git@host:path`.
    let without_ref = match body.rfind('@') {
        Some(index) if index > body.rfind('/').unwrap_or(0) => &body[..index],
        _ => body,
    };
    let stripped = without_ref
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_start_matches("ssh://")
        .trim_start_matches("git://");
    let stripped = match stripped.strip_prefix("git@") {
        Some(rest) => rest.replacen(':', "/", 1),
        None => stripped.to_string(),
    };
    let mut parts = stripped.splitn(2, '/');
    let host = parts.next()?.trim().to_string();
    let path = parts.next()?.trim().trim_end_matches(".git").to_string();
    if host.is_empty() || path.is_empty() {
        return None;
    }
    Some((host, path))
}

/// What a package ships, read from its own `pi` manifest.
///
/// The conventional directories are not counted: Pi walks them recursively at load time, and a
/// number a scan guessed would be worse than no number at all.
fn resource_counts(package: &Value) -> ExtensionResources {
    let counted = |key: &str| -> u32 {
        package
            .get("pi")
            .and_then(|pi| pi.get(key))
            .and_then(Value::as_array)
            .map(|entries| entries.len() as u32)
            .unwrap_or(0)
    };
    ExtensionResources {
        extensions: counted("extensions"),
        skills: counted("skills"),
        prompts: counted("prompts"),
        themes: counted("themes"),
    }
}

// --- local modules -------------------------------------------------------------------------

/// The modules found in the extensions directory (or the directory itself, when it is a package).
fn local_extensions(root: &Path, scope: &ReadScope<'_>) -> Vec<Extension> {
    if !root.is_dir() {
        return Vec::new();
    }
    // A directory that is itself a package (an `index.ts`, or a `pi.extensions` manifest) is one
    // extension, not a collection of files.
    if let Some((entry, enabled)) = directory_entry(root) {
        return vec![local_extension(root, &entry, enabled, scope)];
    }

    let mut found = Vec::new();
    let Ok(entries) = std::fs::read_dir(root) else {
        return found;
    };
    let mut children: Vec<PathBuf> = entries
        .filter_map(|entry| entry.ok())
        .map(|e| e.path())
        .collect();
    children.sort();

    for child in children {
        let name = child
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        if name.starts_with('.') || name == "node_modules" {
            continue;
        }
        if child.is_dir() {
            if let Some((entry, enabled)) = directory_entry(&child) {
                found.push(local_extension(&child, &entry, enabled, scope));
            }
            continue;
        }
        if !child.is_file() {
            continue;
        }
        let (entry, enabled) = match name.strip_suffix(DISABLED_SUFFIX) {
            Some(base_name) if is_extension_file(base_name) => (child.clone(), false),
            Some(_) => continue,
            None if is_extension_file(&name) => (child.clone(), true),
            None => continue,
        };
        found.push(local_extension(&child, &entry, enabled, scope));
    }
    found
}

fn is_extension_file(name: &str) -> bool {
    name.ends_with(".ts") || name.ends_with(".js")
}

/// The entry file a directory is loaded from, and whether it is switched on.
fn directory_entry(directory: &Path) -> Option<(PathBuf, bool)> {
    if let Some(package) = read_json(&directory.join("package.json")) {
        let declared = package
            .get("pi")
            .and_then(|pi| pi.get("extensions"))
            .and_then(Value::as_array);
        for raw in declared.into_iter().flatten() {
            let Some(relative) = raw.as_str() else {
                continue;
            };
            let candidate = resolve_relative(directory, relative);
            if candidate.is_file() {
                return Some((candidate, true));
            }
            let disabled = disabled_path(&candidate);
            if disabled.is_file() {
                return Some((disabled, false));
            }
        }
    }
    for name in ENTRY_FILES {
        let file = directory.join(name);
        if file.is_file() {
            return Some((file, true));
        }
        let disabled = directory.join(format!("{name}{DISABLED_SUFFIX}"));
        if disabled.is_file() {
            return Some((disabled, false));
        }
    }
    None
}

fn local_extension(
    unit: &Path,
    entry: &Path,
    on_disk_enabled: bool,
    scope: &ReadScope<'_>,
) -> Extension {
    let metadata = unit
        .is_dir()
        .then(|| read_json(&unit.join("package.json")))
        .flatten();
    let name = metadata
        .as_ref()
        .and_then(|package| text_field(package, "name"))
        .or_else(|| {
            unit.file_name()
                .map(|name| name.to_string_lossy().to_string())
        })
        .map(|name| match name.strip_suffix(DISABLED_SUFFIX) {
            Some(base) => base.to_string(),
            None => name,
        })
        .unwrap_or_else(|| "extension".to_string());
    let label = if unit.is_dir() {
        name
    } else {
        // A module file is named by its stem: `hello.ts` is the extension "hello".
        match name.rsplit_once('.') {
            Some((stem, extension)) if is_extension_file(&format!("x.{extension}")) => {
                stem.to_string()
            }
            _ => name,
        }
    };

    Extension {
        id: Extension::new_id(
            ExtensionKind::Local,
            // The id must not move when the switch flips, so it is derived from the entry file's
            // real name rather than from the renamed one on disk.
            &without_disabled_suffix(unit).display().to_string(),
        ),
        surface: scope.surface.to_string(),
        name: label,
        description: metadata
            .as_ref()
            .and_then(|package| text_field(package, "description")),
        kind: ExtensionKind::Local,
        manager: None,
        source: unit.display().to_string(),
        path: Some(unit.display().to_string()),
        entry_path: Some(entry.display().to_string()),
        version: metadata
            .as_ref()
            .and_then(|package| text_field(package, "version")),
        author: metadata
            .as_ref()
            .and_then(|package| person_field(package, "author")),
        homepage: metadata
            .as_ref()
            .and_then(|package| text_field(package, "homepage")),
        repository: metadata
            .as_ref()
            .and_then(|package| person_field(package, "repository")),
        license: metadata.as_ref().and_then(licence_field),
        enabled: on_disk_enabled && !disabled_by_overrides(unit, scope.overrides, scope.base),
        can_update: false,
        can_remove: true,
        can_toggle: entry.is_file(),
        scope: Scope::Global,
        agent: scope.agent.clone(),
        resources: ExtensionResources::default(),
        unverified: scope.unverified,
        modified_ms: std::fs::metadata(entry)
            .ok()
            .map(|metadata| platform::metadata_ms(&metadata)),
    }
}

/// Whether the settings document switches a discovered path off.
///
/// Pi's own `pi config` writes `-<path>` (or `!<pattern>`) entries into the `extensions` list, so a
/// resource it disabled must not look enabled here.
fn disabled_by_overrides(path: &Path, patterns: &[String], base_dir: &Path) -> bool {
    let overrides: Vec<&String> = patterns
        .iter()
        .filter(|pattern| {
            let pattern = pattern.trim();
            pattern.starts_with('!') || pattern.starts_with('+') || pattern.starts_with('-')
        })
        .collect();
    if overrides.is_empty() {
        return false;
    }
    let relative = posix_relative(base_dir, path);
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let absolute = posix(path);
    let mut enabled = true;
    for raw in overrides {
        let raw = raw.trim();
        let (kind, pattern) = raw.split_at(1);
        let pattern = pattern.trim_start_matches("./").replace('\\', "/");
        let matched = match kind {
            "!" => {
                glob_matches(&pattern, &relative)
                    || glob_matches(&pattern, &name)
                    || glob_matches(&pattern, &absolute)
            }
            _ => relative == pattern || name == pattern || absolute == pattern,
        };
        if matched {
            enabled = kind == "+";
        }
    }
    !enabled
}

fn glob_matches(pattern: &str, value: &str) -> bool {
    Glob::new(pattern)
        .map(|glob| glob.compile_matcher().is_match(value))
        .unwrap_or(false)
}

fn posix(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn posix_relative(base: &Path, path: &Path) -> String {
    path.strip_prefix(base)
        .map(posix)
        .unwrap_or_else(|_| posix(path))
}

// --- built-ins -----------------------------------------------------------------------------

fn builtins(spec: &ExtensionSpec, scope: &ReadScope<'_>) -> Vec<Extension> {
    spec.builtins
        .iter()
        .map(|name| {
            let source = format!("builtin:{name}");
            Extension {
                id: Extension::new_id(ExtensionKind::Builtin, &source),
                surface: scope.surface.to_string(),
                name: name.clone(),
                description: None,
                kind: ExtensionKind::Builtin,
                manager: None,
                source: source.clone(),
                path: None,
                entry_path: None,
                version: None,
                author: None,
                homepage: None,
                repository: None,
                license: None,
                enabled: !disabled_by_overrides(Path::new(&source), scope.overrides, Path::new("")),
                can_update: false,
                can_remove: false,
                can_toggle: false,
                scope: Scope::Global,
                agent: scope.agent.clone(),
                resources: ExtensionResources::default(),
                unverified: false,
                modified_ms: None,
            }
        })
        .collect()
}

// --- guarded actions -----------------------------------------------------------------------

/// The file or directory of an extension this manifest may change, after every guard: it must
/// belong to this owner, be one Ahabby is allowed to act on, live inside the declared extensions
/// directory, and still exist.
pub fn checked_unit(
    ctx: &PlatformContext,
    spec: &ExtensionSpec,
    owner: &str,
    extension: &Extension,
) -> Result<PathBuf> {
    if extension.agent.id != owner {
        return Err(AppError::InvalidInput(
            "this extension belongs to a different owner".to_string(),
        ));
    }
    if !extension.can_remove && !extension.can_toggle {
        return Err(AppError::NotSupported(format!(
            "{} cannot be changed from Ahabby",
            extension.name
        )));
    }
    let target = extension
        .path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| AppError::NotSupported("this extension has no files on disk".to_string()))?;
    let Some(root) = ctx.expand_map(&spec.path) else {
        return Err(AppError::CommandNotAllowed(format!(
            "the extensions directory declared by {} is not available",
            owner
        )));
    };
    if !target.starts_with(&root) {
        return Err(AppError::CommandNotAllowed(format!(
            "{} is outside the extensions directory declared by {owner}",
            target.display()
        )));
    }
    if !target.exists() {
        return Err(AppError::NotFound(extension.source.clone()));
    }
    Ok(target)
}

/// Move a local extension to the OS trash. Packages are removed through the agent's own CLI, so
/// they never reach this path.
pub fn remove(
    ctx: &PlatformContext,
    spec: &ExtensionSpec,
    owner: &str,
    extension: &Extension,
) -> Result<()> {
    if extension.kind != ExtensionKind::Local {
        return Err(AppError::NotSupported(
            "only a local extension can be removed by deleting its files".to_string(),
        ));
    }
    let target = checked_unit(ctx, spec, owner, extension)?;
    trash::delete(&target).map_err(|error| {
        AppError::other(format!(
            "could not move {} to the trash: {error}",
            target.display()
        ))
    })?;
    Ok(())
}

/// Rename the entry file aside (or back), which is all the agent needs to stop loading it.
pub fn set_enabled(
    ctx: &PlatformContext,
    spec: &ExtensionSpec,
    owner: &str,
    extension: &Extension,
    enabled: bool,
) -> Result<()> {
    if extension.kind != ExtensionKind::Local {
        return Err(AppError::NotSupported(
            "only a local extension can be switched off from Ahabby".to_string(),
        ));
    }
    let unit = checked_unit(ctx, spec, owner, extension)?;
    let entry = extension
        .entry_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| {
            AppError::NotSupported("this extension has no entry file to switch".to_string())
        })?;
    if !entry.starts_with(&unit) || !entry.is_file() {
        return Err(AppError::NotFound(entry.to_string_lossy().to_string()));
    }

    // The name on disk decides the direction, so a stale report cannot turn a double click into a
    // rename back and forth.
    let name = entry
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_default();
    let target_name = match name.strip_suffix(DISABLED_SUFFIX) {
        Some(base) if enabled => base.to_string(),
        Some(_) => return Ok(()),
        None if enabled => return Ok(()),
        None => format!("{name}{DISABLED_SUFFIX}"),
    };
    let target = entry.with_file_name(target_name);
    if target.exists() {
        return Err(AppError::InvalidInput(format!(
            "{} already exists",
            target.display()
        )));
    }
    std::fs::rename(&entry, &target).map_err(|error| AppError::io(&entry, error))?;
    Ok(())
}

/// Resolve the command the agent's own CLI runs for one package.
///
/// The frontend sends an extension id and an action, never a command line: the source comes from
/// the last scan and the program from the detected binary, exactly like an install plan.
pub fn plan(
    ctx: &PlatformContext,
    manifest: &AgentManifest,
    extension: &Extension,
    action: ExtensionAction,
) -> Result<InstallPlan> {
    if extension.kind != ExtensionKind::Package {
        return Err(AppError::NotSupported(
            "only a package can be updated or removed through the agent".to_string(),
        ));
    }
    if extension.source.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "this package has no source to resolve".to_string(),
        ));
    }
    let lookup = platform::find_binary(&manifest.binaries.names, &search_dirs(ctx, manifest))
        .ok_or_else(|| {
            AppError::NotFound(format!(
                "the {} executable; it is needed to manage packages",
                manifest.name
            ))
        })?;
    let (word, plan_action) = match action {
        ExtensionAction::Update => ("update", InstallAction::Update),
        ExtensionAction::Remove => ("remove", InstallAction::Uninstall),
    };
    let program_name = lookup
        .path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .unwrap_or_else(|| manifest.binaries.names[0].clone());

    Ok(InstallPlan {
        agent_id: manifest.id.clone(),
        agent_name: manifest.name.clone(),
        action: plan_action,
        method_id: extension.id.clone(),
        // The agent's own CLI is what runs, not a package manager Ahabby has to find first.
        // `manager_available` is true because the binary was just located.
        manager: Manager::Script,
        program: lookup.path.display().to_string(),
        args: vec![word.to_string(), extension.source.clone()],
        display_command: format!("{program_name} {word} {}", extension.source),
        uses_shell: false,
        manager_available: true,
        warnings: Vec::new(),
        target_os: ctx.os,
    })
}

// --- small helpers -------------------------------------------------------------------------

fn read_json(path: &Path) -> Option<Value> {
    let raw = std::fs::read_to_string(path).ok()?;
    serde_json::from_str(&raw).ok()
}

fn text_field(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|text| !text.is_empty())
        .map(str::to_string)
}

/// `author`, `repository` and friends are either a string or an object with a `name`/`url`.
fn person_field(value: &Value, key: &str) -> Option<String> {
    let field = value.get(key)?;
    if let Some(text) = field.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }
    for nested in ["name", "url"] {
        if let Some(text) = field.get(nested).and_then(Value::as_str) {
            let text = text.trim();
            if !text.is_empty() {
                return Some(text.to_string());
            }
        }
    }
    None
}

fn licence_field(value: &Value) -> Option<String> {
    let field = value.get("license")?;
    if let Some(text) = field.as_str() {
        let text = text.trim();
        return (!text.is_empty()).then(|| text.to_string());
    }
    field
        .get("type")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn resolve_relative(directory: &Path, relative: &str) -> PathBuf {
    let relative = relative.trim().trim_start_matches("./");
    directory.join(relative)
}

fn disabled_path(path: &Path) -> PathBuf {
    PathBuf::from(format!("{}{DISABLED_SUFFIX}", path.display()))
}

/// `hello.ts.disabled` → `hello.ts`; a path without the suffix is returned unchanged.
fn without_disabled_suffix(path: &Path) -> PathBuf {
    let Some(name) = path
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
    else {
        return path.to_path_buf();
    };
    match name.strip_suffix(DISABLED_SUFFIX) {
        Some(base) => path.with_file_name(base),
        None => path.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{ExtensionFormat, Os, OsPathMap};
    use crate::platform::PlatformContext;

    fn context(root: &Path) -> PlatformContext {
        PlatformContext::for_tests(Os::Linux, root, root, root)
    }

    fn pi_spec(root: &Path) -> ExtensionSpec {
        let path = OsPathMap {
            linux: Some(root.join("agent/extensions").display().to_string()),
            ..Default::default()
        };
        ExtensionSpec {
            id: "extensions".to_string(),
            format: ExtensionFormat::Pi,
            path,
            settings: Some(OsPathMap {
                linux: Some(root.join("agent/settings.json").display().to_string()),
                ..Default::default()
            }),
            builtins: vec!["codemode".to_string()],
            description: None,
        }
    }

    fn agent_ref() -> AgentRef {
        AgentRef {
            id: "pi".to_string(),
            name: "Pi".to_string(),
            icon: None,
        }
    }

    fn write(path: &Path, content: &str) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, content).unwrap();
    }

    #[test]
    fn reads_packages_modules_and_builtins() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let agent_dir = root.join("agent");
        let spec = pi_spec(root);

        write(
            &agent_dir.join("settings.json"),
            r#"{ "packages": ["npm:pi-lens@4.3.0", "./tools/pi-ext"], "extensions": ["-extensions/off.ts"] }"#,
        );
        write(
            &agent_dir.join("npm/node_modules/pi-lens/package.json"),
            r#"{ "name": "pi-lens", "version": "4.3.0", "description": "Linters for pi",
                 "author": { "name": "apmantza" }, "repository": { "url": "https://github.com/apmantza/pi-lens" },
                 "license": "MIT", "pi": { "extensions": ["./src/index.ts"], "skills": ["./skills"] } }"#,
        );
        write(
            &agent_dir.join("extensions/hello.ts"),
            "export default () => {}\n",
        );
        write(
            &agent_dir.join("extensions/off.ts.disabled"),
            "export default () => {}\n",
        );
        write(
            &agent_dir.join("extensions/tool/index.ts"),
            "export default () => {}\n",
        );

        let ctx = context(root);
        let found = read(&ctx, &spec, &agent_ref(), false).unwrap();
        let names: Vec<&str> = found.iter().map(|e| e.name.as_str()).collect();

        let lens = found.iter().find(|e| e.name == "pi-lens").unwrap();
        assert_eq!(lens.kind, ExtensionKind::Package);
        assert_eq!(lens.manager, Some(ExtensionManager::Npm));
        assert_eq!(lens.version.as_deref(), Some("4.3.0"));
        assert_eq!(lens.author.as_deref(), Some("apmantza"));
        assert_eq!(lens.resources.extensions, 1);
        assert_eq!(lens.resources.skills, 1);
        assert!(lens.can_update && lens.can_remove && !lens.can_toggle);
        assert!(lens.path.is_some());

        let local = found.iter().find(|e| e.name == "hello").unwrap();
        assert_eq!(local.kind, ExtensionKind::Local);
        assert!(local.enabled && local.can_toggle && local.can_remove);
        assert!(local.entry_path.is_some());

        let off = found.iter().find(|e| e.name == "off").unwrap();
        assert!(!off.enabled);
        assert!(off
            .entry_path
            .as_deref()
            .unwrap()
            .ends_with("off.ts.disabled"));

        let directory = found.iter().find(|e| e.name == "tool").unwrap();
        assert!(directory.enabled);
        assert!(directory
            .entry_path
            .as_deref()
            .unwrap()
            .ends_with("index.ts"));

        let builtin = found.iter().find(|e| e.name == "codemode").unwrap();
        assert_eq!(builtin.kind, ExtensionKind::Builtin);
        assert!(!builtin.can_remove && !builtin.can_toggle);

        assert!(names.len() >= 5, "expected every source to be listed");
    }

    #[test]
    fn a_settings_override_switches_a_module_off() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let agent_dir = root.join("agent");
        let spec = pi_spec(root);
        let module = agent_dir.join("extensions/hello.ts");
        write(&module, "export default () => {}\n");
        write(
            &agent_dir.join("settings.json"),
            &format!(
                r#"{{ "extensions": ["-{}"] }}"#,
                module.display().to_string().replace('\\', "/")
            ),
        );

        let ctx = context(root);
        let found = read(&ctx, &spec, &agent_ref(), false).unwrap();
        let hello = found.iter().find(|e| e.name == "hello").unwrap();
        assert!(!hello.enabled);
    }

    #[test]
    fn switch_off_renames_the_entry_and_back() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let spec = pi_spec(root);
        let module = root.join("agent/extensions/hello.ts");
        write(&module, "export default () => {}\n");

        let ctx = context(root);
        let found = read(&ctx, &spec, &agent_ref(), false).unwrap();
        let hello = found.iter().find(|e| e.name == "hello").unwrap().clone();

        set_enabled(&ctx, &spec, "pi", &hello, false).unwrap();
        assert!(!module.exists());
        assert!(root.join("agent/extensions/hello.ts.disabled").is_file());

        let off = read(&ctx, &spec, &agent_ref(), false)
            .unwrap()
            .into_iter()
            .find(|e| e.name == "hello")
            .unwrap();
        assert!(!off.enabled);
        assert_eq!(off.id, hello.id, "the id survives the switch");
        set_enabled(&ctx, &spec, "pi", &off, true).unwrap();
        assert!(module.is_file());
    }

    #[test]
    fn refuses_a_path_outside_the_declared_directory() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let spec = pi_spec(root);
        let ctx = context(root);
        let outside = root.join("elsewhere/x.ts");
        write(&outside, "export default () => {}\n");
        let extension = Extension {
            id: "local:x".to_string(),
            surface: "extensions".to_string(),
            name: "x".to_string(),
            description: None,
            kind: ExtensionKind::Local,
            manager: None,
            source: outside.display().to_string(),
            path: Some(outside.display().to_string()),
            entry_path: Some(outside.display().to_string()),
            version: None,
            author: None,
            homepage: None,
            repository: None,
            license: None,
            enabled: true,
            can_update: false,
            can_remove: true,
            can_toggle: true,
            scope: Scope::Global,
            agent: agent_ref(),
            resources: ExtensionResources::default(),
            unverified: false,
            modified_ms: None,
        };
        assert!(matches!(
            checked_unit(&ctx, &spec, "pi", &extension),
            Err(AppError::CommandNotAllowed(_))
        ));
    }

    #[test]
    fn plan_runs_the_agent_cli_with_the_source_it_declared() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        let bin = root.join("bin/pi");
        write(&bin, "#!/bin/sh\n");
        let ctx = context(root).with_extra_scan_paths(vec![root.join("bin")]);
        let manifest = crate::catalog::parse_manifest(
            r#"
id = "pi"
name = "Pi"
description = "x"
[binaries]
names = ["pi"]
[extensions]
id = "extensions"
format = "pi"
path = { linux = "/nowhere/extensions" }
settings = { linux = "/nowhere/settings.json" }
"#,
            "test",
        )
        .unwrap();
        let extension = Extension {
            id: "package:x".to_string(),
            surface: "extensions".to_string(),
            name: "pi-lens".to_string(),
            description: None,
            kind: ExtensionKind::Package,
            manager: Some(ExtensionManager::Npm),
            source: "npm:pi-lens@4.3.0".to_string(),
            path: None,
            entry_path: None,
            version: None,
            author: None,
            homepage: None,
            repository: None,
            license: None,
            enabled: true,
            can_update: true,
            can_remove: true,
            can_toggle: false,
            scope: Scope::Global,
            agent: agent_ref(),
            resources: ExtensionResources::default(),
            unverified: false,
            modified_ms: None,
        };

        let updated = plan(&ctx, &manifest, &extension, ExtensionAction::Update).unwrap();
        assert_eq!(updated.args, vec!["update", "npm:pi-lens@4.3.0"]);
        assert_eq!(updated.action, InstallAction::Update);
        assert!(updated
            .display_command
            .ends_with("update npm:pi-lens@4.3.0"));
        assert!(!updated.uses_shell);

        let removed = plan(&ctx, &manifest, &extension, ExtensionAction::Remove).unwrap();
        assert_eq!(removed.args, vec!["remove", "npm:pi-lens@4.3.0"]);
        assert_eq!(removed.action, InstallAction::Uninstall);
    }
}
