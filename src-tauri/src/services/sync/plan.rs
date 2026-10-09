//! Pure planning for cloud sync: what exists, how it is keyed, and what a payload holds.
//!
//! Nothing here talks to the network or to a provider — it turns the last scan report into the
//! list of things that *could* be synced, and turns bytes into the one document format a
//! provider stores. Keeping it pure is what lets the rules that matter (what the key of an item
//! is, when a name is an env file, whether a description is ours) be tested without a cloud.

use std::collections::HashSet;
use std::path::Path;

use similar::TextDiff;

use crate::domain::{
    is_project_owner, Agent, Project, SharedResources, Skill, SyncComparedFile, SyncFileAction,
    SyncFileContent, SyncFileStatus, SyncItem, SyncItemStatus, SyncKind, SyncOwnerKind,
    SyncPayload, SyncPayloadFile, SHARED_OWNER_ID, SYNC_DESCRIPTION_PREFIX, SYNC_MARKER_FILE,
    SYNC_SCHEMA,
};
use crate::error::{AppError, Result};
use crate::platform::sha256_hex;
use crate::services::ScanReport;

/// Separator between the kind and the name inside a key.
pub const KEY_SEPARATOR: char = '|';
/// Separator between the fields of a gist description.
pub const DESCRIPTION_SEPARATOR: &str = " :: ";
/// GitHub's own limit on a gist description.
pub const DESCRIPTION_MAX: usize = 256;
/// Most files one item may hold. A skill is text and scripts; a thousand files is not one.
pub const MAX_ITEM_FILES: usize = 1000;

/// Which surface an owner id belongs to. The rule is the app's own — shared, `project:<hash>`,
/// otherwise an agent — so a description can carry the id alone and lose nothing.
pub fn owner_kind(owner_id: &str) -> SyncOwnerKind {
    if owner_id == SHARED_OWNER_ID {
        SyncOwnerKind::Shared
    } else if is_project_owner(owner_id) {
        SyncOwnerKind::Project
    } else {
        SyncOwnerKind::Agent
    }
}

/// Machine-independent identity of an item inside its owner: `<kind>|<name>`.
pub fn item_key(kind: SyncKind, name: &str) -> String {
    format!("{}{KEY_SEPARATOR}{}", kind.name(), normalize_name(name))
}

/// Names are compared and keyed after trimming and folding case, so `SKILL.md` and `skill.md`
/// cannot become two items on a case-insensitive filesystem.
fn normalize_name(name: &str) -> String {
    name.trim().to_lowercase()
}

/// The basename of a path, `/`-separated and without a trailing slash.
pub fn basename(path: &str) -> String {
    let trimmed = path.replace('\\', "/");
    let trimmed = trimmed.trim_end_matches('/');
    trimmed.rsplit('/').next().unwrap_or(trimmed).to_string()
}

/// `true` for a dotenv-style file: `.env`, `.env.local`, `production.env`.
pub fn is_env_name(name: &str) -> bool {
    let lower = name.trim().to_lowercase();
    lower == ".env" || lower.starts_with(".env.") || lower.ends_with(".env")
}

/// The kind a declared config file is synced as.
pub fn classify_config(name: &str) -> SyncKind {
    if is_env_name(name) {
        SyncKind::Env
    } else {
        SyncKind::Config
    }
}

/// How a path is shown in a description and in the UI: home-relative with `~`, `/`-separated.
pub fn display_path(path: &Path, home: Option<&Path>) -> String {
    let normalized = path.to_string_lossy().replace('\\', "/");
    if let Some(home) = home {
        let home = home.to_string_lossy().replace('\\', "/");
        let home = home.trim_end_matches('/');
        if let Some(rest) = normalized.strip_prefix(&format!("{home}/")) {
            return format!("~/{rest}");
        }
    }
    normalized
}

/// One candidate before keys are assigned.
struct Candidate {
    kind: SyncKind,
    name: String,
    label: String,
    path: String,
    relative_path: String,
    is_directory: bool,
    files: usize,
    size_bytes: u64,
    editable: bool,
    exists: bool,
    has_secrets: bool,
}

impl Candidate {
    fn into_item(self, owner: &OwnerInfo, key: String) -> SyncItem {
        let id = format!("{}#{}", key, crate::domain::skill::short_hash(&self.path));
        SyncItem {
            id,
            key,
            owner_id: owner.id.clone(),
            owner_name: owner.name.clone(),
            owner_kind: owner_kind(&owner.id),
            kind: self.kind,
            name: self.name,
            label: self.label,
            path: self.path,
            relative_path: self.relative_path,
            is_directory: self.is_directory,
            files: self.files,
            size_bytes: self.size_bytes,
            editable: self.editable,
            exists: self.exists,
            has_secrets: self.has_secrets,
            status: SyncItemStatus::Unsynced,
            remote_id: None,
            remote_uri: None,
            synced_at_ms: None,
        }
    }
}

