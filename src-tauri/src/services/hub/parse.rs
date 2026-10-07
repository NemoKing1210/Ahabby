//! Reading what hub sources publish.
//!
//! Everything here is pure: bytes or a JSON document in, entries out. No network, no filesystem,
//! which is what makes the three formats testable against fixtures instead of against the
//! internet — and the internet is exactly where the shapes come from, so each parser is written
//! to *ignore* what it does not know and to skip one bad entry rather than fail a whole library.

use std::io::Read;

use serde::Deserialize;

use crate::adapters::frontmatter;
use crate::domain::{
    normalize_tags, HubEntry, HubFileInfo, HubFileKind, HubInput, HubPreview, HubResourceKind,
    HubSource, McpTransport,
};
use crate::error::{AppError, Result};

// ---------------------------------------------------------------------------------------------
// Structural limits — a hub source is third-party input, so nothing it publishes is unbounded.
// ---------------------------------------------------------------------------------------------

/// Largest repository tarball Ahabby will read.
pub const MAX_ARCHIVE_BYTES: u64 = 64 * 1024 * 1024;
/// Largest single file taken out of one.
pub const MAX_FILE_BYTES: u64 = 8 * 1024 * 1024;
/// Largest total payload kept for one repository.
pub const MAX_REPO_BYTES: u64 = 48 * 1024 * 1024;
/// Longest text Ahabby reads out of a file when it only needs a description.
const MAX_TEXT_SCAN_BYTES: u64 = 1024 * 1024;

// ---------------------------------------------------------------------------------------------
// Repository tarballs (a `githubSkills` source, and the skill half of an `index` source)
// ---------------------------------------------------------------------------------------------

/// One file read out of a repository tarball, addressed relative to the repository root.
#[derive(Debug, Clone)]
pub struct TarFile {
    pub path: String,
    pub bytes: Vec<u8>,
}

/// Read a `tar.gz` body into files, relative to the repository root.
///
/// `truncated` says a limit was hit: the collection is still readable, but it is not complete —
/// reported to the user instead of silently showing a partial library.
pub fn read_tarball(bytes: &[u8]) -> Result<(Vec<TarFile>, bool)> {
    let mut files: Vec<TarFile> = Vec::new();
    let mut total: u64 = 0;
    let mut truncated = false;

    let decoder = flate2::read::GzDecoder::new(bytes);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive.entries().map_err(|error| {
        AppError::other(format!("the repository archive is unreadable: {error}"))
    })?;

    for entry in entries {
        let mut entry = match entry {
            Ok(entry) => entry,
            // A single damaged member does not invalidate the rest of the archive.
            Err(_) => {
                truncated = true;
                continue;
            }
        };
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let size = entry.header().size().unwrap_or(0);
        if size > MAX_FILE_BYTES {
            truncated = true;
            continue;
        }
        if total + size > MAX_REPO_BYTES {
            truncated = true;
            break;
        }
        let Ok(path) = entry.path() else { continue };
        let path = path.to_string_lossy().replace('\\', "/");
        // `owner-repo-sha/file` — the archive's own directory is not part of any skill path.
        let Some((_, rest)) = path.split_once('/') else {
            continue;
        };
        if rest.is_empty() {
            continue;
        }
        let mut bytes = Vec::with_capacity(size as usize);
        if entry.read_to_end(&mut bytes).is_err() {
            truncated = true;
            continue;
        }
        total += bytes.len() as u64;
        files.push(TarFile {
            path: rest.to_string(),
            bytes,
        });
    }

    Ok((files, truncated))
}

/// What kind of payload a path holds, from its extension.
///
/// The Hub installs third-party files into an agent's own directory, so "is this instructions or
/// is this something that runs" is a distinction the user is shown before the write.
pub fn file_kind(path: &str) -> HubFileKind {
    let extension = path
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "md" | "markdown" | "txt" | "json" | "jsonc" | "yaml" | "yml" | "toml" | "csv" | "tsv"
        | "xml" | "html" | "htm" | "css" | "svg" | "ini" | "cfg" | "conf" | "env" | "gitignore"
        | "lock" | "rst" | "tex" | "sql" | "graphql" | "gql" => HubFileKind::Text,
        "py" | "sh" | "bash" | "zsh" | "fish" | "ps1" | "psm1" | "bat" | "cmd" | "js" | "mjs"
        | "cjs" | "ts" | "tsx" | "jsx" | "rb" | "pl" | "php" | "lua" | "r" | "go" | "rs"
        | "java" | "kt" | "cs" | "swift" | "scala" | "jl" | "exe" | "dll" | "so" | "dylib"
        | "jar" => HubFileKind::Script,
        _ => HubFileKind::Binary,
    }
}

/// One skill found in a repository.
#[derive(Debug, Clone)]
pub struct RepoSkill {
    /// Repository-relative directory the skill lives in — also its entry id.
    pub dir: String,
    /// Display name: the frontmatter's `name`, else the directory's own name.
    pub name: String,
    pub description: Option<String>,
    /// Indexes of every file the skill owns, entry file included.
    pub file_indexes: Vec<usize>,
    pub size_bytes: u64,
    pub has_scripts: bool,
    /// The plugin/collection a skill belongs to, when the layout says so
    /// (`plugins/<group>/skills/<skill>`) — a tag, and how the UI can label it.
    pub group: Option<String>,
    /// What the skill says about itself: its frontmatter `tags` (or `keywords`).
    pub tags: Vec<String>,
}

