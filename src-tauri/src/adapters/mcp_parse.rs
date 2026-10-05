//! Normalisation of MCP server entries.
//!
//! Every agent invents its own shape. Instead of one parser per agent, Ahabby recognises
//! the family of shapes in one place:
//!
//! ```jsonc
//! // classic stdio
//! { "command": "npx", "args": ["-y", "@modelcontextprotocol/server-github"], "env": { "TOKEN": "..." } }
//! // array command (opencode, codex)
//! { "type": "local", "command": ["npx", "-y", "server"], "environment": { "TOKEN": "..." } }
//! // remote
//! { "type": "sse", "url": "https://example.com/sse", "headers": { "Authorization": "Bearer ..." } }
//! ```
//!
//! Secrets are masked while parsing, so a masked value never reaches the frontend.

use serde_json::Value;

use crate::domain::secrets::{is_secret_key, redact_json};
use crate::domain::{ConfigFormat, EnvVar, McpTransport};
use crate::error::{AppError, Result};

/// One server entry, normalised.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NormalizedServer {
    pub transport: McpTransport,
    pub env: Vec<EnvVar>,
    pub headers: Vec<EnvVar>,
    pub has_secrets: bool,
    /// The entry as pretty-printed, **redacted** JSON.
    pub raw: String,
    /// Key names that were masked (used by `reveal_mcp_secret`).
    pub secret_keys: Vec<String>,
}

/// Parse a JSON / TOML / YAML document into a JSON value.
pub fn document_to_value(format: ConfigFormat, content: &str) -> Result<Value> {
    match format {
        ConfigFormat::Json => serde_json::from_str(super::doc_edit::trim_bom(content))
            .map_err(|error| AppError::other(format!("invalid JSON: {error}"))),
        ConfigFormat::Jsonc => serde_json::from_str(&super::jsonc::strip(content))
            .map_err(|error| AppError::other(format!("invalid JSONC: {error}"))),
        ConfigFormat::Toml => toml_edit::de::from_str(content)
            .map_err(|error| AppError::other(format!("invalid TOML: {error}"))),
        ConfigFormat::Yaml => serde_yaml::from_str(content)
            .map_err(|error| AppError::other(format!("invalid YAML: {error}"))),
        ConfigFormat::Markdown | ConfigFormat::Text => Err(AppError::NotSupported(
            "this format does not hold structured data".to_string(),
        )),
    }
}

/// Walk a dotted key path inside a document.
pub fn value_at<'a>(root: &'a Value, path: &[String]) -> Option<&'a Value> {
    let mut current = root;
    for segment in path {
        current = current.as_object()?.get(segment)?;
    }
    Some(current)
}

pub fn normalize(value: &Value) -> NormalizedServer {
    let type_name = value
        .get("type")
        .or_else(|| value.get("transport"))
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();

    let (env, env_secret) = collection(value.get("env").or_else(|| value.get("environment")));
    let (headers, header_secret) = collection(value.get("headers"));

    let command_value = value.get("command");
    let url = value
        .get("url")
        .or_else(|| value.get("httpUrl"))
        .or_else(|| value.get("serverUrl"))
        .or_else(|| value.get("endpoint"))
        .and_then(Value::as_str)
        .map(str::to_string);

    let transport = if let Some(command) = command_value {
        if let Some(command) = command.as_str() {
            if !command.trim().is_empty() {
                McpTransport::Stdio {
                    command: command.trim().to_string(),
                    args: string_list(value.get("args")),
                }
            } else {
                fallback_transport(value, url, &type_name)
            }
        } else if let Some(list) = command.as_array() {
            let mut parts: Vec<String> = list.iter().map(scalar_to_string).collect();
            if parts.is_empty() {
                fallback_transport(value, url, &type_name)
            } else {
                let program = parts.remove(0);
                let mut args = parts;
                args.extend(string_list(value.get("args")));
                McpTransport::Stdio {
                    command: program,
                    args,
                }
            }
        } else {
            fallback_transport(value, url, &type_name)
        }
    } else {
        fallback_transport(value, url, &type_name)
    };

    let secret_keys = env_secret
        .iter()
        .chain(header_secret.iter())
        .cloned()
        .collect::<Vec<_>>();

    NormalizedServer {
        transport,
        env,
        headers,
        has_secrets: !secret_keys.is_empty(),
        raw: serde_json::to_string_pretty(&redact_json(value)).unwrap_or_else(|_| "{}".to_string()),
        secret_keys,
    }
}

fn fallback_transport(value: &Value, url: Option<String>, type_name: &str) -> McpTransport {
    if let Some(url) = url {
        let protocol = if type_name.is_empty() || type_name == "remote" {
            "http".to_string()
        } else {
            type_name.to_string()
        };
        return McpTransport::Http { url, protocol };
    }
    let detail = value
        .as_object()
        .map(|object| object.keys().cloned().collect::<Vec<_>>().join(", "))
        .unwrap_or_else(|| value.to_string());
    McpTransport::Unknown { detail }
}

fn string_list(value: Option<&Value>) -> Vec<String> {
    match value {
        Some(Value::Array(items)) => items.iter().map(scalar_to_string).collect(),
        Some(Value::Null) | None => Vec::new(),
        Some(other) => vec![scalar_to_string(other)],
    }
}