struct OwnerInfo {
    id: String,
    name: String,
}

/// Every item Ahabby can sync, out of the last scan.
///
/// Only the kinds an agent page shows as a file are derived — a config (a `.env` included), a
/// skill and an MCP config file ([`SyncKind::SYNCABLE`]). A manifest's documents and a local
/// extension are deliberately left out: the cloud holds the working set, not the whole catalogue.
///
/// `filter` restricts the result to one owner. Paths already claimed by a more specific kind
/// are skipped, so an MCP file a manifest also lists under `configs` is one item, not two.
pub fn items_of(report: &ScanReport, home: Option<&Path>, filter: Option<&str>) -> Vec<SyncItem> {
    let mut out = Vec::new();

    for agent in &report.agents {
        if !matches!(filter, Some(id) if id != agent.id) {
            out.extend(agent_items(agent, home));
        }
    }
    if filter.is_none() || filter == Some(SHARED_OWNER_ID) {
        out.extend(shared_items(&report.shared, home));
    }
    for project in &report.projects.projects {
        if !matches!(filter, Some(id) if id != project.id) {
            out.extend(project_items(project, home));
        }
    }

    out
}

fn agent_items(agent: &Agent, home: Option<&Path>) -> Vec<SyncItem> {
    let owner = OwnerInfo {
        id: agent.id.clone(),
        name: agent.name.clone(),
    };
    let mut candidates = Vec::new();

    // MCP files first: an MCP config an agent also declares as a config is one item, and the
    // MCP kind is the more precise description of it.
    for server in &agent.mcp_servers {
        let path = &server.source_config;
        let name = basename(path);
        candidates.push(Candidate {
            kind: SyncKind::Mcp,
            label: name.clone(),
            name,
            path: path.clone(),
            relative_path: display_path(Path::new(path), home),
            is_directory: false,
            files: 1,
            size_bytes: 0,
            editable: true,
            exists: true,
            has_secrets: server.has_secrets,
        });
    }
    for config in &agent.configs {
        let name = basename(&config.path);
        let kind = classify_config(&name);
        candidates.push(Candidate {
            kind,
            name,
            label: config.label.clone(),
            path: config.path.clone(),
            relative_path: display_path(Path::new(&config.path), home),
            is_directory: false,
            files: 1,
            size_bytes: config.size_bytes.unwrap_or(0),
            editable: config.editable,
            exists: config.exists,
            has_secrets: kind == SyncKind::Env
                || agent
                    .facts
                    .iter()
                    .any(|fact| fact.masked && fact.config_id == config.id),
        });
    }
    for skill in &agent.skills {
        candidates.push(skill_candidate(skill, home));
    }

    finish(candidates, &owner)
}

fn shared_items(shared: &SharedResources, home: Option<&Path>) -> Vec<SyncItem> {
    let owner = OwnerInfo {
        id: SHARED_OWNER_ID.to_string(),
        name: "Shared".to_string(),
    };
    let mut candidates = Vec::new();
    for server in &shared.mcp_servers {
        let path = &server.source_config;
        let name = basename(path);
        candidates.push(Candidate {
            kind: SyncKind::Mcp,
            label: name.clone(),
            name,
            path: path.clone(),
            relative_path: display_path(Path::new(path), home),
            is_directory: false,
            files: 1,
            size_bytes: 0,
            editable: true,
            exists: true,
            has_secrets: server.has_secrets,
        });
    }
    for config in &shared.configs {
        let name = basename(&config.path);
        let kind = classify_config(&name);
        candidates.push(Candidate {
            kind,
            name,
            label: config.label.clone(),
            path: config.path.clone(),
            relative_path: display_path(Path::new(&config.path), home),
            is_directory: false,
            files: 1,
            size_bytes: config.size_bytes.unwrap_or(0),
            editable: config.editable,
            exists: config.exists,
            has_secrets: kind == SyncKind::Env,
        });
    }
    for skill in &shared.skills {
        candidates.push(skill_candidate(skill, home));
    }
    finish(candidates, &owner)
}

