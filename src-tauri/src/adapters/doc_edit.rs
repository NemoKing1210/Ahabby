//! Format-preserving edits of structured config documents.
//!
//! Removing an MCP server from a user's config must not reformat the rest of the file:
//! TOML goes through `toml_edit` (comments and spacing survive), JSON through
//! `serde_json` with `preserve_order` (key order survives), YAML through `serde_yaml`.
//! The result is always validated before it is written anywhere.

use serde_json::Value;

use crate::domain::ConfigFormat;
use crate::error::{AppError, Result};

/// A leading UTF-8 BOM is an encoding artefact: parsers must ignore it, writers must keep it
/// (which is why only the parsing paths strip it).
pub(crate) fn trim_bom(text: &str) -> &str {
    text.strip_prefix('\u{feff}').unwrap_or(text)
}

/// Validate a document of the given format.
pub fn validate(format: ConfigFormat, content: &str, path: &str) -> Result<()> {
    let outcome = match format {
        ConfigFormat::Json => serde_json::from_str::<Value>(trim_bom(content))
            .map(|_| ())
            .map_err(|error| error.to_string()),
        ConfigFormat::Jsonc => super::jsonc::validate(content),
        ConfigFormat::Toml => content
            .parse::<toml_edit::DocumentMut>()
            .map(|_| ())
            .map_err(|error| error.to_string()),
        ConfigFormat::Yaml => match serde_yaml::from_str::<serde_yaml::Value>(content) {
            Ok(_) => Ok(()),
            Err(error) => Err(error.to_string()),
        },
        ConfigFormat::Markdown | ConfigFormat::Text => Ok(()),
    };
    outcome.map_err(|message| AppError::invalid_format(format.name(), path, message))
}

/// Remove `key_path` from a document. `Ok(None)` means the entry was not there.
pub fn remove_entry(
    format: ConfigFormat,
    content: &str,
    key_path: &[String],
) -> Result<Option<String>> {
    if key_path.is_empty() {
        return Err(AppError::InvalidInput(
            "an empty key path cannot be removed".to_string(),
        ));
    }
    match format {
        ConfigFormat::Json => remove_json(trim_bom(content), key_path),
        ConfigFormat::Jsonc => super::jsonc::remove_member(content, key_path)
            .map_err(|message| AppError::invalid_format("jsonc", "<memory>", message)),
        ConfigFormat::Toml => remove_toml(content, key_path),
        ConfigFormat::Yaml => remove_yaml(content, key_path),
        ConfigFormat::Markdown | ConfigFormat::Text => Err(AppError::NotSupported(
            "this format does not hold structured data".to_string(),
        )),
    }
}

fn remove_json(content: &str, key_path: &[String]) -> Result<Option<String>> {
    let mut document: Value = serde_json::from_str(content)
        .map_err(|error| AppError::invalid_format("json", "<memory>", error.to_string()))?;

    let (parents, last) = key_path.split_at(key_path.len() - 1);
    let mut cursor = &mut document;
    for segment in parents {
        match cursor.get_mut(segment.as_str()) {
            Some(next) => cursor = next,
            None => return Ok(None),
        }
    }
    let Some(object) = cursor.as_object_mut() else {
        return Ok(None);
    };
    if object.remove(&last[0]).is_none() {
        return Ok(None);
    }

    let mut text = serde_json::to_string_pretty(&document)
        .map_err(|error| AppError::other(format!("cannot serialize JSON: {error}")))?;
    text.push('\n');
    Ok(Some(text))
}

fn remove_toml(content: &str, key_path: &[String]) -> Result<Option<String>> {
    let mut document: toml_edit::DocumentMut =
        content.parse().map_err(|error: toml_edit::TomlError| {
            AppError::invalid_format("toml", "<memory>", error.to_string())
        })?;

    let (parents, last) = key_path.split_at(key_path.len() - 1);
    let mut cursor: &mut toml_edit::Item = document.as_item_mut();
    for segment in parents {
        let Some(table) = cursor.as_table_like_mut() else {
            return Ok(None);
        };
        let Some(next) = table.get_mut(segment.as_str()) else {
            return Ok(None);
        };
        cursor = next;
    }
    let Some(table) = cursor.as_table_like_mut() else {
        return Ok(None);
    };
    if table.remove(&last[0]).is_none() {
        return Ok(None);
    }
    Ok(Some(document.to_string()))
}