fn scalar_to_string(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

/// Turn a `{ key: value }` object into masked environment variables / headers.
fn collection(value: Option<&Value>) -> (Vec<EnvVar>, Vec<String>) {
    let mut entries = Vec::new();
    let mut secret_keys = Vec::new();
    let Some(Value::Object(object)) = value else {
        return (entries, secret_keys);
    };
    for (key, value) in object {
        let text = scalar_to_string(value);
        if is_secret_key(key) && !text.is_empty() {
            secret_keys.push(key.clone());
            entries.push(EnvVar {
                key: key.clone(),
                value: None,
                masked: true,
            });
        } else {
            entries.push(EnvVar {
                key: key.clone(),
                value: Some(text),
                masked: false,
            });
        }
    }
    (entries, secret_keys)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn parses_classic_stdio_with_masked_env() {
        let normalized = normalize(&json!({
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-github"],
            "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_secretvalue123", "LOG": "info" }
        }));
        match &normalized.transport {
            McpTransport::Stdio { command, args } => {
                assert_eq!(command, "npx");
                assert_eq!(args.len(), 2);
            }
            other => panic!("expected stdio, got {other:?}"),
        }
        assert!(normalized.has_secrets);
        let token = normalized
            .env
            .iter()
            .find(|entry| entry.key == "GITHUB_PERSONAL_ACCESS_TOKEN")
            .unwrap();
        assert!(token.masked);
        assert_eq!(token.value, None);
        let log = normalized
            .env
            .iter()
            .find(|entry| entry.key == "LOG")
            .unwrap();
        assert_eq!(log.value.as_deref(), Some("info"));
        assert!(!normalized.raw.contains("ghp_secretvalue123"));
    }

    #[test]
    fn parses_array_command_and_environment_alias() {
        let normalized = normalize(&json!({
            "type": "local",
            "command": ["npx", "-y", "server"],
            "environment": { "API_KEY": "sk-1" }
        }));
        match &normalized.transport {
            McpTransport::Stdio { command, args } => {
                assert_eq!(command, "npx");
                assert_eq!(args, &["-y".to_string(), "server".to_string()]);
            }
            other => panic!("expected stdio, got {other:?}"),
        }
        assert_eq!(normalized.secret_keys, vec!["API_KEY".to_string()]);
    }

    #[test]
    fn parses_remote_transports() {
        let sse = normalize(&json!({ "type": "sse", "url": "https://x/sse" }));
        assert_eq!(
            sse.transport,
            McpTransport::Http {
                url: "https://x/sse".to_string(),
                protocol: "sse".to_string()
            }
        );
        let bare = normalize(&json!({ "url": "https://x/mcp" }));
        assert_eq!(
            bare.transport,
            McpTransport::Http {
                url: "https://x/mcp".to_string(),
                protocol: "http".to_string()
            }
        );
        let remote = normalize(&json!({ "type": "remote", "url": "https://x/mcp" }));
        assert_eq!(remote.transport.label(), "http");
    }

    #[test]
    fn parses_qwen_style_http_url_entries() {
        let http = normalize(&json!({ "httpUrl": "https://x/mcp", "type": "http" }));
        assert_eq!(
            http.transport,
            McpTransport::Http {
                url: "https://x/mcp".to_string(),
                protocol: "http".to_string()
            }
        );
        // `url` without a type is treated as SSE by these agents, and plain http by Ahabby.
        let sse = normalize(&json!({ "url": "https://x/sse" }));
        assert_eq!(sse.transport.label(), "http");
    }

    #[test]
    fn unknown_entries_are_reported_not_dropped() {
        let normalized = normalize(&json!({ "disabled": true, "note": "???" }));
        match normalized.transport {
            McpTransport::Unknown { detail } => assert!(detail.contains("disabled")),
            other => panic!("expected unknown, got {other:?}"),
        }
    }

    #[test]
    fn string_command_with_non_string_args() {
        let normalized = normalize(&json!({ "command": "server", "args": ["--port", 3000] }));
        match normalized.transport {
            McpTransport::Stdio { args, .. } => assert_eq!(args, vec!["--port", "3000"]),
            other => panic!("expected stdio, got {other:?}"),
        }
    }

    #[test]
    fn parses_documents_in_every_supported_format() {
        let json = document_to_value(ConfigFormat::Json, r#"{"mcpServers":{}}"#).unwrap();
        assert!(json.get("mcpServers").is_some());

        let toml_doc =
            document_to_value(ConfigFormat::Toml, "[mcp_servers.gh]\ncommand = \"npx\"\n").unwrap();
        assert!(value_at(&toml_doc, &["mcp_servers".into(), "gh".into()]).is_some());

        let yaml =
            document_to_value(ConfigFormat::Yaml, "mcp:\n  gh:\n    command: npx\n").unwrap();
        assert!(value_at(&yaml, &["mcp".into(), "gh".into()]).is_some());

        assert!(document_to_value(ConfigFormat::Json, "{oops").is_err());
        assert!(document_to_value(ConfigFormat::Markdown, "# hi").is_err());
        assert!(value_at(&json, &["nothing".into()]).is_none());
    }
}