fn project_items(project: &Project, home: Option<&Path>) -> Vec<SyncItem> {
    let owner = OwnerInfo {
        id: project.id.clone(),
        name: project.name.clone(),
    };
    let mut candidates = Vec::new();
    for server in &project.mcp_servers {
        let path = &server.source_config;
        let name = basename(path);
        candidates.push(Candidate {
            kind: SyncKind::Mcp,
            label: name.clone(),
            name,
            path: path.clone(),
            relative_path: display_path(Path::new(path), home),
            is_directory: false,
            files: 1,
            size_bytes: 0,
            editable: true,
            exists: true,
            has_secrets: server.has_secrets,
        });
    }
    for config in &project.configs {
        let name = basename(&config.path);
        let kind = classify_config(&name);
        candidates.push(Candidate {
            kind,
            name,
            label: config.label.clone(),
            path: config.path.clone(),
            relative_path: display_path(Path::new(&config.path), home),
            is_directory: false,
            files: 1,
            size_bytes: config.size_bytes.unwrap_or(0),
            editable: config.editable,
            exists: config.exists,
            has_secrets: kind == SyncKind::Env,
        });
    }
    for skill in &project.skills {
        candidates.push(skill_candidate(skill, home));
    }
    finish(candidates, &owner)
}

fn skill_candidate(skill: &Skill, home: Option<&Path>) -> Candidate {
    Candidate {
        kind: SyncKind::Skill,
        name: skill.name.clone(),
        label: skill.name.clone(),
        path: skill.path.clone(),
        relative_path: display_path(Path::new(&skill.path), home),
        is_directory: true,
        files: 1,
        size_bytes: skill.size_bytes.unwrap_or(0),
        editable: true,
        exists: true,
        has_secrets: false,
    }
}

/// Assign keys (unique within the owner) and turn the candidates into items.
///
/// Sorted first, so a duplicate basename resolves to the same item on every scan — the second
/// one gets a numeric suffix instead of the two silently overwriting each other's gist.
fn finish(mut candidates: Vec<Candidate>, owner: &OwnerInfo) -> Vec<SyncItem> {
    // A path already claimed by an earlier kind wins; the kinds are pushed most-specific first.
    let mut seen_paths: HashSet<String> = HashSet::new();
    candidates.retain(|candidate| seen_paths.insert(normalize_name(&candidate.path)));

    candidates.sort_by(|a, b| {
        a.kind
            .name()
            .cmp(b.kind.name())
            .then_with(|| a.path.cmp(&b.path))
    });

    let mut used: HashSet<String> = HashSet::new();
    candidates
        .into_iter()
        .map(|candidate| {
            let base = item_key(candidate.kind, &candidate.name);
            let mut key = base.clone();
            let mut index = 2;
            while !used.insert(key.clone()) {
                key = format!("{base}{KEY_SEPARATOR}{index}");
                index += 1;
            }
            candidate.into_item(owner, key)
        })
        .collect()
}

/// The name part of a key, whatever duplicate suffix it carries.
pub fn key_name(key: &str) -> &str {
    let after_kind = key
        .split_once(KEY_SEPARATOR)
        .map(|(_, rest)| rest)
        .unwrap_or(key);
    match after_kind.split_once(KEY_SEPARATOR) {
        Some((name, suffix)) if suffix.chars().all(|c| c.is_ascii_digit()) => name,
        _ => after_kind,
    }
}

/// The key of an item as only its kind and base name (a remote record may carry no suffix).
pub fn base_key_of(key: &str) -> String {
    let kind = key
        .split_once(KEY_SEPARATOR)
        .map(|(kind, _)| kind)
        .unwrap_or(key);
    format!("{kind}{KEY_SEPARATOR}{}", key_name(key))
}

// --- payload -------------------------------------------------------------------------------

/// One file's bytes as a payload entry: text stays text, anything else becomes base64.
pub fn payload_file(path: &str, bytes: &[u8]) -> SyncPayloadFile {
    match std::str::from_utf8(bytes) {
        Ok(text) if !text.contains('\0') => SyncPayloadFile {
            path: path.to_string(),
            encoding: "utf8".to_string(),
            content: text.to_string(),
        },
        _ => {
            use base64::engine::general_purpose::STANDARD as BASE64;
            use base64::Engine as _;
            SyncPayloadFile {
                path: path.to_string(),
                encoding: "base64".to_string(),
                content: BASE64.encode(bytes),
            }
        }
    }
}

