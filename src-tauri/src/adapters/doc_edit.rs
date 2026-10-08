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
        ConfigFormat::Text => remove_dotenv_line(content, key_path),
        ConfigFormat::Markdown => Err(AppError::NotSupported(
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

/// A dotenv (`text`) config: drop the line whose key matches, and nothing else — the other
/// lines keep their text, their `export ` prefix and their line endings.
fn remove_dotenv_line(content: &str, key_path: &[String]) -> Result<Option<String>> {
    let key = key_path.join(".");
    let mut out = String::with_capacity(content.len());
    let mut removed = false;
    for raw in content.split_inclusive('\n') {
        let body = raw.strip_suffix('\n').unwrap_or(raw);
        let body = body.strip_suffix('\r').unwrap_or(body);
        let trimmed = body.trim_start();
        let rest = trimmed
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(trimmed);
        let matches = rest
            .find('=')
            .is_some_and(|equal| rest[..equal].trim() == key);
        if matches {
            removed = true;
            continue;
        }
        out.push_str(raw);
    }
    Ok(removed.then_some(out))
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

/// Insert a new member at `key_path` with `value`, creating the containers it needs.
///
/// Unlike [`move_entry`] the member does not exist yet, so there is nothing to preserve about
/// it: JSON/JSONC keeps every other byte (comments included) and lays the value out like the
/// object around it, TOML and YAML are re-serialized through their own editors.
///
/// * `Err(AppError::InvalidInput)` — a member already exists at `key_path`.
/// * `Err(AppError::NotSupported)` — Markdown/Text.
pub fn insert_entry(
    format: ConfigFormat,
    content: &str,
    key_path: &[String],
    value: &Value,
) -> Result<String> {
    if key_path.is_empty() {
        return Err(AppError::InvalidInput(
            "an empty key path cannot hold a member".to_string(),
        ));
    }
    match format {
        ConfigFormat::Json | ConfigFormat::Jsonc => insert_json(content, key_path, value),
        ConfigFormat::Toml => insert_toml(content, key_path, value),
        ConfigFormat::Yaml => insert_yaml(content, key_path, value),
        ConfigFormat::Markdown | ConfigFormat::Text => Err(AppError::NotSupported(
            "this format does not hold structured data".to_string(),
        )),
    }
}

fn insert_json(content: &str, key_path: &[String], value: &Value) -> Result<String> {
    if super::jsonc::has_member(content, key_path) {
        return Err(occupied(key_path));
    }
    match super::jsonc::insert_new_member(content, key_path, value) {
        Ok(Some(updated)) => Ok(updated),
        Ok(None) => Err(AppError::invalid_format(
            "json",
            "<memory>",
            "the document has no object that can hold the member",
        )),
        Err(message) => Err(AppError::invalid_format("json", "<memory>", message)),
    }
}

fn insert_toml(content: &str, key_path: &[String], value: &Value) -> Result<String> {
    let (container, name) = key_path.split_at(key_path.len() - 1);
    let name = &name[0];

    let mut document: toml_edit::DocumentMut =
        content.parse().map_err(|error: toml_edit::TomlError| {
            AppError::invalid_format("toml", "<memory>", error.to_string())
        })?;
    if toml_item(&document, key_path).is_some() {
        return Err(occupied(key_path));
    }

    // The entry is a whole object, so it is serialized as a document and inserted as a table:
    // TOML renders it as `[container.name]` with its own sub-tables (`[container.name.env]`).
    let entry = toml_edit::ser::to_document(value)
        .map_err(|error| AppError::invalid_format("toml", "<memory>", error.to_string()))?;
    let item = toml_edit::Item::Table(entry.as_table().clone());

    let destination = toml_table_mut(document.as_table_mut(), container)?;
    let _ = destination.insert(name, item);
    Ok(document.to_string())
}

fn insert_yaml(content: &str, key_path: &[String], value: &Value) -> Result<String> {
    let (container, name) = key_path.split_at(key_path.len() - 1);
    let name = name[0].clone();

    let mut document: serde_yaml::Value = if content.trim().is_empty() {
        serde_yaml::Value::Mapping(serde_yaml::Mapping::new())
    } else {
        serde_yaml::from_str(content)
            .map_err(|error| AppError::invalid_format("yaml", "<memory>", error.to_string()))?
    };
    if document.is_null() {
        document = serde_yaml::Value::Mapping(serde_yaml::Mapping::new());
    }
    if yaml_get(&document, key_path).is_some() {
        return Err(occupied(key_path));
    }

    let entry = serde_yaml::to_value(value)
        .map_err(|error| AppError::other(format!("cannot encode the entry as YAML: {error}")))?;
    let destination = yaml_mapping_mut(&mut document, container).ok_or_else(|| {
        AppError::invalid_format("yaml", "<memory>", "the destination is not a mapping")
    })?;
    let _ = destination.insert(serde_yaml::Value::String(name), entry);

    serde_yaml::to_string(&document)
        .map_err(|error| AppError::other(format!("cannot serialize YAML: {error}")))
}

/// Replace the value of an existing member, preserving every other byte of the document.
///
/// This is the write behind editing one row of the quick-settings panel: the frontend only ever
/// names a dotted key and a new value, and this function finds the member in the file on disk
/// and rewrites *its value alone*. That is what keeps a JSONC comment above the key, a TOML
/// trailing comment, the key order and a dotenv file's other lines exactly where they were.
///
/// The member's type survives the edit, because the input is always text: a string stays a
/// string (`"gpt-5"` does not become an unquoted token a parser rejects), an integer an integer,
/// a boolean a boolean. And the member must already be there — a fact that came from a scan
/// whose key the file no longer holds is an error, never an insert behind the user's back.
///
/// * `Err(AppError::NotFound)` — no member at `dotted_key`.
/// * `Err(AppError::InvalidInput)` — the new text does not fit the member's type.
/// * `Err(AppError::NotSupported)` — Markdown, or a value that is not a scalar.
pub fn set_value(
    format: ConfigFormat,
    content: &str,
    dotted_key: &str,
    value: &str,
) -> Result<String> {
    let key_path: Vec<String> = dotted_key.split('.').map(str::to_string).collect();
    if key_path.iter().any(String::is_empty) {
        return Err(AppError::InvalidInput(
            "a value needs a non-empty dotted key".to_string(),
        ));
    }
    match format {
        ConfigFormat::Json | ConfigFormat::Jsonc => set_json(format, content, &key_path, value),
        ConfigFormat::Toml => set_toml(content, &key_path, value),
        ConfigFormat::Yaml => set_yaml(content, &key_path, value),
        ConfigFormat::Text => set_dotenv_line(content, dotted_key, value),
        ConfigFormat::Markdown => Err(AppError::NotSupported(
            "this format does not hold structured data".to_string(),
        )),
    }
}

/// The error `set_value` reports for a key the document does not hold.
fn not_found(key_path: &[String]) -> AppError {
    AppError::NotFound(format!(
        "{} is not in the document",
        describe_path(key_path)
    ))
}

/// The error `set_value` reports when the new text cannot be read as the member's type.
fn type_mismatch(key_path: &[String], expected: &str) -> AppError {
    AppError::InvalidInput(format!("{} must be {expected}", describe_path(key_path)))
}

/// JSON / JSONC: the new token is rendered in the type the old node had, then spliced in by
/// byte range so the rest of the document (comments, order, trailing commas) is untouched.
fn set_json(
    format: ConfigFormat,
    content: &str,
    key_path: &[String],
    value: &str,
) -> Result<String> {
    let document = super::mcp_parse::document_to_value(format, content)?;
    let existing =
        super::mcp_parse::value_at(&document, key_path).ok_or_else(|| not_found(key_path))?;
    let token = json_token(existing, value, key_path)?;
    super::jsonc::replace_member_value(content, key_path, &token)
        .map_err(|message| AppError::invalid_format(format.name(), "<memory>", message))?
        .ok_or_else(|| not_found(key_path))
}

/// Render `value` as the JSON token that keeps `existing`'s type.
fn json_token(existing: &Value, value: &str, key_path: &[String]) -> Result<String> {
    match existing {
        Value::String(_) => serde_json::to_string(value)
            .map_err(|error| AppError::other(format!("cannot encode the value: {error}"))),
        Value::Number(_) => value
            .trim()
            .parse::<serde_json::Number>()
            .map(|number| number.to_string())
            .map_err(|_| type_mismatch(key_path, "a number")),
        Value::Bool(_) => match value.trim() {
            "true" => Ok("true".to_string()),
            "false" => Ok("false".to_string()),
            _ => Err(type_mismatch(key_path, "true or false")),
        },
        other => Err(AppError::NotSupported(format!(
            "{} is {}, not a value that can be typed here",
            describe_path(key_path),
            json_type_name(other)
        ))),
    }
}

fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "a boolean",
        Value::Number(_) => "a number",
        Value::String(_) => "a string",
        Value::Array(_) => "a list",
        Value::Object(_) => "an object",
    }
}

/// TOML: `toml_edit` mutates the item in place, so the document keeps its own formatting; the
/// value's own decor (the trailing comment on the line, the space before it) is carried over to
/// the replacement by hand, because a fresh `Value` would not have it.
fn set_toml(content: &str, key_path: &[String], value: &str) -> Result<String> {
    let mut document: toml_edit::DocumentMut =
        content.parse().map_err(|error: toml_edit::TomlError| {
            AppError::invalid_format("toml", "<memory>", error.to_string())
        })?;

    let (parents, last) = key_path.split_at(key_path.len() - 1);
    let mut cursor: &mut toml_edit::Item = document.as_item_mut();
    for segment in parents {
        let Some(next) = cursor
            .as_table_like_mut()
            .and_then(|table| table.get_mut(segment.as_str()))
        else {
            return Err(not_found(key_path));
        };
        cursor = next;
    }
    let table = cursor
        .as_table_like_mut()
        .ok_or_else(|| not_found(key_path))?;
    let Some(item) = table.get_mut(&last[0]) else {
        return Err(not_found(key_path));
    };
    let Some(current) = item.as_value() else {
        return Err(AppError::NotSupported(format!(
            "{} is not a scalar value",
            describe_path(key_path)
        )));
    };
    let decor = current.decor().clone();
    let mut replacement = toml_token(current, value, key_path)?;
    *replacement.decor_mut() = decor;
    *item = toml_edit::Item::Value(replacement);
    Ok(document.to_string())
}

/// Build the TOML value that keeps `current`'s type.
fn toml_token(
    current: &toml_edit::Value,
    value: &str,
    key_path: &[String],
) -> Result<toml_edit::Value> {
    match current {
        toml_edit::Value::String(_) => Ok(toml_edit::Value::from(value.to_string())),
        toml_edit::Value::Integer(_) => value
            .trim()
            .parse::<i64>()
            .map(toml_edit::Value::from)
            .map_err(|_| type_mismatch(key_path, "a whole number")),
        toml_edit::Value::Float(_) => value
            .trim()
            .parse::<f64>()
            .map(toml_edit::Value::from)
            .map_err(|_| type_mismatch(key_path, "a number")),
        toml_edit::Value::Boolean(_) => match value.trim() {
            "true" => Ok(toml_edit::Value::from(true)),
            "false" => Ok(toml_edit::Value::from(false)),
            _ => Err(type_mismatch(key_path, "true or false")),
        },
        other => Err(AppError::NotSupported(format!(
            "{} is {}, not a scalar value",
            describe_path(key_path),
            other.type_name()
        ))),
    }
}

/// YAML: the scalar's own line is edited, so the rest of the file — comments, quoting, and the
/// indentation of every other block — is byte-for-byte what it was. A nested key is found by
/// walking the block structure the indentation describes.
fn set_yaml(content: &str, key_path: &[String], value: &str) -> Result<String> {
    let lines = yaml_lines(content);
    let mut scope: Option<usize> = None;
    let mut from = 0usize;
    let mut target = None;
    for segment in key_path {
        let mut hit = None;
        let mut index = from;
        while index < lines.len() {
            let line = &lines[index];
            let trimmed = line.text.trim_start();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                index += 1;
                continue;
            }
            // A line at or above the enclosing mapping's indentation is not its child.
            if scope.is_some_and(|limit| line.indent <= limit) {
                break;
            }
            if yaml_key(trimmed).map(|(key, _)| key) == Some(segment.as_str()) {
                hit = Some(index);
                break;
            }
            // Not the key we are after: skip that sibling's whole block, so a deeper mapping
            // that happens to share the name cannot be mistaken for it.
            index = skip_block(&lines, index);
        }
        let Some(index) = hit else {
            return Err(not_found(key_path));
        };
        scope = Some(lines[index].indent);
        from = index + 1;
        target = Some(index);
    }

    let line = &lines[target.expect("a non-empty key path always finds a line")];
    let trimmed = line.text.trim_start();
    let (_, colon) = yaml_key(trimmed).ok_or_else(|| not_found(key_path))?;
    let after_colon = &trimmed[colon + 1..];
    let leading = after_colon.len() - after_colon.trim_start().len();
    let value_rel = colon + 1 + leading;
    let remainder = &trimmed[value_rel..];
    if remainder.is_empty() {
        return Err(AppError::NotSupported(format!(
            "{} does not hold a scalar on one line",
            describe_path(key_path)
        )));
    }

    let (token_len, style) = yaml_scalar(remainder, key_path)?;
    let rendered = match style {
        YamlScalarStyle::Double => serde_json::to_string(value)
            .map_err(|error| AppError::other(format!("cannot encode the value: {error}")))?,
        YamlScalarStyle::Single => format!("'{}'", value.replace('\'', "''")),
        YamlScalarStyle::Plain if yaml_plain_fits(value) => value.to_string(),
        YamlScalarStyle::Plain => serde_json::to_string(value)
            .map_err(|error| AppError::other(format!("cannot encode the value: {error}")))?,
    };

    let start = line.start + (line.text.len() - trimmed.len()) + value_rel;
    let mut out = String::with_capacity(content.len() + rendered.len());
    out.push_str(&content[..start]);
    out.push_str(&rendered);
    out.push_str(&content[start + token_len..]);
    validate(ConfigFormat::Yaml, &out, "<memory>")?;
    Ok(out)
}

