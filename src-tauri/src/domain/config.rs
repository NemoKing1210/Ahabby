use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::agent::AgentRef;
use super::scope::Scope;

/// Syntax of a config file. Drives validation and the editor's grammar.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum ConfigFormat {
    Json,
    /// JSON with comments and trailing commas (Cursor, opencode).
    Jsonc,
    Toml,
    Yaml,
    Markdown,
    Text,
}

impl ConfigFormat {
    pub const fn name(self) -> &'static str {
        match self {
            ConfigFormat::Json => "json",
            ConfigFormat::Jsonc => "jsonc",
            ConfigFormat::Toml => "toml",
            ConfigFormat::Yaml => "yaml",
            ConfigFormat::Markdown => "markdown",
            ConfigFormat::Text => "text",
        }
    }

    /// Structured formats are validated before writing; prose formats only get a UTF-8 check.
    pub const fn is_structured(self) -> bool {
        matches!(
            self,
            ConfigFormat::Json | ConfigFormat::Jsonc | ConfigFormat::Toml | ConfigFormat::Yaml
        )
    }

    pub fn from_extension(path: &str) -> ConfigFormat {
        let lower = path.to_ascii_lowercase();
        let extension = lower.rsplit('.').next().unwrap_or("");
        match extension {
            "json" => ConfigFormat::Json,
            "jsonc" => ConfigFormat::Jsonc,
            "toml" => ConfigFormat::Toml,
            "yaml" | "yml" => ConfigFormat::Yaml,
            "md" | "markdown" | "mdx" => ConfigFormat::Markdown,
            _ => ConfigFormat::Text,
        }
    }
}

/// A config file discovered on disk (or declared by a manifest but missing).
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ConfigFile {
    pub id: String,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    pub path: String,
    pub format: ConfigFormat,
    pub scope: Scope,
    pub agent: AgentRef,
    pub exists: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub size_bytes: Option<u64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(type = "number | null")]
    pub modified_ms: Option<i64>,
    /// `false` when Ahabby must not write this file (binaries, caches, ...).
    pub editable: bool,
}

/// The contents of a config file plus everything needed for a safe write:
/// we hand the hash back to the frontend and require it when saving, so a file
/// changed by someone else in the meantime is never silently overwritten.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ConfigSnapshot {
    pub path: String,
    pub format: ConfigFormat,
    pub content: String,
    pub sha256: String,
    #[ts(type = "number")]
    pub size_bytes: u64,
    #[ts(type = "number")]
    pub modified_ms: i64,
    pub exists: bool,
    pub truncated: bool,
    pub editable: bool,
}

/// Unified diff preview returned by `preview_config_save`.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct DiffPreview {
    pub path: String,
    pub unified: String,
    pub added: usize,
    pub removed: usize,
    /// Problems found by the format validator (blocking).
    pub errors: Vec<String>,
    /// `true` when the on-disk hash still matches the hash the editor started from.
    pub in_sync: bool,
    pub current_sha256: String,
}

/// Result of a successful write.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct SaveResult {
    pub path: String,
    pub sha256: String,
    #[ts(type = "number")]
    pub modified_ms: i64,
    #[ts(type = "number")]
    pub size_bytes: u64,
    /// Path of the timestamped backup taken before the write.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub backup_path: Option<String>,
}

/// A timestamped backup of a config file.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct BackupEntry {
    /// Backup file path (the thing to restore from).
    pub path: String,
    /// The file this backup belongs to.
    pub original_path: String,
    #[ts(type = "number")]
    pub created_ms: i64,
    #[ts(type = "number")]
    pub size_bytes: u64,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_format_from_extension() {
        assert_eq!(
            ConfigFormat::from_extension("/a/b.json"),
            ConfigFormat::Json
        );
        assert_eq!(
            ConfigFormat::from_extension("config.TOML"),
            ConfigFormat::Toml
        );
        assert_eq!(ConfigFormat::from_extension("x.yml"), ConfigFormat::Yaml);
        assert_eq!(
            ConfigFormat::from_extension("CLAUDE.md"),
            ConfigFormat::Markdown
        );
        assert_eq!(ConfigFormat::from_extension("noext"), ConfigFormat::Text);
    }
}