/// The bytes of one payload entry back.
pub fn decode_file(file: &SyncPayloadFile) -> Result<Vec<u8>> {
    match file.encoding.as_str() {
        "utf8" => Ok(file.content.as_bytes().to_vec()),
        "base64" => {
            use base64::engine::general_purpose::STANDARD as BASE64;
            use base64::Engine as _;
            BASE64
                .decode(&file.content)
                .map_err(|error| AppError::InvalidFormat {
                    format: "sync payload",
                    path: file.path.clone(),
                    message: format!("not valid base64: {error}"),
                })
        }
        other => Err(AppError::InvalidFormat {
            format: "sync payload",
            path: file.path.clone(),
            message: format!("unknown encoding '{other}'"),
        }),
    }
}

/// Total payload size in bytes, as the stored files.
pub fn payload_size(files: &[SyncPayloadFile]) -> u64 {
    files
        .iter()
        .map(|file| match file.encoding.as_str() {
            "base64" => {
                let padding = file.content.chars().filter(|c| *c == '=').count() as u64;
                (file.content.len() as u64 * 3 / 4).saturating_sub(padding)
            }
            _ => file.content.len() as u64,
        })
        .sum()
}

/// A content hash over the payload's files — order-independent, and blind to the metadata that
/// changes on every push (so a second push of the same content uploads nothing).
pub fn payload_hash(files: &[SyncPayloadFile]) -> String {
    let mut sorted: Vec<&SyncPayloadFile> = files.iter().collect();
    sorted.sort_by(|a, b| a.path.cmp(&b.path));
    let mut canonical = Vec::new();
    for file in sorted {
        canonical.extend_from_slice(file.path.as_bytes());
        canonical.push(0);
        canonical.extend_from_slice(file.encoding.as_bytes());
        canonical.push(0);
        canonical.extend_from_slice(file.content.as_bytes());
        canonical.push(1);
    }
    format!("sha256:{}", sha256_hex(&canonical))
}

// --- marker document -----------------------------------------------------------------------

/// The document a provider stores, as JSON.
pub fn encode_marker(payload: &SyncPayload) -> Result<serde_json::Value> {
    Ok(serde_json::to_value(payload)?)
}

/// Read a stored document back, refusing one Ahabby does not own or is too new to understand.
pub fn decode_marker(value: &serde_json::Value) -> Result<SyncPayload> {
    let payload: SyncPayload =
        serde_json::from_value(value.clone()).map_err(|error| AppError::InvalidFormat {
            format: "sync payload",
            path: SYNC_MARKER_FILE.to_string(),
            message: error.to_string(),
        })?;
    if payload.app != "ahabby" {
        return Err(AppError::NotSupported(format!(
            "'{}' is not an Ahabby sync document",
            payload.app
        )));
    }
    if payload.schema > SYNC_SCHEMA {
        return Err(AppError::NotSupported(format!(
            "sync document schema {} is newer than this Ahabby understands ({SYNC_SCHEMA})",
            payload.schema
        )));
    }
    Ok(payload)
}

// --- gist description ----------------------------------------------------------------------

/// The gist description: readable, and the whole index a listing needs.
///
/// The structured fields come first and the display path last, so the 256-character limit can
/// only ever cut what the marker file already carries authoritatively — never a field a listing
/// reads to build its record.
pub fn gist_description(payload: &SyncPayload) -> String {
    let head = format!(
        "{SYNC_DESCRIPTION_PREFIX}{}{DESCRIPTION_SEPARATOR}{}{DESCRIPTION_SEPARATOR}{}{DESCRIPTION_SEPARATOR}{}{DESCRIPTION_SEPARATOR}{}{DESCRIPTION_SEPARATOR}",
        payload.owner_id,
        payload.kind.name(),
        payload.key,
        payload.files.len(),
        payload_size(&payload.files),
    );
    if head.chars().count() + payload.relative_path.chars().count() <= DESCRIPTION_MAX {
        return format!("{head}{}", payload.relative_path);
    }
    // Nothing left to trim but the display path. The marker file stays authoritative; a cut
    // description costs a second request on that one entry, never correctness.
    head.chars().take(DESCRIPTION_MAX).collect()
}

/// What a listing can read out of a description without fetching the gist.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DescribedItem {
    pub owner_id: String,
    pub kind: SyncKind,
    /// Machine-independent item key, already carrying the kind and the display name.
    pub key: String,
    pub files: usize,
    pub size_bytes: u64,
    /// Display path, when the description was not truncated before it.
    pub relative_path: String,
}

/// `true` when a description is one of Ahabby's.
pub fn is_our_description(description: &str) -> bool {
    description.starts_with(SYNC_DESCRIPTION_PREFIX)
}