/// One line of a YAML document: where it starts, its indentation, and its text without the
/// line terminator.
struct YamlLine<'a> {
    start: usize,
    indent: usize,
    text: &'a str,
}

fn yaml_lines(content: &str) -> Vec<YamlLine<'_>> {
    let mut lines = Vec::new();
    let mut offset = 0usize;
    for raw in content.split_inclusive('\n') {
        let body = raw.strip_suffix('\n').unwrap_or(raw);
        let body = body.strip_suffix('\r').unwrap_or(body);
        let indent = body.len() - body.trim_start_matches([' ', '\t']).len();
        lines.push(YamlLine {
            start: offset,
            indent,
            text: body,
        });
        offset += raw.len();
    }
    lines
}

/// The first line after the block rooted at `index`: every following line indented deeper than
/// that line belongs to it.
fn skip_block(lines: &[YamlLine<'_>], index: usize) -> usize {
    let indent = lines[index].indent;
    let mut next = index + 1;
    while next < lines.len() {
        let line = &lines[next];
        let trimmed = line.text.trim_start();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            next += 1;
            continue;
        }
        if line.indent <= indent {
            break;
        }
        next += 1;
    }
    next
}

/// The key of a mapping line and the byte offset of its `:`, or `None` when the line is not a
/// `key: value` line. A quoted key may contain a colon; a plain one never does.
fn yaml_key(text: &str) -> Option<(&str, usize)> {
    let bytes = text.as_bytes();
    let (key, after) = match bytes.first()? {
        b'"' | b'\'' => {
            let quote = bytes[0];
            let mut index = 1;
            loop {
                match bytes.get(index)? {
                    byte if *byte == quote => {
                        if quote == b'\'' && bytes.get(index + 1) == Some(&b'\'') {
                            index += 2;
                            continue;
                        }
                        break;
                    }
                    b'\\' if quote == b'"' => index += 2,
                    _ => index += 1,
                }
            }
            (text.get(1..index)?, index + 1)
        }
        _ => {
            let colon = text.find(':')?;
            (text[..colon].trim_end(), colon)
        }
    };
    let colon = after + text.get(after..)?.find(':')?;
    (!key.is_empty()).then_some((key, colon))
}

