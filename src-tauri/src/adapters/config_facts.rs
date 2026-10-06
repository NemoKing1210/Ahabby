//! "Quick info" from an agent's config files.
//!
//! The agents in the catalog disagree about where they keep things, but they converge on the
//! same *vocabulary* for the few values a user wants at a glance: a default model, a
//! provider, an endpoint, a proxy, an API token. This module reads that vocabulary out of
//! every config an agent declares, the same way [`crate::domain::secrets`] recognises a
//! secret from the shape of its key rather than from an agent-specific table.
//!
//! Rules, deliberately conservative so the panel never turns into a dump of the file:
//!
//! * structured formats (JSON / JSONC / TOML / YAML) are parsed as documents; a `text` config
//!   is read as a dotenv file (`KEY=value` lines), because that is what the agents that
//!   declare one — `~/.omp/agent/.env`, `.aider.conf.yml`'s `.env`, `.sgptrc` — actually keep
//!   there, and it is where a proxy usually lives;
//! * a file larger than [`PREVIEW_LIMIT_BYTES`] is skipped, not slurped;
//! * only the document root and one level below it is inspected;
//! * a subtree that is a collection of like things (MCP servers, hooks, projects, history,
//!   …) is never descended into — those have their own tabs;
//! * a value must be a short, single-line scalar; arrays, objects and prose are ignored;
//! * a secret — a token, or a URL with a password in it — is masked here, so its real value
//!   never reaches the frontend without an explicit `reveal_config_fact`.
//!
//! Extraction is best effort: an unreadable or invalid file simply contributes nothing.

use std::collections::HashSet;

use serde_json::Value;

use crate::domain::{secrets, ConfigFact, ConfigFile, FactKind};
use crate::platform;

use super::{mcp_parse, PREVIEW_LIMIT_BYTES};

/// How deep into a document a value may sit. Two covers `model` and `env.ANTHROPIC_API_KEY`.
const MAX_DEPTH: usize = 2;

/// Values longer than this are prose, not settings.
const MAX_VALUE_CHARS: usize = 300;

/// Secrets shorter than this are noise (`"false"`, `"on"`), not credentials worth showing.
const MIN_SECRET_CHARS: usize = 6;

/// The panel gets at most this many rows, whatever a config happens to contain.
const MAX_FACTS: usize = 20;

/// Keys that name a model, matched after lowercasing and dropping separators.
const MODEL_KEYS: &[&str] = &[
    "model",
    "modelname",
    "modelid",
    "defaultmodel",
    "defaultmodelname",
    "defaultmodelid",
    "chatmodel",
    "llmmodel",
    "aimodel",
];

/// Keys that name the provider a model is routed through.
const PROVIDER_KEYS: &[&str] = &[
    "provider",
    "providername",
    "defaultprovider",
    "modelprovider",
    "llmprovider",
    "apiprovider",
];

/// Keys that hold an HTTP proxy.
const PROXY_KEYS: &[&str] = &[
    "proxy",
    "proxyurl",
    "proxyserver",
    "httpproxy",
    "httpsproxy",
    "allproxy",
];

/// Keys that hold a URL the agent talks to.
const URL_KEYS: &[&str] = &[
    "baseurl",
    "apiurl",
    "apibase",
    "apiendpoint",
    "endpoint",
    "serverurl",
    "ollamahost",
];

/// Plain objects worth looking inside: the "settings" layers agents wrap their options in.
const CONTAINERS: &[&str] = &[
    "env",
    "environment",
    "settings",
    "general",
    "defaults",
    "config",
    "api",
    "llm",
    "auth",
    "preferences",
];

/// Objects whose child is the value itself, e.g. `model = { name = "…" }`.
const GROUP_MODEL: &[&str] = &["model", "defaultmodel", "llmmodel", "aimodel", "chatmodel"];
const GROUP_PROVIDER: &[&str] = &["provider", "defaultprovider", "llmprovider"];
const GROUP_PROXY: &[&str] = &["proxy"];

/// Objects whose *children* are model ids keyed by the role they play —
/// `modelRoles: { default: "provider/model", fast: "…" }`.
const ROLE_MAPS: &[&str] = &["modelroles", "models", "modelmap"];

/// The role that names the default model inside a [`ROLE_MAPS`] object.
const DEFAULT_ROLES: &[&str] = &["default", "defaultmodel", "chat", "primary", "main"];