/// Parse the structured prefix. `None` means the description is not ours (or is too damaged to
/// read) — the caller then falls back to the marker file.
pub fn parse_gist_description(description: &str) -> Option<DescribedItem> {
    let rest = description.strip_prefix(SYNC_DESCRIPTION_PREFIX)?;
    let mut fields = rest.splitn(6, DESCRIPTION_SEPARATOR);
    let owner_id = fields.next()?.trim();
    if owner_id.is_empty() || owner_id.contains(char::is_whitespace) {
        return None;
    }
    let kind = SyncKind::from_name(fields.next()?.trim())?;
    let key = fields.next()?.trim();
    if key.is_empty() || key.split_once(KEY_SEPARATOR).is_none() {
        return None;
    }
    let files = fields.next()?.trim().parse::<usize>().ok()?;
    let size_bytes = fields.next()?.trim().parse::<u64>().ok()?;
    let relative_path = fields.next().unwrap_or("").trim().to_string();
    Some(DescribedItem {
        owner_id: owner_id.to_string(),
        kind,
        key: key.to_string(),
        files,
        size_bytes,
        relative_path,
    })
}

// --- exclusions ----------------------------------------------------------------------------

/// `true` when an item's relative path matches one of the user's exclusion globs.
pub fn excluded(relative_path: &str, patterns: &[String]) -> bool {
    let name = basename(relative_path);
    patterns.iter().any(|pattern| {
        let pattern = pattern.trim();
        if pattern.is_empty() {
            return false;
        }
        globset::Glob::new(pattern)
            .map(|glob| {
                let matcher = glob.compile_matcher();
                matcher.is_match(relative_path) || matcher.is_match(&name)
            })
            .unwrap_or(false)
    })
}

// --- diffs ---------------------------------------------------------------------------------

/// What writing `new` over `old` would be.
pub fn file_action(old: Option<&[u8]>, new: &[u8]) -> SyncFileAction {
    match old {
        None => SyncFileAction::Add,
        Some(old) if old == new => SyncFileAction::Same,
        Some(_) => SyncFileAction::Replace,
    }
}

/// A unified diff of two text files, or `None` when either side is not text.
pub fn unified_for(old: Option<&[u8]>, new: &[u8]) -> Option<String> {
    let new_text = std::str::from_utf8(new).ok()?;
    if new_text.contains('\0') {
        return None;
    }
    let old_text = match old {
        Some(bytes) => {
            let text = std::str::from_utf8(bytes).ok()?;
            if text.contains('\0') {
                return None;
            }
            text
        }
        None => "",
    };
    Some(
        TextDiff::from_lines(old_text, new_text)
            .unified_diff()
            .context_radius(3)
            .header("local", "cloud")
            .to_string(),
    )
}

/// Largest text a reader inlines per file. Both sides are cut at the same length, so a diff of two
/// large files still lines up.
pub const MAX_VIEW_BYTES: usize = 512 * 1024;

/// The text of a file for a reader, or `None` when there is nothing anyone could read.
///
/// A truncated read may cut a multi-byte character in half, which is no reason to call a text file
/// binary: the cut character is dropped and everything before it is shown. `error_len() == None`
/// is exactly that case — the input *ended* inside a character — while an invalid byte is still
/// what it is, and makes the file binary.
pub fn text_of(bytes: &[u8], truncated: bool) -> Option<String> {
    if bytes.contains(&0) {
        return None;
    }
    match std::str::from_utf8(bytes) {
        Ok(text) => Some(text.to_string()),
        Err(error) if truncated && error.error_len().is_none() => {
            let end = error.valid_up_to();
            (end > 0)
                .then(|| bytes[..end].to_vec())
                .and_then(|slice| String::from_utf8(slice).ok())
        }
        Err(_) => None,
    }
}

/// One file as a reader shows it: the text within [`MAX_VIEW_BYTES`], the file's true size, and the
/// hash of the whole thing — which is what lets two binary files be compared at all.
pub fn file_content(path: &str, bytes: &[u8]) -> SyncFileContent {
    let truncated = bytes.len() > MAX_VIEW_BYTES;
    let slice = &bytes[..bytes.len().min(MAX_VIEW_BYTES)];
    let text = text_of(slice, truncated);
    SyncFileContent {
        path: path.to_string(),
        binary: text.is_none(),
        text,
        size_bytes: bytes.len() as u64,
        truncated,
        hash: Some(format!("sha256:{}", sha256_hex(bytes))),
    }
}