/// How the old scalar was written, so the replacement can keep its quoting.
#[derive(Clone, Copy)]
enum YamlScalarStyle {
    Double,
    Single,
    Plain,
}

/// The length of the scalar at the start of `text` and the style it was written in.
fn yaml_scalar(text: &str, key_path: &[String]) -> Result<(usize, YamlScalarStyle)> {
    let bytes = text.as_bytes();
    match bytes.first().copied() {
        Some(b'"') => {
            let mut index = 1;
            while index < bytes.len() {
                match bytes[index] {
                    b'\\' => index += 2,
                    b'"' => return Ok((index + 1, YamlScalarStyle::Double)),
                    _ => index += 1,
                }
            }
            Err(AppError::invalid_format(
                "yaml",
                "<memory>",
                "an unterminated string",
            ))
        }
        Some(b'\'') => {
            let mut index = 1;
            while index < bytes.len() {
                if bytes[index] == b'\'' {
                    if bytes.get(index + 1) == Some(&b'\'') {
                        index += 2;
                        continue;
                    }
                    return Ok((index + 1, YamlScalarStyle::Single));
                }
                index += 1;
            }
            Err(AppError::invalid_format(
                "yaml",
                "<memory>",
                "an unterminated string",
            ))
        }
        Some(b'{' | b'[') => Err(AppError::NotSupported(format!(
            "{} holds a collection, not a value that can be typed here",
            describe_path(key_path)
        ))),
        _ => {
            let end = text.find(" #").unwrap_or(text.len());
            Ok((text[..end].trim_end().len(), YamlScalarStyle::Plain))
        }
    }
}