/// Find every skill in a repository.
///
/// A skill is a directory holding a `SKILL.md`. The *shallowest* such directory owns everything
/// below it, so a nested `SKILL.md` (a skill that ships an example skill) can never make the same
/// file part of two entries.
pub fn repo_skills(files: &[TarFile], source: &HubSource) -> Vec<RepoSkill> {
    let wanted = |path: &str| -> bool {
        if let Some(prefix) = source
            .path
            .as_deref()
            .map(|path| path.trim_end_matches('/'))
        {
            if !prefix.is_empty() && path != prefix && !path.starts_with(&format!("{prefix}/")) {
                return false;
            }
        }
        !source
            .exclude
            .iter()
            .any(|exclude| excludes(path, exclude.trim_end_matches('/')))
    };

    // Candidate roots, shallowest first, so a nested skill is absorbed by its parent.
    let mut roots: Vec<&str> = files
        .iter()
        .filter(|file| wanted(&file.path))
        .filter_map(|file| skill_root(&file.path))
        .collect();
    roots.sort_by_key(|root| root.split('/').count());
    let mut directories: Vec<&str> = Vec::new();
    for root in roots {
        if directories.iter().any(|dir| is_inside(root, dir)) {
            continue;
        }
        if !directories.contains(&root) {
            directories.push(root);
        }
    }
    directories.sort_unstable();

    directories
        .into_iter()
        .filter_map(|directory| {
            let indexes: Vec<usize> = files
                .iter()
                .enumerate()
                .filter(|(_, file)| wanted(&file.path) && is_inside(&file.path, directory))
                .map(|(index, _)| index)
                .collect();
            let entry_index = indexes
                .iter()
                .find(|index| is_entry_file(&files[**index].path, directory))?;
            let text = read_text(&files[*entry_index]);
            let markdown = text.as_deref().map(frontmatter::parse);
            let fallback = directory
                .rsplit('/')
                .next()
                .unwrap_or(directory)
                .to_string();
            Some(RepoSkill {
                dir: directory.to_string(),
                name: markdown
                    .as_ref()
                    .and_then(|markdown| markdown.name.clone())
                    .filter(|name| !name.trim().is_empty())
                    .unwrap_or(fallback),
                description: markdown.as_ref().and_then(frontmatter::Markdown::summary),
                size_bytes: indexes
                    .iter()
                    .map(|index| files[*index].bytes.len() as u64)
                    .sum(),
                has_scripts: indexes
                    .iter()
                    .any(|index| file_kind(&files[*index].path) == HubFileKind::Script),
                file_indexes: indexes,
                group: group_of(directory),
                tags: markdown.as_ref().map(declared_tags).unwrap_or_default(),
            })
        })
        .collect()
}

/// The directory a `SKILL.md` makes a skill root, or `None` when the file is not an entry file.
///
/// Only the exact name counts: `SKILL.md` is what every agent looks for, and a `skill.md` in a
/// repository is far more likely to be prose about skills than a skill.
fn skill_root(path: &str) -> Option<&str> {
    let (directory, name) = path.rsplit_once('/')?;
    (name == "SKILL.md").then_some(directory)
}

fn is_entry_file(path: &str, directory: &str) -> bool {
    path == format!("{directory}/SKILL.md")
}

/// `true` when `path` is `directory` or something below it.
fn is_inside(path: &str, directory: &str) -> bool {
    path == directory || path.starts_with(&format!("{directory}/"))
}

/// `true` when a repository path is inside an excluded directory (or is it).
fn excludes(path: &str, exclude: &str) -> bool {
    !exclude.is_empty() && (path == exclude || path.starts_with(&format!("{exclude}/")))
}

/// The collection a skill belongs to: `plugins/<group>/skills/<skill>` → `<group>`.
fn group_of(directory: &str) -> Option<String> {
    let segments: Vec<&str> = directory.split('/').collect();
    let skills = segments.iter().position(|segment| *segment == "skills")?;
    if skills == 0 {
        return None;
    }
    Some(segments[skills - 1].to_string())
}

/// The tags a skill declares about itself, from the frontmatter of its own `SKILL.md`.
///
/// The convention spells them either way — `tags` or `keywords`, as a list or as one comma
/// separated line (`adapters::frontmatter` flattens a YAML list into exactly that) — so both keys
/// are read and both are split on commas. Nothing is invented here: a skill that declares no tags
/// has none.
fn declared_tags(markdown: &frontmatter::Markdown) -> Vec<String> {
    normalize_tags(
        markdown
            .frontmatter
            .iter()
            .filter(|entry| {
                entry.key.eq_ignore_ascii_case("tags") || entry.key.eq_ignore_ascii_case("keywords")
            })
            .flat_map(|entry| entry.value.split(','))
            .map(str::to_string),
    )
}

fn read_text(file: &TarFile) -> Option<String> {
    if file.bytes.len() as u64 > MAX_TEXT_SCAN_BYTES {
        return None;
    }
    String::from_utf8(file.bytes.clone()).ok()
}

/// The file list of a skill, as the install dialog shows it.
pub fn skill_files(files: &[TarFile], indexes: &[usize], directory: &str) -> Vec<HubFileInfo> {
    let mut infos: Vec<HubFileInfo> = indexes
        .iter()
        .map(|index| {
            let file = &files[*index];
            HubFileInfo {
                path: relative_to(&file.path, directory),
                size_bytes: file.bytes.len() as u64,
                kind: file_kind(&file.path),
            }
        })
        .collect();
    infos.sort_by(|a, b| a.path.cmp(&b.path));
    infos
}

/// `skills/pdf/scripts/x.py` with directory `skills/pdf` → `scripts/x.py`.
pub fn relative_to(path: &str, directory: &str) -> String {
    path.strip_prefix(&format!("{directory}/"))
        .unwrap_or(path)
        .to_string()
}

/// The longest instructions text a preview carries.
///
/// The same cap the scanner uses when it inlines a skill it read from disk: a preview is for
/// reading before an install, not for pushing a megabyte through the IPC boundary.
const MAX_PREVIEW_TEXT_BYTES: u64 = crate::adapters::PREVIEW_LIMIT_BYTES;

/// The entry file of a skill, read out of the collection so the instructions can be read *before*
/// anything is written.
///
/// `None` when the skill has no `SKILL.md` or it is not text: a preview of something that cannot be
/// shown is not a preview, and the UI says so instead of rendering mojibake.
pub fn preview(files: &[TarFile], directory: &str) -> Option<HubPreview> {
    let entry = files
        .iter()
        .find(|file| file.path == format!("{directory}/SKILL.md"))?;
    let text = String::from_utf8(entry.bytes.clone()).ok()?;
    let truncated = text.len() as u64 > MAX_PREVIEW_TEXT_BYTES;
    let text = if truncated {
        truncate_on_char_boundary(text, MAX_PREVIEW_TEXT_BYTES as usize)
    } else {
        text
    };
    let markdown = frontmatter::parse(&text);
    Some(HubPreview {
        path: relative_to(&entry.path, directory),
        content: markdown.body,
        frontmatter: markdown.frontmatter,
        truncated,
    })
}

