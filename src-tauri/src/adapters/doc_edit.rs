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

/// Suffix appended to the last segment of a container path to address the entries a toggle
/// turned off: `["mcpServers"]` → `["mcpServersDisabled"]`.
pub const DISABLED_CONTAINER_SUFFIX: &str = "Disabled";

/// Container that holds the disabled siblings of `container`'s entries; `None` when `container`
/// is empty.
pub fn disabled_container(container: &[String]) -> Option<Vec<String>> {
    let (last, parents) = container.split_last()?;
    let mut disabled = parents.to_vec();
    disabled.push(format!("{last}{DISABLED_CONTAINER_SUFFIX}"));
    Some(disabled)
}

/// Full address of the entry `key_path` (container + own name) once it has been turned off.
pub fn disabled_entry_path(key_path: &[String]) -> Option<Vec<String>> {
    let (name, container) = key_path.split_last()?;
    let mut disabled = disabled_container(container)?;
    disabled.push(name.clone());
    Some(disabled)
}

/// Move the member at `from` to `to` (both container path + own name).
///
/// * `Ok(None)` — there is no member at `from`.
/// * `Err(AppError::InvalidInput)` — a member already exists at `to`.
/// * `Err(AppError::NotSupported)` — Markdown/Text.
///
/// JSON and JSONC go through [`super::jsonc::move_member`] (byte preserving). TOML goes through
/// `toml_edit` and YAML through `serde_yaml`: the moved member keeps its key order, and TOML
/// keeps the member's own comments/formatting; a missing destination container, including a
/// missing intermediate, is created the same way as in the JSON case.
pub fn move_entry(
    format: ConfigFormat,
    content: &str,
    from: &[String],
    to: &[String],
) -> Result<Option<String>> {
    if from.is_empty() || to.is_empty() {
        return Err(AppError::InvalidInput(
            "a move needs a source and a destination key path".to_string(),
        ));
    }
    match format {
        // Asking first keeps the error for an occupied destination the same across formats:
        // `move_member` can only answer with a plain message, which reads as a broken document.
        ConfigFormat::Json | ConfigFormat::Jsonc => {
            if super::jsonc::has_member(content, to) {
                return Err(occupied(to));
            }
            super::jsonc::move_member(content, from, to)
                .map_err(|message| AppError::invalid_format(format.name(), "<memory>", message))
        }
        ConfigFormat::Toml => move_toml(content, from, to),
        ConfigFormat::Yaml => move_yaml(content, from, to),
        ConfigFormat::Markdown | ConfigFormat::Text => Err(AppError::NotSupported(
            "this format does not hold structured data".to_string(),
        )),
    }
}

/// The error a move reports when the destination already holds a member.
fn occupied(to: &[String]) -> AppError {
    let path = describe_path(to);
    AppError::InvalidInput(format!("{path} already holds an entry"))
}

fn move_toml(content: &str, from: &[String], to: &[String]) -> Result<Option<String>> {
    let mut document: toml_edit::DocumentMut =
        content.parse().map_err(|error: toml_edit::TomlError| {
            AppError::invalid_format("toml", "<memory>", error.to_string())
        })?;

    // A missing source is not an error; an occupied destination is.
    if toml_item(&document, from).is_none() {
        return Ok(None);
    }
    if toml_item(&document, to).is_some() {
        return Err(occupied(to));
    }

    let (from_parents, from_last) = from.split_at(from.len() - 1);
    let mut cursor: &mut toml_edit::Item = document.as_item_mut();
    for segment in from_parents {
        let Some(table) = cursor.as_table_like_mut() else {
            return Ok(None);
        };
        let Some(next) = table.get_mut(segment.as_str()) else {
            return Ok(None);
        };
        cursor = next;
    }
    let Some(source) = cursor.as_table_like_mut() else {
        return Ok(None);
    };
    // The item travels whole, so its own comments and formatting go with it.
    let Some(moved) = source.remove(&from_last[0]) else {
        return Ok(None);
    };

    let (to_parents, to_last) = to.split_at(to.len() - 1);
    let destination = toml_table_mut(document.as_table_mut(), to_parents)?;
    let _ = destination.insert(&to_last[0], moved);

    Ok(Some(document.to_string()))
}

/// The `toml_edit` item at `path`, if the document has one.
fn toml_item<'d>(
    document: &'d toml_edit::DocumentMut,
    path: &[String],
) -> Option<&'d toml_edit::Item> {
    let mut cursor: &toml_edit::Item = document.as_item();
    for segment in path {
        cursor = cursor.as_table_like()?.get(segment.as_str())?;
    }
    Some(cursor)
}