/// How two sides' files stand against each other, by path.
///
/// A binary file has no text to diff, but it does have a hash — so "identical" is still an answer
/// rather than a shrug, and the reader is told it has nothing to show.
pub fn compare_files(
    local: &[SyncFileContent],
    cloud: &[SyncFileContent],
) -> Vec<SyncComparedFile> {
    let mut paths: Vec<&str> = local
        .iter()
        .map(|file| file.path.as_str())
        .chain(cloud.iter().map(|file| file.path.as_str()))
        .collect();
    paths.sort_unstable();
    paths.dedup();

    paths
        .into_iter()
        .filter_map(|path| {
            let left = local.iter().find(|file| file.path == path);
            let right = cloud.iter().find(|file| file.path == path);
            let status = match (left, right) {
                // Two hashes are what "identical" is claimed on; a side that was not read in
                // full is reported as uncomparable rather than guessed at.
                (Some(l), Some(r)) => match (l.hash.as_deref(), r.hash.as_deref()) {
                    (Some(left_hash), Some(right_hash)) if left_hash == right_hash => {
                        SyncFileStatus::Same
                    }
                    (Some(_), Some(_)) => SyncFileStatus::Changed,
                    _ => SyncFileStatus::Binary,
                },
                (Some(_), None) => SyncFileStatus::LocalOnly,
                (None, Some(_)) => SyncFileStatus::CloudOnly,
                (None, None) => return None,
            };
            Some(SyncComparedFile {
                path: path.to_string(),
                binary: left.is_some_and(|file| file.binary)
                    || right.is_some_and(|file| file.binary),
                status,
                local_size_bytes: left.map(|file| file.size_bytes),
                cloud_size_bytes: right.map(|file| file.size_bytes),
                // Only a text file has anything a diff could show.
                left: left
                    .filter(|file| !file.binary)
                    .and_then(|file| file.text.clone()),
                right: right
                    .filter(|file| !file.binary)
                    .and_then(|file| file.text.clone()),
                truncated: left.is_some_and(|file| file.truncated)
                    || right.is_some_and(|file| file.truncated),
            })
        })
        .collect()
}