/// `true` when the YAML emitter would write this text as a plain scalar; otherwise it has to
/// be quoted, and the replacement says so.
fn yaml_plain_fits(value: &str) -> bool {
    if value.is_empty() || value.trim() != value || value.contains('\n') {
        return false;
    }
    if value.contains(": ") || value.contains(" #") {
        return false;
    }
    !value.starts_with(|ch: char| {
        matches!(
            ch,
            '-' | '?'
                | ':'
                | ','
                | '['
                | ']'
                | '{'
                | '}'
                | '#'
                | '&'
                | '*'
                | '!'
                | '|'
                | '>'
                | '\''
                | '"'
                | '%'
                | '@'
                | '`'
        )
    })
}

/// A dotenv (`text`) config: the line whose key matches is rewritten, and nothing else — the
/// other lines, the `export ` prefix and the line endings are all left as they were.
fn set_dotenv_line(content: &str, key: &str, value: &str) -> Result<String> {
    let mut out = String::with_capacity(content.len() + value.len());
    let mut replaced = false;
    for raw in content.split_inclusive('\n') {
        let (body, ending) = match raw.strip_suffix('\n') {
            Some(body) => match body.strip_suffix('\r') {
                Some(body) => (body, "\r\n"),
                None => (body, "\n"),
            },
            None => (raw, ""),
        };
        if replaced {
            out.push_str(raw);
            continue;
        }
        let trimmed = body.trim_start();
        let rest = trimmed
            .strip_prefix("export ")
            .map(str::trim_start)
            .unwrap_or(trimmed);
        let Some(equal) = rest.find('=') else {
            out.push_str(raw);
            continue;
        };
        if rest[..equal].trim() != key {
            out.push_str(raw);
            continue;
        }
        out.push_str(&body[..body.len() - rest.len() + equal + 1]);
        out.push_str(value);
        out.push_str(ending);
        replaced = true;
    }
    if !replaced {
        return Err(AppError::NotFound(format!("{key} is not in the document")));
    }
    Ok(out)
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

    #[test]
    fn insert_writes_into_every_structured_format() {
        let entry = serde_json::json!({
            "command": "npx",
            "args": ["-y", "server"],
            "env": { "TOKEN": "x" },
        });

        let json = insert_entry(
            ConfigFormat::Json,
            "{\n  \"mcpServers\": {\n    \"github\": { \"command\": \"npx\" }\n  }\n}\n",
            &["mcpServers".into(), "other".into()],
            &entry,
        )
        .unwrap();
        validate(ConfigFormat::Json, &json, "x").unwrap();
        assert!(json.contains("github"), "existing entries survive");

        let toml = insert_entry(
            ConfigFormat::Toml,
            "# keep me\nmodel = \"gpt-5\"\n\n[mcp_servers.github]\ncommand = \"npx\"\n",
            &["mcp_servers".into(), "other".into()],
            &entry,
        )
        .unwrap();
        validate(ConfigFormat::Toml, &toml, "x").unwrap();
        assert!(toml.contains("# keep me"));
        assert!(toml.contains("[mcp_servers.github]"));

        let yaml = insert_entry(
            ConfigFormat::Yaml,
            "mcpServers:\n  github:\n    command: npx\n",
            &["mcpServers".into(), "other".into()],
            &entry,
        )
        .unwrap();
        validate(ConfigFormat::Yaml, &yaml, "x").unwrap();
        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed["mcpServers"]["github"]["command"], "npx");
        assert_eq!(parsed["mcpServers"]["other"]["args"][1], "server");
    }

    #[test]
    fn insert_creates_the_containers_of_an_empty_document() {
        let entry = serde_json::json!({ "command": "npx" });

        let toml = insert_entry(
            ConfigFormat::Toml,
            "",
            &["mcp_servers".into(), "github".into()],
            &entry,
        )
        .unwrap();
        let parsed: toml_edit::DocumentMut = toml.parse().unwrap();
        assert_eq!(
            parsed["mcp_servers"]["github"]["command"].as_str(),
            Some("npx")
        );

        let yaml = insert_entry(
            ConfigFormat::Yaml,
            "{}",
            &["mcpServers".into(), "github".into()],
            &entry,
        )
        .unwrap();
        let parsed: serde_yaml::Value = serde_yaml::from_str(&yaml).unwrap();
        assert_eq!(parsed["mcpServers"]["github"]["command"], "npx");
    }

    #[test]
    fn insert_refuses_a_taken_name_and_an_unstructured_format() {
        let error = insert_entry(
            ConfigFormat::Json,
            "{\n  \"mcpServers\": {\n    \"github\": {}\n  }\n}\n",
            &["mcpServers".into(), "github".into()],
            &serde_json::json!({ "command": "npx" }),
        )
        .unwrap_err();
        assert_eq!(error.code(), "invalid_input");

        let error = insert_entry(
            ConfigFormat::Toml,
            "[mcp_servers.github]\ncommand = \"npx\"\n",
            &["mcp_servers".into(), "github".into()],
            &serde_json::json!({ "command": "npx" }),
        )
        .unwrap_err();
        assert_eq!(error.code(), "invalid_input");

        assert!(insert_entry(ConfigFormat::Json, "{}", &[], &serde_json::json!({})).is_err());
        assert_eq!(
            insert_entry(
                ConfigFormat::Markdown,
                "# hi",
                &["a".into()],
                &serde_json::json!({}),
            )
            .unwrap_err()
            .code(),
            "not_supported",
        );
    }

    #[test]
    fn set_value_changes_one_scalar_in_jsonc_and_keeps_everything_else() {
        let content = r#"{
  // keep this note
  "model": "gpt-5", // the model
  "count": 1,
  "verbose": false,
  "nested": { "name": "x", },
  "mcpServers": { "github": { "command": "npx" } }
}
"#;
        let updated = set_value(ConfigFormat::Jsonc, content, "model", "gpt-5.1").unwrap();
        assert_eq!(
            updated,
            r#"{
  // keep this note
  "model": "gpt-5.1", // the model
  "count": 1,
  "verbose": false,
  "nested": { "name": "x", },
  "mcpServers": { "github": { "command": "npx" } }
}
"#
        );
        validate(ConfigFormat::Jsonc, &updated, "x").unwrap();
        assert!(
            updated.contains("// keep this note"),
            "the comment survives"
        );
        assert!(
            updated.contains("\"name\": \"x\", }"),
            "the trailing comma survives"
        );

        let nested = set_value(ConfigFormat::Jsonc, content, "nested.name", "y").unwrap();
        assert!(nested.contains(r#""nested": { "name": "y", }"#));
        let deep = set_value(
            ConfigFormat::Jsonc,
            content,
            "mcpServers.github.command",
            "uvx",
        )
        .unwrap();
        assert!(deep.contains(r#""command": "uvx""#));
    }

    #[test]
    fn set_value_keeps_the_type_of_a_json_node() {
        let content = r#"{
  "model": "gpt-5",
  "count": 1,
  "verbose": false
}
"#;
        // The input is always text, so a string must stay a string even when it looks numeric.
        let stringy = set_value(ConfigFormat::Jsonc, content, "model", "7").unwrap();
        assert!(stringy.contains(r#""model": "7","#));

        let number = set_value(ConfigFormat::Jsonc, content, "count", "12").unwrap();
        assert!(number.contains(r#""count": 12,"#));

        let boolean = set_value(ConfigFormat::Jsonc, content, "verbose", "true").unwrap();
        assert!(boolean.contains(r#""verbose": true"#));

        // A value that does not fit the node's type is refused, and nothing is written.
        assert_eq!(
            set_value(ConfigFormat::Jsonc, content, "count", "many")
                .unwrap_err()
                .code(),
            "invalid_input"
        );
        assert_eq!(
            set_value(ConfigFormat::Jsonc, content, "verbose", "yes")
                .unwrap_err()
                .code(),
            "invalid_input"
        );
    }

    #[test]
    fn set_value_refuses_a_key_that_is_not_there() {
        let cases: [(ConfigFormat, &str); 4] = [
            (ConfigFormat::Json, r#"{"a":{"x":1}}"#),
            (ConfigFormat::Jsonc, r#"{"a":{"x":1}}"#),
            (ConfigFormat::Toml, "[a]\nx = 1\n"),
            (ConfigFormat::Yaml, "a:\n  x: 1\n"),
        ];
        for (format, content) in cases {
            let error = set_value(format, content, "a.nope", "2").unwrap_err();
            assert_eq!(error.code(), "not_found", "{format:?}");
        }
        let error = set_value(ConfigFormat::Text, "A=1\n", "B", "2").unwrap_err();
        assert_eq!(error.code(), "not_found");

        assert!(set_value(ConfigFormat::Json, "{}", "", "1").is_err());
        assert!(set_value(ConfigFormat::Json, "{}", "a..b", "1").is_err());
        assert_eq!(
            set_value(ConfigFormat::Markdown, "# hi", "a", "1")
                .unwrap_err()
                .code(),
            "not_supported"
        );
    }

    #[test]
    fn set_value_changes_one_scalar_in_toml_and_keeps_its_comments() {
        let content = r#"# Ahabby test config
model = "gpt-5"   # the important one
temperature = 0.7
retries = 3
enabled = true

[mcp_servers.github]
command = "npx"
"#;
        let updated = set_value(ConfigFormat::Toml, content, "model", "gpt-5.1").unwrap();
        assert_eq!(
            updated,
            r#"# Ahabby test config
model = "gpt-5.1"   # the important one
temperature = 0.7
retries = 3
enabled = true

[mcp_servers.github]
command = "npx"
"#
        );

        // Types survive: a float stays a float, an integer an integer, a boolean a boolean.
        assert!(set_value(ConfigFormat::Toml, content, "temperature", "0.8")
            .unwrap()
            .contains("temperature = 0.8"));
        assert!(set_value(ConfigFormat::Toml, content, "retries", "5")
            .unwrap()
            .contains("retries = 5"));
        assert!(set_value(ConfigFormat::Toml, content, "enabled", "false")
            .unwrap()
            .contains("enabled = false"));

        let nested = set_value(
            ConfigFormat::Toml,
            content,
            "mcp_servers.github.command",
            "uvx",
        )
        .unwrap();
        assert!(nested.contains("command = \"uvx\""));
        assert!(nested.contains("model = \"gpt-5\"   # the important one"));
    }

    #[test]
    fn set_value_changes_one_scalar_in_yaml_and_keeps_the_rest() {
        let content = "# keep me\nmodel: gpt-4\nprovider:\n  name: \"openai\"  # quoted\n  baseUrl: https://api.openai.com\n";
        let updated = set_value(ConfigFormat::Yaml, content, "provider.name", "anthropic").unwrap();
        assert_eq!(
            updated,
            "# keep me\nmodel: gpt-4\nprovider:\n  name: \"anthropic\"  # quoted\n  baseUrl: https://api.openai.com\n"
        );
        validate(ConfigFormat::Yaml, &updated, "x").unwrap();

        let plain = set_value(ConfigFormat::Yaml, content, "model", "gpt-4.1").unwrap();
        assert!(plain.contains("\nmodel: gpt-4.1\n"));

        // Text that a plain scalar cannot hold is quoted rather than written broken.
        let quoted = set_value(ConfigFormat::Yaml, content, "model", "a: b").unwrap();
        assert!(quoted.contains("model: \"a: b\""));
        validate(ConfigFormat::Yaml, &quoted, "x").unwrap();

        assert_eq!(
            set_value(ConfigFormat::Yaml, content, "provider.missing", "x")
                .unwrap_err()
                .code(),
            "not_found"
        );
    }

    #[test]
    fn set_value_finds_a_yaml_key_within_its_own_block() {
        // A deeper mapping that shares the name must not be mistaken for the key itself.
        let content = "other:\n  model: sibling\nmodel: mine\n";
        let updated = set_value(ConfigFormat::Yaml, content, "model", "changed").unwrap();
        assert_eq!(updated, "other:\n  model: sibling\nmodel: changed\n");

        let nested = "a:\n  b:\n    name: wrong\n  name: right\n";
        let updated = set_value(ConfigFormat::Yaml, nested, "a.name", "right2").unwrap();
        assert_eq!(updated, "a:\n  b:\n    name: wrong\n  name: right2\n");
    }

    #[test]
    fn set_value_replaces_one_dotenv_line() {
        let content =
            "# proxy\nHTTP_PROXY=http://old:1\nexport HTTPS_PROXY=http://old:2\nMODEL=gpt-4\n";
        let updated =
            set_value(ConfigFormat::Text, content, "HTTPS_PROXY", "http://new:2").unwrap();
        assert_eq!(
            updated,
            "# proxy\nHTTP_PROXY=http://old:1\nexport HTTPS_PROXY=http://new:2\nMODEL=gpt-4\n"
        );
    }

    #[test]
    fn removes_one_dotenv_line() {
        let content =
            "# proxy\nHTTP_PROXY=http://p:1\nexport HTTPS_PROXY=http://p:2\nMODEL=gpt-4\n";
        let updated = remove_entry(ConfigFormat::Text, content, &["HTTPS_PROXY".into()])
            .unwrap()
            .expect("the line is there");
        assert_eq!(updated, "# proxy\nHTTP_PROXY=http://p:1\nMODEL=gpt-4\n");

        // A key that is not in the file is `None`, not an error.
        assert!(remove_entry(ConfigFormat::Text, content, &["NOPE".into()])
            .unwrap()
            .is_none());
        assert!(
            remove_entry(ConfigFormat::Text, "# nothing\n", &["NOPE".into()])
                .unwrap()
                .is_none()
        );
    }
}
