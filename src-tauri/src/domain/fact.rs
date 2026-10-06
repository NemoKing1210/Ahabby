//! "Quick info" lifted out of an agent's config files.
//!
//! A config file is prose to the editor and a document to MCP parsing; this module adds the
//! third reading — the handful of values a user actually wants at a glance: the default
//! model, the provider, an endpoint, a proxy, a token. The extraction rules themselves live
//! in `adapters::config_facts`; this is only the shape that crosses the IPC boundary.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::secrets;

/// What a fact is, which decides how the UI renders it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum FactKind {
    /// The model new sessions start with.
    Model,
    /// The provider or backend the model is routed through.
    Provider,
    /// A URL the agent talks to (base URL, endpoint).
    Url,
    /// A proxy the agent routes through.
    Proxy,
    /// A credential. [`ConfigFact::value`] is masked; the real value only crosses the IPC
    /// boundary through `reveal_config_fact`.
    Secret,
}

impl FactKind {
    /// Order the quick-info panel lists kinds in: identity first, credentials last.
    pub const fn priority(self) -> u8 {
        match self {
            FactKind::Model => 0,
            FactKind::Provider => 1,
            FactKind::Url => 2,
            FactKind::Proxy => 3,
            FactKind::Secret => 4,
        }
    }

    pub const fn is_secret(self) -> bool {
        matches!(self, FactKind::Secret)
    }
}

/// One value read out of one config file, ready to render.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ConfigFact {
    /// `<config id>:<dotted key>` — stable across scans, used as the list key.
    pub id: String,
    pub kind: FactKind,
    /// Dotted key path inside the document, e.g. `model` or `env.ANTHROPIC_API_KEY`.
    pub key: String,
    /// The value as text, with the secret part replaced by a mask when [`ConfigFact::masked`].
    pub value: String,
    /// `true` when the value carries a secret — a token, or a URL with a password in it. The
    /// real text only crosses the IPC boundary through `reveal_config_fact`.
    pub masked: bool,
    /// Id of the config the value came from (matches `ConfigFile::id`).
    pub config_id: String,
    /// Label of that config, for the "where did this come from" hint.
    pub config_label: String,
    /// Absolute path of that config — the address `reveal_config_fact` takes back.
    pub config_path: String,
}

impl ConfigFact {
    /// Build a fact, masking the value when it carries a secret.
    pub fn new(
        kind: FactKind,
        key: &str,
        value: &str,
        config_id: &str,
        config_label: &str,
        config_path: &str,
    ) -> Self {
        // A token is secret by kind; a proxy or endpoint that embeds `user:password@` is
        // secret by its value, which the key name would never reveal.
        let masked = kind.is_secret() || secrets::has_url_credentials(value);
        let display = if kind.is_secret() {
            secrets::mask_value(value)
        } else if masked {
            secrets::mask_url_credentials(value)
        } else {
            value.to_string()
        };
        ConfigFact {
            id: format!("{config_id}:{key}"),
            kind,
            key: key.to_string(),
            value: display,
            masked,
            config_id: config_id.to_string(),
            config_label: config_label.to_string(),
            config_path: config_path.to_string(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn secret_values_are_masked() {
        let fact = ConfigFact::new(
            FactKind::Secret,
            "env.ANTHROPIC_API_KEY",
            "sk-ant-1234567890abcdef",
            "settings",
            "User settings",
            "/home/u/.claude/settings.json",
        );
        assert!(!fact.value.contains("1234567890"));
        assert!(fact.masked);
        assert_eq!(fact.id, "settings:env.ANTHROPIC_API_KEY");
    }

    #[test]
    fn masks_credentials_inside_a_url_but_keeps_the_host() {
        let fact = ConfigFact::new(
            FactKind::Proxy,
            "env.HTTPS_PROXY",
            "http://user:s3cr3t@proxy.example.com:8080",
            "settings",
            "User settings",
            "/home/u/.claude/settings.json",
        );
        assert!(fact.masked);
        assert_eq!(fact.value, "http://••••••@proxy.example.com:8080");
        assert!(!fact.value.contains("s3cr3t"));
        assert!(!fact.value.contains("user"));
    }

    #[test]
    fn plain_values_pass_through() {
        let fact = ConfigFact::new(
            FactKind::Model,
            "model",
            "gpt-5-codex",
            "config",
            "config.toml",
            "/home/u/.codex/config.toml",
        );
        assert_eq!(fact.value, "gpt-5-codex");
        assert!(!fact.masked);
    }
}