fn remove_yaml(content: &str, key_path: &[String]) -> Result<Option<String>> {
    let mut document: serde_yaml::Value = serde_yaml::from_str(content)
        .map_err(|error| AppError::invalid_format("yaml", "<memory>", error.to_string()))?;

    let (parents, last) = key_path.split_at(key_path.len() - 1);
    let mut cursor = &mut document;
    for segment in parents {
        match cursor.get_mut(serde_yaml::Value::String(segment.clone())) {
            Some(next) => cursor = next,
            None => return Ok(None),
        }
    }
    let Some(mapping) = cursor.as_mapping_mut() else {
        return Ok(None);
    };
    if mapping
        .remove(serde_yaml::Value::String(last[0].clone()))
        .is_none()
    {
        return Ok(None);
    }
    let text = serde_yaml::to_string(&document)
        .map_err(|error| AppError::other(format!("cannot serialize YAML: {error}")))?;
    Ok(Some(text))
}

/// `mcpServers.<name>` inside the document, for error messages.
pub fn describe_path(key_path: &[String]) -> String {
    key_path.join(".")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn removes_from_json_keeping_key_order() {
        let content = r#"{
  "zeta": 1,
  "mcpServers": {
    "github": { "command": "npx" },
    "linear": { "command": "npx" }
  },
  "alpha": 2
}
"#;
        let updated = remove_entry(
            ConfigFormat::Json,
            content,
            &["mcpServers".into(), "linear".into()],
        )
        .unwrap()
        .expect("entry exists");

        let keys: Vec<&str> = updated
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim_start();
                trimmed
                    .strip_prefix('"')
                    .and_then(|rest| rest.split('"').next())
            })
            .collect();
        assert_eq!(&keys[..3], &["zeta", "mcpServers", "github"]);
        assert!(!updated.contains("linear"));
        assert!(updated.ends_with('\n'));
        validate(ConfigFormat::Json, &updated, "x").unwrap();
    }

    #[test]
    fn removes_from_toml_keeping_comments() {
        let content = r#"# Ahabby test config
model = "gpt-5"   # the important one

[mcp_servers.github]
command = "npx"
args = ["-y", "server"]

# keep me
[mcp_servers.linear]
command = "npx"
"#;
        let updated = remove_entry(
            ConfigFormat::Toml,
            content,
            &["mcp_servers".into(), "linear".into()],
        )
        .unwrap()
        .expect("entry exists");

        assert!(updated.contains("# Ahabby test config"));
        assert!(updated.contains("# the important one"));
        assert!(updated.contains("model = \"gpt-5\"   # the important one"));
        assert!(updated.contains("[mcp_servers.github]"));
        assert!(!updated.contains("linear"));
        validate(ConfigFormat::Toml, &updated, "x").unwrap();
    }

    #[test]
    fn removes_inline_toml_tables() {
        let content =
            "[mcp_servers]\ngithub = { command = \"npx\" }\nlinear = { command = \"npx\" }\n";
        let updated = remove_entry(
            ConfigFormat::Toml,
            content,
            &["mcp_servers".into(), "github".into()],
        )
        .unwrap()
        .unwrap();
        assert!(!updated.contains("github"));
        assert!(updated.contains("linear"));
    }

    #[test]
    fn removes_from_yaml() {
        let content = "mcp:\n  github:\n    command: npx\n  linear:\n    command: npx\n";
        let updated = remove_entry(
            ConfigFormat::Yaml,
            content,
            &["mcp".into(), "github".into()],
        )
        .unwrap()
        .unwrap();
        assert!(!updated.contains("github"));
        assert!(updated.contains("linear"));
    }

    #[test]
    fn missing_entries_and_bad_paths_are_not_errors() {
        assert!(
            remove_entry(ConfigFormat::Json, "{\"a\":{}}", &["a".into(), "b".into()])
                .unwrap()
                .is_none()
        );
        assert!(remove_entry(
            ConfigFormat::Json,
            "{\"a\":{}}",
            &["nope".into(), "b".into()]
        )
        .unwrap()
        .is_none());
        assert!(
            remove_entry(ConfigFormat::Json, "{\"a\":1}", &["a".into(), "b".into()])
                .unwrap()
                .is_none()
        );
        assert!(remove_entry(ConfigFormat::Json, "{}", &[]).is_err());
        assert!(remove_entry(ConfigFormat::Markdown, "# hi", &["a".into()]).is_err());
    }

    #[test]
    fn validate_rejects_broken_documents() {
        assert!(validate(ConfigFormat::Json, "{}", "x").is_ok());
        assert!(validate(ConfigFormat::Toml, "a = 1", "x").is_ok());
        assert!(validate(ConfigFormat::Yaml, "a: 1", "x").is_ok());
        assert!(validate(ConfigFormat::Markdown, "# anything", "x").is_ok());

        let error = validate(ConfigFormat::Json, "{} trailing", "/tmp/x.json").unwrap_err();
        assert_eq!(error.code(), "invalid_format");
        assert!(validate(ConfigFormat::Toml, "= broken", "x").is_err());
        assert!(validate(ConfigFormat::Yaml, "a: [", "x").is_err());
    }
}