/// Cut a string at a byte offset that is a character boundary.
///
/// Truncating by bytes alone can split a UTF-8 sequence, which is exactly what a markdown body
/// full of accents and em dashes would do.
fn truncate_on_char_boundary(mut text: String, limit: usize) -> String {
    let mut end = limit.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text
}

// ---------------------------------------------------------------------------------------------
// The official MCP registry
// ---------------------------------------------------------------------------------------------

/// One registry record, already turned into what the UI and the installer need.
#[derive(Debug, Clone)]
pub struct RegistryItem {
    pub entry: HubEntry,
    pub transport: Option<McpTransport>,
    pub inputs: Vec<HubInput>,
    pub source_url: Option<String>,
}

/// Read one page of `GET <url>/v0/servers`.
///
/// Older versions of the same server are dropped: the registry returns every published version
/// unless it is asked not to, and a library that lists `foo@1.0.0` next to `foo@1.0.1` is a
/// library nobody can browse.
pub fn mcp_registry(
    json: &serde_json::Value,
    source: &HubSource,
) -> Result<(Vec<RegistryItem>, Option<String>)> {
    let page: RegistryPage = serde_json::from_value(json.clone()).map_err(|error| {
        AppError::other(format!(
            "the registry answered something unexpected: {error}"
        ))
    })?;

    let mut items: Vec<RegistryItem> = Vec::new();
    for record in page.servers {
        if record
            .meta
            .official()
            .and_then(|official| official.is_latest)
            .is_some_and(|latest| !latest)
        {
            continue;
        }
        if items
            .iter()
            .any(|item| item.entry.name == record.server.name)
        {
            continue;
        }
        items.push(item_from_record(record.server, source));
    }
    Ok((items, page.metadata.next_cursor))
}

fn item_from_record(record: RegistryRecord, source: &HubSource) -> RegistryItem {
    let (transport, inputs, problem) = recipe(&record);
    let repository = record
        .repository
        .as_ref()
        .map(|repository| repository.url.clone());
    let source_url = record
        .website_url
        .clone()
        .or_else(|| repository.clone())
        .or_else(|| {
            Some(format!(
                "https://registry.modelcontextprotocol.io/v0/servers?search={}",
                record.name
            ))
        });
    let entry = HubEntry {
        id: format!("{}/{}", source.id, record.name),
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        kind: HubResourceKind::Mcp,
        name: record.name.clone(),
        title: record.title.clone(),
        description: record.description.clone(),
        version: record.version.clone(),
        vendor: source.vendor.clone(),
        homepage: record.website_url.clone(),
        repository,
        license: source.license.clone(),
        tags: source.declared_tags(&record.name),
        file_count: None,
        size_bytes: None,
        installable: problem.is_none(),
        install_problem: problem,
        input_count: inputs.len() as u32,
        has_scripts: false,
    };
    RegistryItem {
        entry,
        transport,
        inputs,
        source_url,
    }
}

/// The launch recipe of one registry record, and what the user still has to fill in.
fn recipe(record: &RegistryRecord) -> (Option<McpTransport>, Vec<HubInput>, Option<String>) {
    // A runnable package wins over a hosted remote: it is what the publisher ships as the
    // default, and what most agents are configured with.
    if let Some(package) = record
        .packages
        .iter()
        .find(|package| package.transport.kind.eq_ignore_ascii_case("stdio"))
        .or_else(|| record.packages.first())
    {
        let command = runtime_command(package.runtime_hint.as_deref(), &package.registry_type);
        let url = package.transport.url.clone();
        if command.is_empty() && url.is_none() {
            return (
                None,
                inputs_of(&package.environment_variables),
                Some(format!(
                    "the registry does not say how to run '{}' (runtime '{}' is unknown)",
                    package.identifier, package.registry_type
                )),
            );
        }
        let inputs = inputs_of(&package.environment_variables);
        if let Some(url) = url.filter(|url| !url.trim().is_empty()) {
            return (
                Some(McpTransport::Http {
                    url,
                    protocol: package.transport.kind.clone(),
                }),
                inputs,
                None,
            );
        }
        return (
            Some(McpTransport::Stdio {
                command,
                args: package_args(package),
            }),
            inputs,
            None,
        );
    }

    if let Some(remote) = record.remotes.first() {
        return (
            Some(McpTransport::Http {
                url: remote.url.clone(),
                protocol: remote.kind.clone(),
            }),
            inputs_of(&remote.headers),
            None,
        );
    }

    (
        None,
        Vec::new(),
        Some("the registry entry declares neither a runnable package nor a remote URL".to_string()),
    )
}

/// `npx -y pkg@1.2.3 …` — the runtime's own arguments, then the package, then extra arguments.
fn package_args(package: &RegistryPackage) -> Vec<String> {
    let mut args: Vec<String> = package
        .runtime_arguments
        .iter()
        .map(|argument| argument.value.clone())
        .collect();
    let identifier = package.identifier.trim();
    if !identifier.is_empty() {
        args.push(match package.registry_type.to_ascii_lowercase().as_str() {
            "npm" => match package.version.as_deref().map(str::trim) {
                Some(version) if !version.is_empty() => format!("{identifier}@{version}"),
                _ => identifier.to_string(),
            },
            "pypi" => match package.version.as_deref().map(str::trim) {
                Some(version) if !version.is_empty() => format!("{identifier}=={version}"),
                _ => identifier.to_string(),
            },
            _ => identifier.to_string(),
        });
    }
    args.extend(
        package
            .package_arguments
            .iter()
            .map(|argument| argument.value.clone()),
    );
    args.retain(|argument| !argument.trim().is_empty());
    args
}

