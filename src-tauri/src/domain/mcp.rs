use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::scope::Scope;

/// Transport of an MCP server, normalised across the many shapes agents use.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum McpTransport {
    /// A local process: `command` + `args`, optionally with `env`.
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
    },
    /// A remote server reached over HTTP (including SSE / streamable HTTP).
    Http {
        url: String,
        /// `http`, `sse`, `streamable-http` or whatever the config called it.
        protocol: String,
    },
    /// Recognised as an MCP entry, but not as a shape Ahabby understands.
    Unknown { detail: String },
}

impl McpTransport {
    pub const fn label(&self) -> &'static str {
        match self {
            McpTransport::Stdio { .. } => "stdio",
            McpTransport::Http { .. } => "http",
            McpTransport::Unknown { .. } => "unknown",
        }
    }
}

/// One environment variable / header. `value` is `None` while masked, which is the
/// default: the frontend has to ask for a single value explicitly to see it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct EnvVar {
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub value: Option<String>,
    pub masked: bool,
}

/// An MCP server entry found in an agent's config.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct McpServer {
    pub id: String,
    pub name: String,
    pub transport: McpTransport,
    pub scope: Scope,
    pub agent: AgentRef,
    /// Config file the entry lives in.
    pub source_config: String,
    /// Path inside the document (`["mcpServers", "github"]`) — needed to delete exactly this entry.
    pub key_path: Vec<String>,
    #[serde(default)]
    pub env: Vec<EnvVar>,
    #[serde(default)]
    pub headers: Vec<EnvVar>,
    /// Server entry as JSON, **already redacted** server side.
    pub raw: String,
    /// Creation time of the config file the entry lives in, when the platform reports one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub created_ms: Option<i64>,
    /// Modification time of that same file.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub modified_ms: Option<i64>,
    pub has_secrets: bool,
    pub removable: bool,
    pub unverified: bool,
}

impl McpServer {
    pub fn new_id(name: &str, source_config: &str, key_path: &[String]) -> String {
        let seed = format!("{source_config}|{}", key_path.join("."));
        format!("{}#{}", name, crate::domain::skill::short_hash(&seed))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_depend_on_the_exact_location() {
        let a = McpServer::new_id("gh", "/cfg.json", &["mcpServers".into(), "gh".into()]);
        let b = McpServer::new_id("gh", "/cfg.json", &["mcpServers".into(), "gh".into()]);
        let c = McpServer::new_id("gh", "/other.json", &["mcpServers".into(), "gh".into()]);
        assert_eq!(a, b);
        assert_ne!(a, c);
    }

    #[test]
    fn transport_serializes_with_type_tag() {
        let value = serde_json::to_value(McpTransport::Stdio {
            command: "npx".into(),
            args: vec!["-y".into(), "server".into()],
        })
        .unwrap();
        assert_eq!(value["type"], "stdio");
        assert_eq!(value["command"], "npx");
        assert_eq!(value["args"][1], "server");
    }
}