/// Read a skill directory into payload files, sorted by path.
///
/// Hidden entries are skipped (a skill has no `.git`), and the file cap and the caller's size cap
/// bound what a single item may carry.
pub fn read_directory(root: &Path) -> Result<Vec<SyncPayloadFile>> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
        let entry =
            entry.map_err(|error| AppError::other(format!("cannot read {root:?}: {error}")))?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let relative = path
            .strip_prefix(root)
            .map_err(|error| AppError::other(error.to_string()))?
            .to_string_lossy()
            .replace('\\', "/");
        if relative.starts_with('.') || relative.contains("/.") {
            continue;
        }
        if files.len() >= MAX_ITEM_FILES {
            return Err(AppError::InvalidInput(format!(
                "a skill may hold at most {MAX_ITEM_FILES} files"
            )));
        }
        let bytes = std::fs::read(path).map_err(|error| AppError::io(path, error))?;
        files.push(payload_file(&relative, &bytes));
    }
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn env_names_are_recognised() {
        for name in [".env", ".env.local", ".env.production", "prod.env", ".ENV"] {
            assert!(is_env_name(name), "{name} should be an env file");
        }
        for name in ["env", "environment.json", ".envrc", "settings.json"] {
            assert!(!is_env_name(name), "{name} should not be an env file");
        }
    }

    #[test]
    fn keys_are_case_insensitive_and_keep_their_suffix() {
        assert_eq!(
            item_key(SyncKind::Config, "Settings.JSON"),
            "config|settings.json"
        );
        assert_eq!(
            item_key(SyncKind::Config, " Settings.JSON "),
            "config|settings.json"
        );
        assert_eq!(
            base_key_of("config|settings.json|2"),
            "config|settings.json"
        );
        assert_eq!(base_key_of("skill|pdf"), "skill|pdf");
    }

    #[test]
    fn payload_hash_ignores_order_and_sees_a_changed_byte() {
        let a = payload_file("SKILL.md", b"hello");
        let b = payload_file("scripts/x.py", b"print(1)");
        let first = payload_hash(&[a.clone(), b.clone()]);
        let second = payload_hash(&[b.clone(), a.clone()]);
        assert_eq!(first, second);
        let changed = payload_hash(&[payload_file("SKILL.md", b"hello!"), b]);
        assert_ne!(first, changed);
    }

    #[test]
    fn binary_files_survive_the_round_trip() {
        let bytes = vec![0u8, 159, 146, 150, 255];
        let file = payload_file("logo.png", &bytes);
        assert_eq!(file.encoding, "base64");
        assert_eq!(decode_file(&file).unwrap(), bytes);
        assert_eq!(payload_size(&[file]), 5);
    }

    #[test]
    fn marker_round_trips_and_refuses_foreign_documents() {
        let payload = sample_payload(SyncKind::Config, "claude-code", "~/.claude/settings.json");
        let value = encode_marker(&payload).unwrap();
        assert_eq!(decode_marker(&value).unwrap(), payload);

        let mut foreign = value.clone();
        foreign["app"] = serde_json::json!("something-else");
        assert!(decode_marker(&foreign).is_err());

        let mut newer = value;
        newer["schema"] = serde_json::json!(SYNC_SCHEMA + 1);
        assert!(decode_marker(&newer).is_err());
    }

    #[test]
    fn description_round_trips_and_reads_foreign_ones_as_none() {
        let payload = sample_payload(
            SyncKind::Skill,
            "project:ab12",
            "~/w/app/.claude/skills/pdf",
        );
        let description = gist_description(&payload);
        assert!(description.starts_with(SYNC_DESCRIPTION_PREFIX));
        let parsed = parse_gist_description(&description).unwrap();
        assert_eq!(parsed.owner_id, "project:ab12");
        assert_eq!(parsed.kind, SyncKind::Skill);
        assert_eq!(parsed.key, "skill|pdf");
        assert_eq!(parsed.relative_path, "~/w/app/.claude/skills/pdf");
        assert_eq!(parsed.files, 1);
        assert_eq!(parsed.size_bytes, 4);
        assert_eq!(owner_kind(&parsed.owner_id), SyncOwnerKind::Project);

        assert!(parse_gist_description("just a gist").is_none());
        assert!(parse_gist_description("[Ahabby] ").is_none());
        assert!(parse_gist_description("[Ahabby] claude-code :: nope :: x :: 1 :: 2").is_none());
        assert!(
            parse_gist_description("[Ahabby] claude-code :: config :: nokey :: 1 :: 2").is_none()
        );
        assert!(is_our_description(&description));
    }

    #[test]
    fn a_long_description_keeps_the_structured_prefix() {
        let mut payload = sample_payload(SyncKind::Config, "claude-code", &"a".repeat(240));
        payload.key = item_key(SyncKind::Config, "settings.json");
        payload.label = "x".repeat(240);
        let description = gist_description(&payload);
        assert!(description.chars().count() <= DESCRIPTION_MAX);
        let parsed = parse_gist_description(&description).unwrap();
        assert_eq!(parsed.owner_id, "claude-code");
        assert_eq!(parsed.kind, SyncKind::Config);
        assert_eq!(parsed.key, "config|settings.json");
        assert_eq!(parsed.files, 1);
        // The display path was cut; the marker file is what a pull reads for it.
        assert!(parsed.relative_path.is_empty());
    }

    #[test]
    fn exclusions_match_the_path_and_the_basename() {
        let patterns = vec!["*.log".to_string(), "~/.claude/settings.json".to_string()];
        assert!(excluded("~/.claude/settings.json", &patterns));
        assert!(excluded("~/.claude/tmp/run.log", &patterns));
        assert!(!excluded("~/.claude/skills/pdf/SKILL.md", &patterns));
        assert!(!excluded("anything", &[]));
    }

    #[test]
    fn a_text_file_is_read_as_text_and_hashed_over_the_whole_thing() {
        let file = file_content("SKILL.md", b"# hi\n");
        assert_eq!(file.text.as_deref(), Some("# hi\n"));
        assert!(!file.binary);
        assert!(!file.truncated);
        assert_eq!(file.size_bytes, 5);
        assert!(file
            .hash
            .as_deref()
            .is_some_and(|hash| hash.starts_with("sha256:")));
    }

    #[test]
    fn a_binary_file_carries_its_size_and_no_text() {
        let file = file_content("logo.png", &[0u8, 1, 2, 255]);
        assert!(file.binary);
        assert!(file.text.is_none());
        assert_eq!(file.size_bytes, 4);
    }

    #[test]
    fn a_large_file_is_cut_without_turning_binary() {
        let bytes = vec![b'a'; MAX_VIEW_BYTES + 10];
        let file = file_content("big.txt", &bytes);
        assert!(file.truncated);
        assert!(!file.binary);
        assert_eq!(file.size_bytes as usize, MAX_VIEW_BYTES + 10);
        assert_eq!(file.text.as_deref().map(str::len), Some(MAX_VIEW_BYTES));

        // A cut that lands in the middle of a multi-byte character is still text.
        let mut cyrillic = vec![b'a'];
        cyrillic.extend("п".repeat(MAX_VIEW_BYTES / 2).as_bytes());
        let file = file_content("big.txt", &cyrillic);
        assert!(!file.binary, "a cut UTF-8 tail must not read as binary");
        assert!(file.truncated);
    }

    #[test]
    fn comparison_sees_same_changed_and_one_sided_files() {
        let same = file_content("SKILL.md", b"# hi");
        let local = vec![same.clone(), file_content("scripts/run.py", b"print(1)")];
        let cloud = vec![
            same,
            file_content("scripts/run.py", b"print(2)"),
            file_content("notes.md", b"# n"),
        ];

        let files = compare_files(&local, &cloud);
        let seen: Vec<(&str, SyncFileStatus)> = files
            .iter()
            .map(|file| (file.path.as_str(), file.status))
            .collect();
        assert_eq!(
            seen,
            vec![
                ("SKILL.md", SyncFileStatus::Same),
                ("notes.md", SyncFileStatus::CloudOnly),
                ("scripts/run.py", SyncFileStatus::Changed),
            ]
        );

        // Both texts travel, so the dialog can build a real diff.
        let changed = files
            .iter()
            .find(|file| file.path == "scripts/run.py")
            .unwrap();
        assert_eq!(changed.left.as_deref(), Some("print(1)"));
        assert_eq!(changed.right.as_deref(), Some("print(2)"));
        assert_eq!(changed.local_size_bytes, Some(8));

        let cloud_only = files.iter().find(|file| file.path == "notes.md").unwrap();
        assert!(cloud_only.left.is_none());
        assert_eq!(cloud_only.right.as_deref(), Some("# n"));
    }

    #[test]
    fn two_binaries_are_compared_by_their_hashes() {
        let hashed = |size: u64, hash: Option<&str>| SyncFileContent {
            path: "asset.bin".to_string(),
            binary: true,
            size_bytes: size,
            hash: hash.map(str::to_string),
            ..SyncFileContent::default()
        };
        let local = vec![hashed(4, Some("sha256:aa"))];
        assert_eq!(
            compare_files(&local, &[hashed(4, Some("sha256:aa"))])[0].status,
            SyncFileStatus::Same
        );
        assert_eq!(
            compare_files(&local, &[hashed(9, Some("sha256:bb"))])[0].status,
            SyncFileStatus::Changed
        );
        // A file too large to read in full has no hash: nothing is claimed about it.
        let unread = compare_files(&local, &[hashed(9, None)]);
        assert_eq!(unread[0].status, SyncFileStatus::Binary);
        assert!(unread[0].binary);
        assert!(unread[0].left.is_none());
        assert!(unread[0].right.is_none());
    }

    #[test]
    fn file_action_walks_add_same_replace() {
        assert_eq!(file_action(None, b"a"), SyncFileAction::Add);
        assert_eq!(file_action(Some(b"a"), b"a"), SyncFileAction::Same);
        assert_eq!(file_action(Some(b"a"), b"b"), SyncFileAction::Replace);
    }

    #[test]
    fn unified_diff_is_text_only() {
        assert!(unified_for(None, b"line\n").is_some());
        assert!(unified_for(Some(b"a\nb\n"), b"a\nc\n")
            .unwrap()
            .contains("-b"));
        assert!(unified_for(Some(&[0u8, 1, 2]), b"text").is_none());
    }

    fn sample_payload(kind: SyncKind, owner_id: &str, relative_path: &str) -> SyncPayload {
        let files = vec![payload_file("SKILL.md", b"# hi")];
        SyncPayload {
            schema: SYNC_SCHEMA,
            app: "ahabby".to_string(),
            kind,
            key: item_key(kind, &basename(relative_path)),
            owner_kind: owner_kind(owner_id),
            owner_id: owner_id.to_string(),
            owner_name: "Owner".to_string(),
            name: basename(relative_path),
            label: "Pdf".to_string(),
            relative_path: relative_path.to_string(),
            is_directory: true,
            hash: payload_hash(&files),
            files,
            pushed_at_ms: 1_760_000_000_000,
            source_path: "/home/u/path".to_string(),
            app_version: "0.50.0".to_string(),
            os: "linux".to_string(),
            has_secrets: false,
        }
    }
}