/// Values that name no model: `modelId = "default"` points at a setting, it is not one.
const PLACEHOLDER_MODELS: &[&str] = &["default", "none", "auto", "inherit", "unset", "null"];

/// Child names that carry the value inside a group object.
const GENERIC_NAMES: &[&str] = &["name", "id", "value", "default", "model", "provider"];

/// Subtrees that hold collections of like things; their contents have their own screens.
const COLLECTIONS: &[&str] = &[
    "mcpservers",
    "mcp",
    "servers",
    "extensions",
    "plugins",
    "agents",
    "skills",
    "commands",
    "customcommands",
    "hooks",
    "tools",
    "lsp",
    "projects",
    "recentprojects",
    "trustedprojects",
    "trustedfolders",
    "history",
    "permissions",
    "oauthaccount",
    "telemetry",
];

/// Read every config of one agent and lift its noteworthy values out.
///
/// The result is ordered by kind (model, provider, endpoint, proxy, credential) and
/// de-duplicated by key — and by value within a kind, so the same proxy declared four times
/// under four names (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `PI_PROXY`) is one row.
pub fn extract(files: &[ConfigFile]) -> Vec<ConfigFact> {
    let mut hits: Vec<(Hit, &ConfigFile)> = Vec::new();

    for file in files {
        if !file.exists || file.size_bytes.unwrap_or(0) > PREVIEW_LIMIT_BYTES {
            continue;
        }
        let Ok(content) = platform::read_text(std::path::Path::new(&file.path)) else {
            continue;
        };

        let mut found = Vec::new();
        if file.format.is_structured() {
            if let Ok(document) = mcp_parse::document_to_value(file.format, &content) {
                collect(&document, &mut found);
            }
        } else if matches!(file.format, crate::domain::ConfigFormat::Text) {
            collect_dotenv(&content, &mut found);
        }
        hits.extend(found.into_iter().map(|hit| (hit, file)));
    }

    let mut seen_keys: HashSet<String> = HashSet::new();
    let mut seen_values: HashSet<(FactKind, String)> = HashSet::new();
    hits.retain(|(hit, _)| {
        seen_keys.insert(hit.key.clone()) && seen_values.insert((hit.kind, hit.value.clone()))
    });

    hits.sort_by_key(|(hit, _)| hit.kind.priority());
    hits.truncate(MAX_FACTS);
    hits.into_iter()
        .map(|(hit, file)| {
            ConfigFact::new(
                hit.kind,
                &hit.key,
                &hit.value,
                &file.id,
                &file.label,
                &file.path,
            )
        })
        .collect()
}

/// One extracted value, before it is turned into a [`ConfigFact`].
struct Hit {
    key: String,
    kind: FactKind,
    value: String,
}

fn collect(document: &Value, hits: &mut Vec<Hit>) {
    let Value::Object(root) = document else {
        return;
    };
    for (key, value) in root {
        walk(key, key, value, 0, hits);
    }
}

/// `path` is the dotted address stored on the fact; `segment` is the leaf name that decides
/// what the value *is* (never the whole dotted path — `env.ANTHROPIC_API_KEY` is a secret
/// because of its last segment, not because the prefix contains `api`).
fn walk(path: &str, segment: &str, value: &Value, depth: usize, hits: &mut Vec<Hit>) {
    let norm = normalize(segment);
    if is_collection(&norm) {
        return;
    }

    if let Some(text) = scalar_text(value) {
        if let Some(kind) = classify(&norm) {
            if let Some(hit) = accept(kind, path, &text) {
                hits.push(hit);
            }
        }
        return;
    }

    if depth >= MAX_DEPTH {
        return;
    }

    if let Some(group) = group_kind(&norm) {
        collect_group(path, value, group, hits);
        return;
    }

    if is_role_map(&norm) {
        collect_role_models(path, value, hits);
        return;
    }

    if !is_container(&norm) {
        return;
    }
    let Value::Object(children) = value else {
        return;
    };
    for (child_key, child_value) in children {
        walk(
            &format!("{path}.{child_key}"),
            child_key,
            child_value,
            depth + 1,
            hits,
        );
    }
}

