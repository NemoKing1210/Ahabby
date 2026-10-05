//! Secret handling for MCP `env` / `headers` values.
//!
//! Rules (security requirement of the spec):
//! * values of secret-looking keys never leave the backend unless the user explicitly
//!   asks for one value (`reveal_mcp_secret`);
//! * the raw JSON shown in the UI is redacted server-side, so masking cannot be
//!   bypassed by reading the "raw" view.

use serde_json::Value;

/// Substrings that mark a key as secret. Matching is case-insensitive and ignores
/// `_` / `-` separators, so `GITHUB_PERSONAL_ACCESS_TOKEN`, `api-key` and `apiKey` all match.
const SECRET_HINTS: &[&str] = &[
    "token",
    "secret",
    "password",
    "passwd",
    "passphrase",
    "apikey",
    "apisecret",
    "privatekey",
    "accesskey",
    "secretkey",
    "authorization",
    "authheader",
    "bearer",
    "credential",
    "clientsecret",
    "sessionkey",
    "cookie",
    "webhookurl",
    "webhook",
    "dsn",
    "connectionstring",
];

pub fn is_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .map(|c| c.to_ascii_lowercase())
        .collect();
    if normalized.is_empty() {
        return false;
    }
    // `path` contains "auth"? no. But guard the most common false positive explicitly.
    if normalized == "path" || normalized == "keypath" || normalized == "publickey" {
        return false;
    }
    SECRET_HINTS.iter().any(|hint| normalized.contains(hint))
}

/// Mask a secret for display: keep a short prefix/suffix so users can still tell
/// two different tokens apart.
pub fn mask_value(value: &str) -> String {
    let chars: Vec<char> = value.chars().collect();
    match chars.len() {
        0 => String::new(),
        1..=8 => "•".repeat(chars.len().max(4)),
        _ => {
            let head: String = chars.iter().take(3).collect();
            let tail: String = chars.iter().skip(chars.len() - 2).collect();
            format!("{head}{}{tail}", "•".repeat(6))
        }
    }
}

/// Recursively redact secret-looking keys inside a JSON document.
pub fn redact_json(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut redacted = serde_json::Map::new();
            for (key, entry) in map {
                if is_secret_key(key) && !entry.is_object() && !entry.is_array() {
                    let masked = match entry {
                        Value::String(text) if text.is_empty() => String::new(),
                        Value::String(text) => mask_value(text),
                        other => mask_value(&other.to_string()),
                    };
                    redacted.insert(key.clone(), Value::String(masked));
                } else {
                    redacted.insert(key.clone(), redact_json(entry));
                }
            }
            Value::Object(redacted)
        }
        Value::Array(items) => Value::Array(items.iter().map(redact_json).collect()),
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn detects_common_secret_keys() {
        assert!(is_secret_key("GITHUB_PERSONAL_ACCESS_TOKEN"));
        assert!(is_secret_key("api_key"));
        assert!(is_secret_key("apiKey"));
        assert!(is_secret_key("ANTHROPIC_API_KEY"));
        assert!(is_secret_key("Authorization"));
        assert!(!is_secret_key("PATH"));
        assert!(!is_secret_key("NODE_ENV"));
        assert!(!is_secret_key("HOME"));
    }

    #[test]
    fn masks_while_keeping_shape() {
        assert_eq!(mask_value(""), "");
        assert_eq!(mask_value("short"), "•••••");
        assert_eq!(mask_value("sk-abcdef1234567890"), "sk-••••••90");
        assert!(!mask_value("sk-abcdef1234567890").contains("abcdef"));
    }

    #[test]
    fn redacts_nested_documents() {
        let masked = redact_json(&json!({
            "command": "npx",
            "env": { "API_KEY": "sk-live-1234567890", "LOG_LEVEL": "debug" },
            "headers": { "Authorization": "Bearer abcdefghijklm" }
        }));
        assert_eq!(masked["command"], "npx");
        assert_eq!(masked["env"]["LOG_LEVEL"], "debug");
        assert!(!masked["env"]["API_KEY"]
            .as_str()
            .unwrap()
            .contains("1234567890"));
        assert!(!masked["headers"]["Authorization"]
            .as_str()
            .unwrap()
            .contains("abcdefghijklm"));
    }
}