/// The table at `path`, creating the missing tables along the way.
fn toml_table_mut<'d>(
    table: &'d mut dyn toml_edit::TableLike,
    path: &[String],
) -> Result<&'d mut dyn toml_edit::TableLike> {
    let Some((segment, rest)) = path.split_first() else {
        return Ok(table);
    };
    if !table.contains_key(segment.as_str()) {
        let mut created = toml_edit::Table::new();
        // An added container only exists to hold the moved member, so it must not print a
        // header of its own: the member renders as `[container.member]`.
        created.set_implicit(true);
        let _ = table.insert(segment.as_str(), toml_edit::Item::Table(created));
    }
    let next = table.get_mut(segment.as_str()).ok_or_else(|| {
        AppError::invalid_format("toml", "<memory>", "the destination is not a table")
    })?;
    let nested = next.as_table_like_mut().ok_or_else(|| {
        AppError::invalid_format("toml", "<memory>", "the destination is not a table")
    })?;
    toml_table_mut(nested, rest)
}

fn move_yaml(content: &str, from: &[String], to: &[String]) -> Result<Option<String>> {
    let mut document: serde_yaml::Value = serde_yaml::from_str(content)
        .map_err(|error| AppError::invalid_format("yaml", "<memory>", error.to_string()))?;

    if yaml_get(&document, from).is_none() {
        return Ok(None);
    }
    if yaml_get(&document, to).is_some() {
        return Err(occupied(to));
    }

    let (from_parents, from_last) = from.split_at(from.len() - 1);
    let mut cursor = &mut document;
    for segment in from_parents {
        match cursor.get_mut(serde_yaml::Value::String(segment.clone())) {
            Some(next) => cursor = next,
            None => return Ok(None),
        }
    }
    let Some(source) = cursor.as_mapping_mut() else {
        return Ok(None);
    };
    let Some(moved) = source.remove(serde_yaml::Value::String(from_last[0].clone())) else {
        return Ok(None);
    };

    let (to_parents, to_last) = to.split_at(to.len() - 1);
    let destination = yaml_mapping_mut(&mut document, to_parents).ok_or_else(|| {
        AppError::invalid_format("yaml", "<memory>", "the destination is not a mapping")
    })?;
    let _ = destination.insert(serde_yaml::Value::String(to_last[0].clone()), moved);

    let text = serde_yaml::to_string(&document)
        .map_err(|error| AppError::other(format!("cannot serialize YAML: {error}")))?;
    Ok(Some(text))
}

/// The value at `path`, if the document has one.
fn yaml_get<'a>(document: &'a serde_yaml::Value, path: &[String]) -> Option<&'a serde_yaml::Value> {
    let mut cursor = document;
    for segment in path {
        cursor = cursor.get(serde_yaml::Value::String(segment.clone()))?;
    }
    Some(cursor)
}