/// A `model` / `provider` / `proxy` object: its children are either self-describing
/// (`provider = "openrouter"`) or carry a generic name (`name = "gpt-5"`).
fn collect_group(key: &str, value: &Value, group: FactKind, hits: &mut Vec<Hit>) {
    let Value::Object(children) = value else {
        return;
    };
    for (child_key, child_value) in children {
        let child_norm = normalize(child_key);
        if is_collection(&child_norm) {
            continue;
        }
        let Some(text) = scalar_text(child_value) else {
            continue;
        };
        let kind = classify(&child_norm).or_else(|| {
            // A proxy object names its child by protocol (`http`, `https`, `all`), which is
            // not a fact key of its own — the parent already said what this is.
            if group == FactKind::Proxy || GENERIC_NAMES.contains(&child_norm.as_str()) {
                Some(group)
            } else {
                None
            }
        });
        if let Some(kind) = kind {
            if let Some(hit) = accept(kind, &format!("{key}.{child_key}"), &text) {
                hits.push(hit);
            }
        }
    }
}

/// A map of model ids keyed by role — read the default one (or the only one there is).
fn collect_role_models(key: &str, value: &Value, hits: &mut Vec<Hit>) {
    let Value::Object(children) = value else {
        return;
    };
    let chosen = children
        .iter()
        .find(|(role, _)| DEFAULT_ROLES.contains(&normalize(role).as_str()))
        .or_else(|| {
            (children.len() == 1)
                .then(|| children.iter().next())
                .flatten()
        });
    let Some((role, role_value)) = chosen else {
        return;
    };
    let Some(text) = scalar_text(role_value) else {
        return;
    };
    if let Some(hit) = accept(FactKind::Model, &format!("{key}.{role}"), &text) {
        hits.push(hit);
    }
}

/// Parse a dotenv file: `KEY=value`, `export KEY=value`, `#` comments, quotes.
///
/// Only keys the vocabulary recognises are kept, so a text config that is not an env file
/// (a log, a hints file, a hook script) contributes nothing.
fn collect_dotenv(content: &str, hits: &mut Vec<Hit>) {
    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let line = line
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(line);
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        let key = key.trim();
        if key.is_empty()
            || !key
                .chars()
                .all(|character| character.is_ascii_alphanumeric() || character == '_')
        {
            continue;
        }
        let Some(value) = dotenv_value(value) else {
            continue;
        };
        if let Some(kind) = classify(&normalize(key)) {
            if let Some(hit) = accept(kind, key, &value) {
                hits.push(hit);
            }
        }
    }
}

/// The value of a dotenv line: quotes stripped, a trailing `# comment` dropped.
fn dotenv_value(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let unquoted = match raw.chars().next() {
        Some(quote @ ('"' | '\'')) if raw.len() >= 2 && raw.ends_with(quote) => {
            raw[1..raw.len() - 1].to_string()
        }
        Some('\'') | Some('"') => raw[1..].to_string(),
        _ => raw.split(" #").next().unwrap_or(raw).trim().to_string(),
    };
    (!unquoted.is_empty()).then_some(unquoted)
}

/// Keep a value only when it can be shown: short, single-line, not a `${VAR}` reference.
fn accept(kind: FactKind, key: &str, text: &str) -> Option<Hit> {
    if text.is_empty() || text.chars().count() > MAX_VALUE_CHARS || text.contains('\n') {
        return None;
    }
    // A `${VAR}` reference is a pointer to a secret (or to another setting), not its value.
    if text.starts_with("${") && text.ends_with('}') {
        return None;
    }
    if kind.is_secret() && text.chars().count() < MIN_SECRET_CHARS {
        return None;
    }
    if kind == FactKind::Model && PLACEHOLDER_MODELS.contains(&text.to_ascii_lowercase().as_str()) {
        return None;
    }
    Some(Hit {
        key: key.to_string(),
        kind,
        value: text.to_string(),
    })
}

fn classify(norm: &str) -> Option<FactKind> {
    if MODEL_KEYS.contains(&norm) {
        return Some(FactKind::Model);
    }
    if PROVIDER_KEYS.contains(&norm) {
        return Some(FactKind::Provider);
    }
    if PROXY_KEYS.contains(&norm) {
        return Some(FactKind::Proxy);
    }
    // `HTTP_PROXY`, `ALL_PROXY`, `PI_PROXY`, `git_proxy`: anything named for a proxy is one,
    // except the bypass list (`NO_PROXY`), which is not the proxy.
    if norm.ends_with("proxy") && !norm.starts_with("no") {
        return Some(FactKind::Proxy);
    }
    if URL_KEYS.contains(&norm) {
        return Some(FactKind::Url);
    }
    if secrets::is_secret_key(norm) {
        return Some(FactKind::Secret);
    }
    None
}

