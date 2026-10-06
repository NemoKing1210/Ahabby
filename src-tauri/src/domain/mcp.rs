use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::manifest::McpEntryShape;
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

/// One environment variable / header the user typed into the creation form.
///
/// Unlike [`EnvVar`] the value is always present and never masked: it comes from the form,
/// not from a file Ahabby read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct McpKeyValue {
    pub key: String,
    pub value: String,
}

/// Transport of a server the user is creating. The concrete entry shape is the manifest's
/// ([`McpEntryShape`]): the same form writes the shared convention or opencode's `type: local`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum McpDraftTransport {
    /// A local process: command, arguments and environment variables.
    Stdio {
        command: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default)]
        env: Vec<McpKeyValue>,
    },
    /// A remote server: a URL and the headers to send with every request.
    Http {
        url: String,
        #[serde(default)]
        headers: Vec<McpKeyValue>,
    },
}

impl McpDraftTransport {
    /// The entry to write, in the shape the agent's manifest declares.
    pub fn to_entry(&self, shape: McpEntryShape) -> serde_json::Value {
        match shape {
            McpEntryShape::Local => self.local_entry(),
            // A spec that keeps its servers in a list never reaches here — the adapter refuses
            // creation for it — so the shared convention is the honest fallback.
            McpEntryShape::Command | McpEntryShape::List => self.command_entry(),
        }
    }

    /// The convention most agents share:
    /// `{ "command": ..., "args": [...], "env": {...} }` or `{ "type": "http", "url": ..., "headers": {...} }`.
    fn command_entry(&self) -> serde_json::Value {
        match self {
            McpDraftTransport::Stdio { command, args, env } => {
                let mut map = serde_json::Map::new();
                map.insert(
                    "command".to_string(),
                    serde_json::Value::String(command.clone()),
                );
                if !args.is_empty() {
                    map.insert("args".to_string(), serde_json::json!(args));
                }
                if !env.is_empty() {
                    map.insert("env".to_string(), pairs(env));
                }
                serde_json::Value::Object(map)
            }
            McpDraftTransport::Http { url, headers } => {
                let mut map = serde_json::Map::new();
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String("http".to_string()),
                );
                map.insert("url".to_string(), serde_json::Value::String(url.clone()));
                if !headers.is_empty() {
                    map.insert("headers".to_string(), pairs(headers));
                }
                serde_json::Value::Object(map)
            }
        }
    }

    /// opencode's shape: one `command` array, `environment`, and an explicit `type`.
    fn local_entry(&self) -> serde_json::Value {
        match self {
            McpDraftTransport::Stdio { command, args, env } => {
                let mut map = serde_json::Map::new();
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String("local".to_string()),
                );
                let mut tokens = vec![command.clone()];
                tokens.extend(args.iter().cloned());
                map.insert("command".to_string(), serde_json::json!(tokens));
                if !env.is_empty() {
                    map.insert("environment".to_string(), pairs(env));
                }
                serde_json::Value::Object(map)
            }
            McpDraftTransport::Http { url, headers } => {
                let mut map = serde_json::Map::new();
                map.insert(
                    "type".to_string(),
                    serde_json::Value::String("remote".to_string()),
                );
                map.insert("url".to_string(), serde_json::Value::String(url.clone()));
                if !headers.is_empty() {
                    map.insert("headers".to_string(), pairs(headers));
                }
                serde_json::Value::Object(map)
            }
        }
    }
}

fn pairs(entries: &[McpKeyValue]) -> serde_json::Value {
    let mut map = serde_json::Map::new();
    for entry in entries {
        map.insert(
            entry.key.clone(),
            serde_json::Value::String(entry.value.clone()),
        );
    }
    serde_json::Value::Object(map)
}

/// What the frontend sends to create an MCP server of its own.
///
/// The entry is written into the config file the manifest already declares, at the
/// `name -> server` position the reader uses, so the new server is a first-class entry from
/// the moment it is written (switchable and removable like any other).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct McpServerDraft {
    /// Key the entry is stored under (`mcpServers.<name>`).
    pub name: String,
    pub transport: McpDraftTransport,
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
    /// `false` while the user has the server switched off: the entry lives in the sibling
    /// `<container>Disabled` object of the same config file, where no agent looks for servers.
    /// `key_path` always addresses the entry's *enabled* position, so the switch can go back.
    #[serde(default = "super::default_true")]
    pub enabled: bool,
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
    fn draft_entries_follow_the_declared_shape() {
        let stdio = McpDraftTransport::Stdio {
            command: "npx".into(),
            args: vec!["-y".into(), "server".into()],
            env: vec![McpKeyValue {
                key: "TOKEN".into(),
                value: "x".into(),
            }],
        };
        let shared = stdio.to_entry(McpEntryShape::Command);
        assert_eq!(shared["command"], "npx");
        assert_eq!(shared["args"][1], "server");
        assert_eq!(shared["env"]["TOKEN"], "x");
        assert!(shared.get("type").is_none());

        // opencode wants one command array and calls the env map `environment`.
        let local = stdio.to_entry(McpEntryShape::Local);
        assert_eq!(local["type"], "local");
        assert_eq!(local["command"][0], "npx");
        assert_eq!(local["command"][2], "server");
        assert_eq!(local["environment"]["TOKEN"], "x");
        assert!(local.get("args").is_none());

        let http = McpDraftTransport::Http {
            url: "https://example.com/mcp".into(),
            headers: Vec::new(),
        };
        assert_eq!(http.to_entry(McpEntryShape::Command)["type"], "http");
        assert_eq!(http.to_entry(McpEntryShape::Local)["type"], "remote");
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