/// The mapping at `path`, creating the missing mappings along the way.
fn yaml_mapping_mut<'a>(
    document: &'a mut serde_yaml::Value,
    path: &[String],
) -> Option<&'a mut serde_yaml::Mapping> {
    let mut cursor = document;
    for segment in path {
        let key = serde_yaml::Value::String(segment.clone());
        if !cursor.is_mapping() {
            return None;
        }
        if cursor.get(key.clone()).is_none() {
            let _ = cursor.as_mapping_mut()?.insert(
                key.clone(),
                serde_yaml::Value::Mapping(serde_yaml::Mapping::new()),
            );
        }
        cursor = cursor.get_mut(key)?;
    }
    cursor.as_mapping_mut()
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

    fn disabled_entry(container: &[&str], name: &str) -> Vec<String> {
        let mut key_path: Vec<String> = container
            .iter()
            .map(|segment| (*segment).to_string())
            .collect();
        key_path.push(name.to_string());
        disabled_entry_path(&key_path).expect("a nested entry can be disabled")
    }

    #[test]
    fn disabled_paths_append_the_suffix_to_the_container() {
        assert_eq!(
            disabled_container(&["mcpServers".into()]),
            Some(vec!["mcpServersDisabled".to_string()])
        );
        assert_eq!(
            disabled_container(&["a".into(), "b".into()]),
            Some(vec!["a".to_string(), "bDisabled".to_string()])
        );
        assert_eq!(disabled_container(&[]), None);

        assert_eq!(
            disabled_entry_path(&["mcpServers".into(), "github".into()]),
            Some(vec!["mcpServersDisabled".to_string(), "github".to_string()])
        );
        assert_eq!(disabled_entry_path(&["mcpServers".into()]), None);
        assert_eq!(disabled_entry_path(&[]), None);
    }

    #[test]
    fn moves_a_json_member() {
        let content = r#"{
  "mcpServers": {
    "github": { "command": "npx" },
    "linear": { "command": "npx" }
  }
}
"#;
        let updated = move_entry(
            ConfigFormat::Json,
            content,
            &["mcpServers".into(), "github".into()],
            &disabled_entry(&["mcpServers"], "github"),
        )
        .unwrap()
        .expect("entry exists");

        validate(ConfigFormat::Json, &updated, "x").unwrap();
        let value: serde_json::Value = serde_json::from_str(&updated).unwrap();
        assert!(value["mcpServers"].get("github").is_none());
        assert_eq!(value["mcpServersDisabled"]["github"]["command"], "npx");
        assert_eq!(value["mcpServers"]["linear"]["command"], "npx");
    }

    #[test]
    fn moves_a_jsonc_member_byte_for_byte() {
        let content = r#"{
  // keep this note
  "mcpServers": {
    "linear": { "command": "npx" },
    "github": { "command": "npx" }
  },
  "note": "keep me"
}
"#;
        let expected = r#"{
  // keep this note
  "mcpServers": {
    "linear": { "command": "npx" }
  },
  "note": "keep me",
  "mcpServersDisabled": {
    "github": { "command": "npx" }
  }
}
"#;
        let updated = move_entry(
            ConfigFormat::Jsonc,
            content,
            &["mcpServers".into(), "github".into()],
            &disabled_entry(&["mcpServers"], "github"),
        )
        .unwrap()
        .expect("entry exists");

        assert_eq!(updated, expected, "the document survives byte for byte");
        validate(ConfigFormat::Jsonc, &updated, "x").unwrap();
    }

    #[test]
    fn moves_a_toml_member_keeping_comments_and_key_order() {
        let content = r#"# Ahabby test config
model = "gpt-5"   # the important one

[mcp_servers.github]
command = "npx"
args = ["-y", "server"]

# keep me
[mcp_servers.linear]
command = "npx"
env = { TOKEN = "x" }
"#;
        let updated = move_entry(
            ConfigFormat::Toml,
            content,
            &["mcp_servers".into(), "linear".into()],
            &disabled_entry(&["mcp_servers"], "linear"),
        )
        .unwrap()
        .expect("entry exists");

        validate(ConfigFormat::Toml, &updated, "x").unwrap();
        let value: toml_edit::DocumentMut = updated.parse().unwrap();
        assert!(toml_item(&value, &["mcp_servers".into(), "linear".into()]).is_none());
        let moved = toml_item(&value, &["mcp_serversDisabled".into(), "linear".into()])
            .expect("the member is under the new container");
        assert!(moved.is_table_like(), "the member stays a table");
        assert!(updated.contains("# Ahabby test config"));
        assert!(updated.contains("# the important one"));
        assert!(updated.contains("# keep me"));
        let command = updated.find("command").expect("command survives");
        let env = updated.find("env").expect("env survives");
        assert!(command < env, "the member keeps its own key order");
    }

    #[test]
    fn moves_into_an_existing_toml_container() {
        let content = r#"[mcp_servers]
linear = { command = "npx" }

[mcp_serversDisabled]
playwright = { command = "npx" }

[mcp_servers.github]
command = "npx"
"#;
        let updated = move_entry(
            ConfigFormat::Toml,
            content,
            &["mcp_servers".into(), "github".into()],
            &disabled_entry(&["mcp_servers"], "github"),
        )
        .unwrap()
        .expect("entry exists");

        validate(ConfigFormat::Toml, &updated, "x").unwrap();
        let value: toml_edit::DocumentMut = updated.parse().unwrap();
        assert!(toml_item(&value, &["mcp_servers".into(), "github".into()]).is_none());
        assert!(toml_item(&value, &["mcp_serversDisabled".into(), "github".into()]).is_some());
        assert!(toml_item(&value, &["mcp_serversDisabled".into(), "playwright".into()]).is_some());
        assert!(toml_item(&value, &["mcp_servers".into(), "linear".into()]).is_some());
    }

    #[test]
    fn tom_move_creates_nested_containers() {
        let content = "[a]\nz = 1\ny = 2\n\n[c.d]\nq = 4\n";
        let updated = move_entry(
            ConfigFormat::Toml,
            content,
            &["a".into()],
            &["c".into(), "aDisabled".into()],
        )
        .unwrap()
        .expect("entry exists");

        let value: toml_edit::DocumentMut = updated.parse().unwrap();
        assert!(toml_item(&value, &["a".into()]).is_none());
        let moved = toml_item(&value, &["c".into(), "aDisabled".into()]).expect("moved table");
        assert!(moved.as_table_like().is_some());
        assert!(toml_item(&value, &["c".into(), "d".into()]).is_some());
        let z = updated.find("z = 1").expect("z survives");
        let y = updated.find("y = 2").expect("y survives");
        assert!(z < y, "the moved table keeps its own key order");
    }

    #[test]
    fn moves_a_yaml_member() {
        let content = "mcp:\n  github:\n    command: npx\n  linear:\n    command: npx\n";
        let updated = move_entry(
            ConfigFormat::Yaml,
            content,
            &["mcp".into(), "github".into()],
            &disabled_entry(&["mcp"], "github"),
        )
        .unwrap()
        .expect("entry exists");

        let value: serde_yaml::Value = serde_yaml::from_str(&updated).unwrap();
        assert!(yaml_get(&value, &["mcp".into(), "github".into()]).is_none());
        assert_eq!(
            yaml_get(
                &value,
                &["mcpDisabled".into(), "github".into(), "command".into()]
            )
            .and_then(|found| found.as_str()),
            Some("npx")
        );
        assert_eq!(
            yaml_get(&value, &["mcp".into(), "linear".into(), "command".into()])
                .and_then(|found| found.as_str()),
            Some("npx")
        );
    }

    #[test]
    fn move_creates_a_missing_container_in_every_format() {
        let json = move_entry(
            ConfigFormat::Json,
            r#"{"mcpServers":{"github":{"command":"npx"}}}"#,
            &["mcpServers".into(), "github".into()],
            &disabled_entry(&["mcpServers"], "github"),
        )
        .unwrap()
        .expect("entry exists");
        let value: serde_json::Value = serde_json::from_str(&json).unwrap();
        assert!(value["mcpServers"].get("github").is_none());
        assert_eq!(value["mcpServersDisabled"]["github"]["command"], "npx");

        let yaml = move_entry(
            ConfigFormat::Yaml,
            "mcp:\n  github:\n    command: npx\n",
            &["mcp".into(), "github".into()],
            &disabled_entry(&["mcp"], "github"),
        )
        .unwrap()
        .expect("entry exists");
        let value: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        assert!(yaml_get(&value, &["mcp".into(), "github".into()]).is_none());
        assert!(yaml_get(&value, &["mcpDisabled".into(), "github".into()]).is_some());
    }

    #[test]
    fn move_refuses_an_occupied_destination_in_every_format() {
        let cases: [(ConfigFormat, &str); 4] = [
            (ConfigFormat::Json, r#"{"a":{"x":1},"b":{"x":2}}"#),
            (ConfigFormat::Jsonc, r#"{"a":{"x":1},"b":{"x":2}}"#),
            (ConfigFormat::Toml, "[a]\nx = 1\n[b]\nx = 2\n"),
            (ConfigFormat::Yaml, "a:\n  x: 1\nb:\n  x: 2\n"),
        ];
        for (format, content) in cases {
            let error = move_entry(
                format,
                content,
                &["a".into(), "x".into()],
                &["b".into(), "x".into()],
            )
            .unwrap_err();
            // One code for "the destination is taken", whatever the format is: a caller (the
            // UI included) must not have to know which document grammar refused the move.
            assert_eq!(error.code(), "invalid_input", "{format:?}");
        }
    }

    #[test]
    fn move_missing_source_is_not_an_error_in_every_format() {
        let cases: [(ConfigFormat, &str); 4] = [
            (ConfigFormat::Json, r#"{"a":{"x":1}}"#),
            (ConfigFormat::Jsonc, r#"{"a":{"x":1}}"#),
            (ConfigFormat::Toml, "[a]\nx = 1\n"),
            (ConfigFormat::Yaml, "a:\n  x: 1\n"),
        ];
        for (format, content) in cases {
            let outcome = move_entry(
                format,
                content,
                &["a".into(), "nope".into()],
                &["aDisabled".into(), "nope".into()],
            )
            .unwrap();
            assert!(outcome.is_none(), "{format:?}");
            let outcome = move_entry(
                format,
                content,
                &["nope".into(), "nope".into()],
                &["a".into(), "nope".into()],
            )
            .unwrap();
            assert!(outcome.is_none(), "{format:?}");
        }
    }

    #[test]
    fn move_rejects_empty_paths_and_unstructured_formats() {
        assert!(move_entry(ConfigFormat::Json, "{}", &[], &["a".into()]).is_err());
        assert!(move_entry(ConfigFormat::Json, "{}", &["a".into()], &[]).is_err());
        assert!(move_entry(ConfigFormat::Markdown, "# hi", &["a".into()], &["b".into()]).is_err());
        assert!(move_entry(ConfigFormat::Text, "hi", &["a".into()], &["b".into()]).is_err());
    }
}