fn group_kind(norm: &str) -> Option<FactKind> {
    if GROUP_MODEL.contains(&norm) {
        return Some(FactKind::Model);
    }
    if GROUP_PROVIDER.contains(&norm) {
        return Some(FactKind::Provider);
    }
    if GROUP_PROXY.contains(&norm) {
        return Some(FactKind::Proxy);
    }
    None
}

/// Lowercase, separators dropped: `default_model` and `defaultModel` become `defaultmodel`.
fn normalize(key: &str) -> String {
    key.chars()
        .filter(char::is_ascii_alphanumeric)
        .flat_map(char::to_lowercase)
        .collect()
}

fn is_container(norm: &str) -> bool {
    CONTAINERS.contains(&norm)
}

fn is_collection(norm: &str) -> bool {
    COLLECTIONS.contains(&norm)
}

fn is_role_map(norm: &str) -> bool {
    ROLE_MAPS.contains(&norm)
}

/// A short, single-line scalar; everything else is not a setting worth showing.
fn scalar_text(value: &Value) -> Option<String> {
    let text = match value {
        Value::String(text) => text.trim().to_string(),
        Value::Number(number) => number.to_string(),
        Value::Bool(flag) => flag.to_string(),
        _ => return None,
    };
    if text.is_empty() || text.contains('\n') || text.chars().count() > MAX_VALUE_CHARS {
        return None;
    }
    Some(text)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{AgentRef, ConfigFormat, Scope};

    fn config(id: &str, format: ConfigFormat, content: &str) -> (ConfigFile, tempfile::TempDir) {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("config");
        std::fs::write(&path, content).unwrap();
        let file = ConfigFile {
            id: id.to_string(),
            label: id.to_string(),
            description: None,
            path: path.to_string_lossy().to_string(),
            format,
            scope: Scope::Global,
            agent: AgentRef {
                id: "test".to_string(),
                name: "Test".to_string(),
                icon: None,
            },
            exists: true,
            size_bytes: Some(content.len() as u64),
            modified_ms: None,
            editable: true,
        };
        (file, dir)
    }

    fn keys(facts: &[ConfigFact]) -> Vec<&str> {
        facts.iter().map(|fact| fact.key.as_str()).collect()
    }

    #[test]
    fn lifts_model_provider_and_endpoint_from_toml() {
        let (file, _dir) = config(
            "config",
            ConfigFormat::Toml,
            r#"
model = "gpt-5-codex"
model_provider = "openai"
base_url = "https://api.example.com/v1"
"#,
        );
        let facts = extract(&[file]);
        assert_eq!(keys(&facts), ["model", "model_provider", "base_url"]);
        assert_eq!(facts[0].kind, FactKind::Model);
        assert_eq!(facts[1].kind, FactKind::Provider);
        assert_eq!(facts[2].kind, FactKind::Url);
        assert_eq!(facts[2].config_id, "config");
    }

    #[test]
    fn masks_secrets_nested_in_env() {
        let (file, _dir) = config(
            "settings",
            ConfigFormat::Json,
            r#"{"model":"claude-sonnet-4-5","env":{"ANTHROPIC_API_KEY":"sk-ant-1234567890"}}"#,
        );
        let facts = extract(&[file]);
        let secret = facts
            .iter()
            .find(|fact| fact.kind == FactKind::Secret)
            .expect("a credential");
        assert_eq!(secret.key, "env.ANTHROPIC_API_KEY");
        assert!(!secret.value.contains("1234567890"));
        assert_eq!(secret.id, "settings:env.ANTHROPIC_API_KEY");
    }

    #[test]
    fn ignores_mcp_servers_and_deep_values() {
        let (file, _dir) = config(
            "app",
            ConfigFormat::Jsonc,
            r#"{
  // a comment
  "mcpServers": { "gh": { "env": { "GITHUB_TOKEN": "ghp_1234567890" } } },
  "projects": { "/work": { "model": "gpt-5" } }
}"#,
        );
        assert!(extract(&[file]).is_empty());
    }

    #[test]
    fn reads_a_group_object_by_its_generic_child() {
        let (file, _dir) = config(
            "settings",
            ConfigFormat::Json,
            r#"{"model":{"name":"gemini-2.5-pro"},"proxy":{"http":"http://proxy:8080"}}"#,
        );
        let facts = extract(&[file]);
        assert_eq!(keys(&facts), ["model.name", "proxy.http"]);
        assert_eq!(facts[0].kind, FactKind::Model);
        assert_eq!(facts[1].kind, FactKind::Proxy);
    }

    #[test]
    fn skips_a_model_that_is_only_a_placeholder() {
        let (file, _dir) = config(
            "cli",
            ConfigFormat::Json,
            r#"{"model":{"modelId":"default"}}"#,
        );
        assert!(extract(&[file]).is_empty());
    }

    #[test]
    fn reads_the_default_role_of_a_model_role_map() {
        let (file, _dir) = config(
            "config",
            ConfigFormat::Yaml,
            r#"
shellPath: C:\Program Files\Git\bin\bash.exe
setupVersion: 2
modelRoles:
  default: commandcode/deepseek/deepseek-v4.1-flash
  fast: commandcode/some-fast-model
defaultThinkingLevel: auto
"#,
        );
        let facts = extract(&[file]);
        assert_eq!(keys(&facts), ["modelRoles.default"]);
        assert_eq!(facts[0].kind, FactKind::Model);
        assert_eq!(facts[0].value, "commandcode/deepseek/deepseek-v4.1-flash");
    }

    #[test]
    fn reads_proxies_out_of_a_dotenv_file() {
        let proxy = "http://user:secret@proxy.example.com:8080";
        let (file, _dir) = config(
            "env",
            ConfigFormat::Text,
            &format!(
                "# comment\nexport HTTPS_PROXY=\"{proxy}\"\nALL_PROXY={proxy}\nNO_PROXY=localhost,127.0.0.1\nPI_PROXY = {proxy}\nOPENAI_API_KEY=sk-abcdef123456\nGOOSE_THINKING=on\n"
            ),
        );
        let facts = extract(&[file]);
        // Three names, one value: shown once. `NO_PROXY` is a bypass list, not a proxy.
        assert_eq!(keys(&facts), ["HTTPS_PROXY", "OPENAI_API_KEY"]);
        assert_eq!(facts[0].kind, FactKind::Proxy);
        assert_eq!(facts[0].value, "http://••••••@proxy.example.com:8080");
        assert_eq!(facts[1].kind, FactKind::Secret);
        assert!(!facts[1].value.contains("abcdef123456"));
    }

    #[test]
    fn deduplicates_the_same_key_across_configs() {
        let (first, _a) = config("config", ConfigFormat::Toml, "model = \"a\"");
        let (second, _b) = config("other", ConfigFormat::Yaml, "model: b");
        let facts = extract(&[first, second]);
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].value, "a");
    }

    #[test]
    fn ignores_a_text_config_that_is_not_an_env_file() {
        let (file, _dir) = config(
            "hints",
            ConfigFormat::Text,
            "Always run the tests.\nmodel: something\n",
        );
        assert!(extract(&[file]).is_empty());
    }

    #[test]
    fn masks_credentials_embedded_in_a_proxy_url() {
        let (file, _dir) = config(
            "settings",
            ConfigFormat::Yaml,
            "http_proxy: http://user:pw@10.0.0.1:3128\n",
        );
        let facts = extract(&[file]);
        assert_eq!(facts.len(), 1);
        assert_eq!(facts[0].kind, FactKind::Proxy);
        assert!(facts[0].masked);
        assert_eq!(facts[0].value, "http://••••••@10.0.0.1:3128");
    }

    #[test]
    fn skips_long_and_unstructured_files() {
        let (big, _dir) = config(
            "config",
            ConfigFormat::Json,
            &format!(r#"{{"model":"{}"}}"#, "x".repeat(400)),
        );
        let facts = extract(&[big]);
        // The whole document is one long scalar under `model`, so nothing plausible survives.
        assert!(facts.is_empty());

        let (markdown, _dir2) = config("memory", ConfigFormat::Markdown, "model: gpt-5\n");
        assert!(extract(&[markdown]).is_empty());
    }

    #[test]
    fn masks_provider_and_orders_credentials_last() {
        let (file, _dir) = config(
            "config",
            ConfigFormat::Yaml,
            "provider: openrouter\napi_key: sk-or-v1-abcdef123456\nmodel: gpt-5\n",
        );
        let facts = extract(&[file]);
        assert_eq!(facts.last().unwrap().kind, FactKind::Secret);
        assert!(facts.last().unwrap().value.starts_with("sk-"));
        assert!(!facts.last().unwrap().value.contains("abcdef123456"));
    }
}