/// The program a package is run with: what the publisher hints, else what its registry implies.
fn runtime_command(hint: Option<&str>, registry_type: &str) -> String {
    match hint.map(str::trim).filter(|hint| !hint.is_empty()) {
        Some(hint) => hint.to_string(),
        None => match registry_type.to_ascii_lowercase().as_str() {
            "npm" => "npx".to_string(),
            "pypi" => "uvx".to_string(),
            "oci" => "docker".to_string(),
            "nuget" => "dnx".to_string(),
            _ => String::new(),
        },
    }
}

fn inputs_of(variables: &[RegistryVariable]) -> Vec<HubInput> {
    variables
        .iter()
        .filter(|variable| !variable.name.trim().is_empty())
        .map(|variable| HubInput {
            key: variable.name.trim().to_string(),
            description: variable.description.clone(),
            required: variable.required.unwrap_or(false),
            secret: variable.secret.unwrap_or(false),
            default: variable.default.clone(),
        })
        .collect()
}

#[derive(Debug, Deserialize)]
struct RegistryPage {
    #[serde(default)]
    servers: Vec<RegistryServer>,
    #[serde(default)]
    metadata: RegistryMetadata,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryMetadata {
    #[serde(default)]
    next_cursor: Option<String>,
}

#[derive(Debug, Deserialize)]
struct RegistryServer {
    server: RegistryRecord,
    #[serde(default, rename = "_meta")]
    meta: RegistryMeta,
}

#[derive(Debug, Default, Deserialize)]
struct RegistryMeta {
    #[serde(default, flatten)]
    extra: std::collections::BTreeMap<String, serde_json::Value>,
}

impl RegistryMeta {
    /// The registry's own block, when the server publishes one.
    fn official(&self) -> Option<OfficialMeta> {
        let value = self
            .extra
            .get("io.modelcontextprotocol.registry/official")?;
        serde_json::from_value(value.clone()).ok()
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct OfficialMeta {
    #[serde(default)]
    is_latest: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryRecord {
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    website_url: Option<String>,
    #[serde(default)]
    repository: Option<RegistryRepository>,
    #[serde(default)]
    packages: Vec<RegistryPackage>,
    #[serde(default)]
    remotes: Vec<RegistryRemote>,
}

#[derive(Debug, Deserialize)]
struct RegistryRepository {
    #[serde(default)]
    url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPackage {
    #[serde(default)]
    registry_type: String,
    #[serde(default)]
    identifier: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    runtime_hint: Option<String>,
    #[serde(default)]
    runtime_arguments: Vec<RegistryArgument>,
    #[serde(default)]
    package_arguments: Vec<RegistryArgument>,
    #[serde(default)]
    environment_variables: Vec<RegistryVariable>,
    #[serde(default)]
    transport: RegistryPackageTransport,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryPackageTransport {
    /// The registry spells it .
    #[serde(default = "stdio", rename = "type")]
    kind: String,
    #[serde(default)]
    url: Option<String>,
}

fn stdio() -> String {
    "stdio".to_string()
}

#[derive(Debug, Deserialize)]
struct RegistryArgument {
    #[serde(default)]
    value: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryVariable {
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: Option<String>,
    /// The registry spells these `isRequired` and `isSecret`.
    #[serde(default, rename = "isRequired")]
    required: Option<bool>,
    #[serde(default, rename = "isSecret")]
    secret: Option<bool>,
    #[serde(default)]
    default: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RegistryRemote {
    /// The registry spells it `type` (`streamable-http`, `sse`).
    #[serde(default = "streamable_http", rename = "type")]
    kind: String,
    #[serde(default)]
    url: String,
    #[serde(default)]
    headers: Vec<RegistryVariable>,
}

fn streamable_http() -> String {
    "streamable-http".to_string()
}

// ---------------------------------------------------------------------------------------------
// A published index document
// ---------------------------------------------------------------------------------------------

/// One entry of an `index` document, resolved.
#[derive(Debug, Clone)]
pub struct IndexItem {
    pub entry: HubEntry,
    /// Where a skill's files are, when the entry is a skill.
    pub skill: Option<IndexSkill>,
    pub transport: Option<McpTransport>,
    pub inputs: Vec<HubInput>,
}

/// A skill of an index document: a place in a repository.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IndexSkill {
    pub repository: String,
    pub git_ref: String,
    pub path: String,
}

/// Read a published index document, reporting the entries it had to skip.
pub fn index_entries(
    json: &serde_json::Value,
    source: &HubSource,
) -> Result<(Vec<IndexItem>, Vec<String>)> {
    let document: IndexDocument = serde_json::from_value(json.clone())
        .map_err(|error| AppError::other(format!("the index document is not readable: {error}")))?;
    if document.entries.is_empty() {
        return Err(AppError::other(
            "the index document lists no entries".to_string(),
        ));
    }

    let mut items: Vec<IndexItem> = Vec::new();
    let mut problems: Vec<String> = Vec::new();
    for entry in document.entries {
        let id = entry.id.trim().to_string();
        if id.is_empty() {
            problems.push("an entry has no id and was skipped".to_string());
            continue;
        }
        let item = match item_from_index(entry, &id, source) {
            Ok(item) => item,
            Err(message) => {
                problems.push(format!("'{id}' was skipped: {message}"));
                continue;
            }
        };
        // Both halves of an entry have to be unique: the id is what addresses it, and two
        // entries with one name would be two cards the user cannot tell apart.
        if items.iter().any(|kept| kept.entry.id == item.entry.id) {
            problems.push(format!("'{id}' is declared twice; the first one is used"));
            continue;
        }
        if items.iter().any(|kept| kept.entry.name == item.entry.name) {
            problems.push(format!(
                "another entry is already called '{}'; the first one is used",
                item.entry.name
            ));
            continue;
        }
        items.push(item);
    }
    Ok((items, problems))
}

fn item_from_index(
    entry: IndexEntry,
    id: &str,
    source: &HubSource,
) -> std::result::Result<IndexItem, String> {
    let name = entry.name.trim().to_string();
    if name.is_empty() {
        return Err("it has no name".to_string());
    }
    let skill = match entry.skill {
        Some(skill) => {
            let repository = skill.repository.trim().to_string();
            let path = skill.path.trim().trim_end_matches('/').to_string();
            if repository.is_empty() || path.is_empty() {
                return Err("its 'skill' needs both a repository and a path".to_string());
            }
            // The document is third-party input: what it says becomes a URL and a path on disk,
            // so both go through the same rules a source file is held to.
            if !crate::domain::plain_repository(&repository) {
                return Err(format!("'{repository}' is not a plain repository"));
            }
            if !crate::domain::plain_relative_path(&path) {
                return Err(format!("'{path}' is not a plain repository path"));
            }
            let git_ref = skill
                .git_ref
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "main".to_string());
            if !crate::domain::plain_git_ref(&git_ref) {
                return Err(format!("'{git_ref}' is not a plain git ref"));
            }
            Some(IndexSkill {
                repository,
                git_ref,
                path,
            })
        }
        None => None,
    };
    let mcp = entry.mcp;
    let (transport, inputs, problem) = match (&skill, &mcp) {
        (Some(_), Some(_)) => (
            None,
            Vec::new(),
            Some(
                "it declares both a 'skill' and an 'mcp' block; an entry installs one thing"
                    .to_string(),
            ),
        ),
        (Some(_), None) => (None, Vec::new(), None),
        (None, Some(mcp)) => match mcp.recipe() {
            Some((transport, inputs)) => (Some(transport), inputs, None),
            None => (
                None,
                Vec::new(),
                Some(
                    "its 'mcp' block needs either a command with arguments or a remote url"
                        .to_string(),
                ),
            ),
        },
        (None, None) => (
            None,
            Vec::new(),
            Some("it declares neither a 'skill' nor an 'mcp' block".to_string()),
        ),
    };
    // An index entry that cannot be installed is not an entry the Hub can offer: the document is
    // the publisher's own file, so the message is what they have to fix.
    if let Some(problem) = problem {
        return Err(problem);
    }
    let kind = if skill.is_some() {
        HubResourceKind::Skill
    } else {
        HubResourceKind::Mcp
    };
    Ok(IndexItem {
        entry: HubEntry {
            id: format!("{}/{}", source.id, id),
            source_id: source.id.clone(),
            source_name: source.name.clone(),
            kind,
            name,
            title: entry.title,
            description: entry.description,
            version: entry.version,
            vendor: entry.vendor.or_else(|| source.vendor.clone()),
            homepage: entry.homepage,
            repository: entry.repository,
            license: entry.license.or_else(|| source.license.clone()),
            tags: normalize_tags(entry.tags.into_iter().chain(source.declared_tags(id))),
            file_count: None,
            size_bytes: None,
            // An entry that made it this far has everything installing it needs; an entry that
            // did not was skipped with a message instead of being listed as dead weight.
            installable: true,
            install_problem: None,
            input_count: inputs.len() as u32,
            has_scripts: false,
        },
        skill,
        transport,
        inputs,
    })
}

#[derive(Debug, Deserialize)]
struct IndexDocument {
    #[serde(default)]
    entries: Vec<IndexEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexEntry {
    #[serde(default)]
    id: String,
    #[serde(default)]
    name: String,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    vendor: Option<String>,
    #[serde(default)]
    homepage: Option<String>,
    #[serde(default)]
    repository: Option<String>,
    #[serde(default)]
    license: Option<String>,
    #[serde(default)]
    tags: Vec<String>,
    #[serde(default)]
    skill: Option<IndexSkillEntry>,
    #[serde(default)]
    mcp: Option<IndexMcpEntry>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexSkillEntry {
    #[serde(default)]
    repository: String,
    #[serde(default)]
    git_ref: Option<String>,
    #[serde(default)]
    path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexMcpEntry {
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Vec<String>,
    #[serde(default)]
    env: Vec<IndexVariable>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    protocol: Option<String>,
    #[serde(default)]
    headers: Vec<IndexVariable>,
}

impl IndexMcpEntry {
    /// The recipe this block describes: a local command or a remote URL.
    fn recipe(&self) -> Option<(McpTransport, Vec<HubInput>)> {
        let inputs = |variables: &[IndexVariable]| -> Vec<HubInput> {
            variables
                .iter()
                .filter(|variable| !variable.key.trim().is_empty())
                .map(|variable| HubInput {
                    key: variable.key.trim().to_string(),
                    description: variable.description.clone(),
                    required: variable.required.unwrap_or(false),
                    secret: variable.secret.unwrap_or(false),
                    default: variable.default.clone(),
                })
                .collect()
        };
        if let Some(command) = self
            .command
            .as_deref()
            .map(str::trim)
            .filter(|command| !command.is_empty())
        {
            let args: Vec<String> = self
                .args
                .iter()
                .map(|argument| argument.trim().to_string())
                .filter(|argument| !argument.is_empty())
                .collect();
            return Some((
                McpTransport::Stdio {
                    command: command.to_string(),
                    args,
                },
                inputs(&self.env),
            ));
        }
        let url = self
            .url
            .as_deref()
            .map(str::trim)
            .filter(|url| !url.is_empty())?
            .to_string();
        let protocol = self
            .protocol
            .as_deref()
            .map(str::trim)
            .filter(|protocol| !protocol.is_empty())
            .unwrap_or("streamable-http")
            .to_string();
        Some((McpTransport::Http { url, protocol }, inputs(&self.headers)))
    }
}

#[derive(Debug, Deserialize)]
struct IndexVariable {
    #[serde(default, alias = "name")]
    key: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    required: Option<bool>,
    #[serde(default)]
    secret: Option<bool>,
    #[serde(default)]
    default: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalog::hub::parse_source;

    const SKILLS_SOURCE: &str = r#"
id = "unit-skills"
name = "Unit Skills"
kind = "githubSkills"
repository = "owner/repo"
provides = ["skill"]
"#;

    const REGISTRY_SOURCE: &str = r#"
id = "unit-registry"
name = "Unit Registry"
kind = "mcpRegistry"
url = "https://registry.example.com"
provides = ["mcp"]
"#;

    fn skills_source(extra: &str) -> HubSource {
        parse_source(&format!("{SKILLS_SOURCE}{extra}"), "test").expect("a valid source")
    }

    fn registry_source() -> HubSource {
        parse_source(REGISTRY_SOURCE, "test").expect("a valid source")
    }

    /// A `tar.gz` shaped like GitHub's: every path under one `repo-ref/` directory.
    fn tarball(files: &[(&str, &str)]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        for (path, text) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(text.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, format!("repo-main/{path}"), text.as_bytes())
                .expect("append");
        }
        builder
            .into_inner()
            .expect("finish the tar")
            .finish()
            .expect("finish the gzip")
    }

    fn read(files: &[(&str, &str)]) -> Vec<TarFile> {
        read_tarball(&tarball(files)).expect("readable").0
    }

    /// One file written as raw bytes, for a `SKILL.md` that is not text.
    fn read_raw(path: &str, bytes: &[u8]) -> Vec<TarFile> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        let mut header = tar::Header::new_gnu();
        header.set_size(bytes.len() as u64);
        header.set_mode(0o644);
        header.set_cksum();
        builder
            .append_data(&mut header, format!("repo-main/{path}"), bytes)
            .expect("append");
        let gz = builder
            .into_inner()
            .expect("finish the tar")
            .finish()
            .expect("finish the gzip");
        read_tarball(&gz).expect("readable").0
    }

    #[test]
    fn a_preview_is_the_entry_file_split_the_way_the_ui_shows_a_skill() {
        let files = read(&[
            (
                "skills/pdf/SKILL.md",
                "---\nname: pdf\ndescription: Fill forms\n---\n\n# PDF\n\nUse pdftotext.\n",
            ),
            ("skills/pdf/scripts/fill.py", "print(1)\n"),
        ]);

        let entry = preview(&files, "skills/pdf").expect("the entry file is readable");
        assert_eq!(entry.path, "SKILL.md");
        assert!(!entry.truncated);
        assert_eq!(entry.frontmatter.len(), 2);
        assert_eq!(entry.frontmatter[0].key, "name");
        assert_eq!(entry.frontmatter[0].value, "pdf");
        assert!(entry.content.contains("Use pdftotext."));
        assert!(
            !entry.content.contains("description"),
            "the frontmatter is not repeated in the body"
        );

        // A directory without an entry file has nothing to show.
        assert!(preview(&files, "skills/missing").is_none());
    }

    #[test]
    fn a_preview_of_something_that_is_not_text_is_no_preview() {
        let files = read_raw("skills/bin/SKILL.md", &[0xff, 0xfe, 0x00, 0x80]);
        assert!(preview(&files, "skills/bin").is_none());
    }

    #[test]
    fn a_preview_stops_before_it_becomes_a_download() {
        let huge = format!("---\nname: huge\n---\n\n{}", "x".repeat(300 * 1024));
        let files = read(&[("skills/huge/SKILL.md", &huge)]);

        let view = preview(&files, "skills/huge").expect("readable");
        assert!(view.truncated);
        assert!(view.content.len() as u64 <= MAX_PREVIEW_TEXT_BYTES);
        assert!(view.content.len() < huge.len());
    }

    #[test]
    fn a_tarball_loses_the_repository_directory_only() {
        let files = read(&[
            ("skills/pdf/SKILL.md", "---\nname: pdf\n---\n"),
            ("README.md", "hello"),
        ]);
        let paths: Vec<&str> = files.iter().map(|file| file.path.as_str()).collect();
        assert_eq!(paths, vec!["skills/pdf/SKILL.md", "README.md"]);
    }

    #[test]
    fn skills_are_the_shallowest_directories_holding_skill_md() {
        let files = read(&[
            (
                "skills/pdf/SKILL.md",
                "---\nname: pdf\ndescription: Fill forms\n---\n",
            ),
            ("skills/pdf/scripts/fill.py", "print(1)\n"),
            ("skills/pdf/reference.md", "more\n"),
            // A nested entry file is not a second skill: its files belong to the skill above it.
            ("skills/pdf/examples/SKILL.md", "---\nname: example\n---\n"),
            (
                "plugins/teams/skills/review/SKILL.md",
                "---\nname: review\n---\n",
            ),
            ("docs/notes.md", "not a skill\n"),
        ]);
        let skills = repo_skills(&files, &skills_source(""));

        assert_eq!(skills.len(), 2, "{skills:#?}");
        let by_dir = |dir: &str| {
            skills
                .iter()
                .find(|skill| skill.dir == dir)
                .unwrap_or_else(|| panic!("no skill at {dir}"))
        };
        let pdf = by_dir("skills/pdf");
        assert_eq!(pdf.name, "pdf");
        assert_eq!(pdf.description.as_deref(), Some("Fill forms"));
        assert!(pdf.has_scripts);
        assert_eq!(pdf.file_indexes.len(), 4, "the nested example belongs here");
        assert_eq!(pdf.group, None);

        let review = by_dir("plugins/teams/skills/review");
        assert_eq!(review.group.as_deref(), Some("teams"));
        assert!(!review.has_scripts);
    }

    #[test]
    fn a_skill_declares_the_tags_it_carries() {
        let files = read(&[
            (
                "skills/design/SKILL.md",
                "---\nname: design\ntags: [design, documents]\n---\n",
            ),
            (
                "skills/review/SKILL.md",
                "---\nname: review\nkeywords: review, testing\n---\n",
            ),
            (
                "skills/deck/SKILL.md",
                "---\nname: deck\ntags: design, deck\n---\n",
            ),
            ("skills/plain/SKILL.md", "---\nname: plain\n---\n"),
        ]);
        let skills = repo_skills(&files, &skills_source(""));
        let tags = |dir: &str| {
            skills
                .iter()
                .find(|skill| skill.dir == dir)
                .unwrap_or_else(|| panic!("no skill at {dir}"))
                .tags
                .clone()
        };

        assert_eq!(tags("skills/design"), ["design", "documents"]);
        assert_eq!(tags("skills/review"), ["review", "testing"]);
        assert_eq!(tags("skills/deck"), ["design", "deck"]);
        assert!(tags("skills/plain").is_empty());
    }

    #[test]
    fn a_source_declares_tags_for_the_entries_it_names() {
        let registry = parse_source(
            r#"
id = "unit-registry"
name = "Unit Registry"
kind = "mcpRegistry"
url = "https://registry.example.com"
provides = ["mcp"]
tags = ["mcp"]

[[tag_rules]]
prefix = "com.example/files"
tags = ["files"]
"#,
            "test",
        )
        .expect("a valid source");
        let page = serde_json::json!({
            "servers": [
                {
                    "server": {
                        "name": "com.example/files",
                        "packages": [{
                            "registryType": "npm",
                            "identifier": "@example/files-mcp",
                            "transport": { "type": "stdio" }
                        }]
                    }
                },
                { "server": { "name": "com.example/other", "version": "1.0.0" } }
            ]
        });
        let (items, _) = mcp_registry(&page, &registry).expect("parsed");
        assert_eq!(items[0].entry.tags, ["mcp", "files"]);
        assert_eq!(items[1].entry.tags, ["mcp"]);

        let index = parse_source(
            r#"
id = "unit-index"
name = "Unit Index"
kind = "index"
url = "https://example.com/hub.json"
provides = ["skill"]
tags = ["hub"]

[[tag_rules]]
prefix = "design"
tags = ["design"]
"#,
            "test",
        )
        .expect("a valid source");
        let document = serde_json::json!({
            "entries": [
                {
                    "id": "design",
                    "kind": "skill",
                    "name": "Design",
                    "tags": ["ui"],
                    "skill": { "repository": "owner/repo", "path": "skills/design" }
                },
                {
                    "id": "other",
                    "kind": "skill",
                    "name": "Other",
                    "skill": { "repository": "owner/repo", "path": "skills/other" }
                }
            ]
        });
        let (items, problems) = index_entries(&document, &index).expect("parsed");
        assert!(problems.is_empty(), "{problems:#?}");
        // The document's own tag first, then what the source declares for the entry.
        assert_eq!(items[0].entry.tags, ["ui", "hub", "design"]);
        assert_eq!(items[1].entry.tags, ["hub"]);
    }

    #[test]
    fn a_source_can_narrow_the_collection_it_offers() {
        let files = read(&[
            ("skills/pdf/SKILL.md", "---\nname: pdf\n---\n"),
            (
                "plugins/teams/skills/review/SKILL.md",
                "---\nname: review\n---\n",
            ),
            ("skills/template/SKILL.md", "---\nname: template\n---\n"),
        ]);

        let narrowed = repo_skills(
            &files,
            &skills_source("\npath = \"skills\"\nexclude = [\"skills/template\"]\n"),
        );
        let dirs: Vec<&str> = narrowed.iter().map(|skill| skill.dir.as_str()).collect();
        assert_eq!(dirs, vec!["skills/pdf"]);

        // Without a filter, every SKILL.md directory is offered.
        assert_eq!(repo_skills(&files, &skills_source("")).len(), 3);
    }

    #[test]
    fn the_file_list_of_a_skill_is_relative_to_its_own_directory() {
        let files = read(&[
            ("skills/pdf/SKILL.md", "---\nname: pdf\n---\n"),
            ("skills/pdf/scripts/fill.py", "print(1)\n"),
        ]);
        let skills = repo_skills(&files, &skills_source(""));
        let infos = skill_files(&files, &skills[0].file_indexes, &skills[0].dir);
        let paths: Vec<(&str, HubFileKind)> = infos
            .iter()
            .map(|info| (info.path.as_str(), info.kind))
            .collect();
        assert_eq!(
            paths,
            vec![
                ("SKILL.md", HubFileKind::Text),
                ("scripts/fill.py", HubFileKind::Script)
            ]
        );
        assert!(infos.iter().all(|info| info.size_bytes > 0));
    }

    #[test]
    fn payload_kinds_say_what_runs() {
        assert_eq!(file_kind("SKILL.md"), HubFileKind::Text);
        assert_eq!(file_kind("scripts/build.py"), HubFileKind::Script);
        assert_eq!(file_kind("hooks/on-save.ps1"), HubFileKind::Script);
        assert_eq!(file_kind("fonts/Inter.ttf"), HubFileKind::Binary);
        assert_eq!(file_kind("assets/logo.svg"), HubFileKind::Text);
        assert_eq!(file_kind("LICENSE"), HubFileKind::Binary);
    }

    #[test]
    fn a_registry_page_becomes_installable_entries() {
        let page = serde_json::json!({
            "servers": [
                {
                    "server": {
                        "name": "com.example/files",
                        "title": "Files",
                        "description": "Reads files",
                        "version": "1.2.0",
                        "websiteUrl": "https://example.com/files",
                        "repository": { "url": "https://github.com/example/files/", "source": "github" },
                        "packages": [
                            {
                                "registryType": "npm",
                                "identifier": "@example/files-mcp",
                                "version": "1.2.0",
                                "runtimeHint": "npx",
                                "runtimeArguments": [{ "type": "positional", "value": "-y" }],
                                "packageArguments": [{ "type": "positional", "value": "/tmp" }],
                                "transport": { "type": "stdio" },
                                "environmentVariables": [
                                    { "name": "ROOT", "description": "Root to serve", "isRequired": true },
                                    { "name": "TOKEN", "isSecret": true, "default": "none" }
                                ]
                            }
                        ]
                    },
                    "_meta": { "io.modelcontextprotocol.registry/official": { "isLatest": true } }
                },
                {
                    "server": { "name": "com.example/files", "version": "1.1.0", "packages": [] },
                    "_meta": { "io.modelcontextprotocol.registry/official": { "isLatest": false } }
                },
                {
                    "server": {
                        "name": "com.example/remote",
                        "description": "A hosted one",
                        "remotes": [{ "type": "streamable-http", "url": "https://example.com/mcp" }]
                    }
                },
                { "server": { "name": "com.example/nothing", "version": "0.1.0" } }
            ],
            "metadata": { "nextCursor": "com.example/nothing:0.1.0", "count": 4 }
        });

        let (items, next) = mcp_registry(&page, &registry_source()).expect("parsed");
        assert_eq!(next.as_deref(), Some("com.example/nothing:0.1.0"));
        // The older version of `files` is dropped, so three entries remain.
        assert_eq!(items.len(), 3, "{items:#?}");

        let files = &items[0];
        assert_eq!(files.entry.id, "unit-registry/com.example/files");
        assert_eq!(files.entry.kind, HubResourceKind::Mcp);
        assert_eq!(files.entry.version.as_deref(), Some("1.2.0"));
        assert!(files.entry.installable);
        assert_eq!(files.entry.input_count, 2);
        assert_eq!(
            files.transport,
            Some(McpTransport::Stdio {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@example/files-mcp@1.2.0".to_string(),
                    "/tmp".to_string()
                ],
            })
        );
        assert_eq!(files.inputs[0].key, "ROOT");
        assert!(files.inputs[0].required && !files.inputs[0].secret);
        assert!(files.inputs[1].secret);
        assert_eq!(files.inputs[1].default.as_deref(), Some("none"));

        let remote = &items[1];
        assert_eq!(
            remote.transport,
            Some(McpTransport::Http {
                url: "https://example.com/mcp".to_string(),
                protocol: "streamable-http".to_string(),
            })
        );

        // An entry with no runnable package and no remote is listed, but not installable.
        let nothing = &items[2];
        assert!(!nothing.entry.installable);
        assert!(nothing.entry.install_problem.is_some());
        assert!(nothing.transport.is_none());
    }

    #[test]
    fn a_package_without_a_runtime_hint_falls_back_to_its_registry() {
        let page = serde_json::json!({
            "servers": [{
                "server": {
                    "name": "com.example/py",
                    "packages": [{ "registryType": "pypi", "identifier": "example-mcp", "transport": {} }]
                }
            }]
        });
        let (items, next) = mcp_registry(&page, &registry_source()).unwrap();
        assert!(next.is_none());
        assert_eq!(
            items[0].transport,
            Some(McpTransport::Stdio {
                command: "uvx".to_string(),
                args: vec!["example-mcp".to_string()],
            })
        );
    }

    #[test]
    fn a_registry_page_that_is_not_a_page_is_reported() {
        let problem = mcp_registry(
            &serde_json::json!({ "servers": "nope" }),
            &registry_source(),
        )
        .unwrap_err();
        assert_eq!(problem.code(), "other");
    }

    #[test]
    fn an_index_document_lists_skills_and_servers() {
        let document = serde_json::json!({
            "entries": [
                {
                    "id": "pdf",
                    "kind": "skill",
                    "name": "PDF toolkit",
                    "description": "Fill forms",
                    "tags": ["documents"],
                    "skill": { "repository": "anthropics/skills", "path": "skills/pdf" }
                },
                {
                    "id": "gh",
                    "kind": "mcp",
                    "name": "GitHub",
                    "mcp": {
                        "command": "npx",
                        "args": ["-y", "@modelcontextprotocol/server-github"],
                        "env": [{ "key": "GITHUB_TOKEN", "required": true, "secret": true }]
                    }
                },
                {
                    "id": "linear",
                    "kind": "mcp",
                    "name": "Linear",
                    "mcp": { "url": "https://mcp.linear.app/mcp", "protocol": "sse" }
                },
                { "id": "broken", "kind": "mcp", "name": "Broken" },
                { "id": "both", "kind": "skill", "name": "Both", "skill": { "repository": "owner/repo", "path": "a" }, "mcp": { "command": "npx" } },
                { "id": "escape", "kind": "skill", "name": "Escape", "skill": { "repository": "owner/repo", "path": "../../etc" } },
                { "id": "pdf", "kind": "skill", "name": "PDF toolkit", "skill": { "repository": "owner/repo", "path": "skills/pdf" } },
                { "id": "pdf-copy", "kind": "skill", "name": "PDF toolkit", "skill": { "repository": "owner/repo", "path": "skills/pdf-copy" } },
                { "kind": "skill", "name": "No id", "skill": { "repository": "owner/repo", "path": "a" } }
            ]
        });
        let source = parse_source(
            r#"
id = "unit-index"
name = "Unit Index"
kind = "index"
url = "https://example.com/hub.json"
provides = ["skill", "mcp"]
"#,
            "test",
        )
        .unwrap();

        let (items, problems) = index_entries(&document, &source).unwrap();
        assert_eq!(items.len(), 3, "{items:#?}");
        assert_eq!(items[0].entry.id, "unit-index/pdf");
        assert_eq!(
            items[0].skill.as_ref().unwrap().repository,
            "anthropics/skills"
        );
        assert_eq!(items[1].entry.kind, HubResourceKind::Mcp);
        assert_eq!(
            items[1].transport,
            Some(McpTransport::Stdio {
                command: "npx".to_string(),
                args: vec![
                    "-y".to_string(),
                    "@modelcontextprotocol/server-github".to_string()
                ],
            })
        );
        assert_eq!(
            items[2].transport,
            Some(McpTransport::Http {
                url: "https://mcp.linear.app/mcp".to_string(),
                protocol: "sse".to_string(),
            })
        );
        // Six entries were skipped, and each one says why.
        assert_eq!(problems.len(), 6, "{problems:#?}");
        assert!(problems.iter().any(|problem| problem.contains("broken")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("plain repository path")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("declared twice")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("already called")));
        assert!(problems.iter().any(|problem| problem.contains("no id")));
        assert!(problems
            .iter()
            .any(|problem| problem.contains("both a 'skill' and an 'mcp'")));
    }

    #[test]
    fn an_index_document_without_entries_is_an_error() {
        let source = parse_source(
            r#"
id = "unit-index"
name = "Unit Index"
kind = "index"
url = "https://example.com/hub.json"
provides = ["mcp"]
"#,
            "test",
        )
        .unwrap();
        assert!(index_entries(&serde_json::json!({ "entries": [] }), &source).is_err());
        assert!(index_entries(&serde_json::json!("nope"), &source).is_err());
    }
}
