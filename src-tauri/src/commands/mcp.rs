//! MCP server commands: listing, deleting an entry, revealing a single secret.

use tauri::State;

use crate::domain::{secrets, McpServer};
use crate::error::{AppError, Result};
use crate::state::AppState;

use super::{McpRemoval, MutationResult};

#[tauri::command]
pub async fn list_agent_mcp_servers(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<Vec<McpServer>> {
    Ok(state.agent(&agent_id)?.mcp_servers)
}

/// Remove an MCP server from the config file that declares it.
#[tauri::command]
pub async fn delete_mcp_server(
    state: State<'_, AppState>,
    agent_id: String,
    server_id: String,
    confirm: bool,
) -> Result<MutationResult<McpRemoval>> {
    crate::commands::require_confirmation(confirm, "removing an MCP server")?;
    let server = state.mcp_server(&agent_id, &server_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter.remove_mcp_server(&context, &server).await?;

    let report = state.scan().await;
    Ok(MutationResult::new(
        McpRemoval {
            removed_server_id: server_id,
            name: server.name,
            config: server.source_config,
        },
        report,
    ))
}

/// Reveal one secret value (env var or header) the user explicitly asked to see.
///
/// This is the *only* way a secret crosses the IPC boundary, and it is limited to a single
/// key of a single server.
#[tauri::command]
pub async fn reveal_mcp_secret(
    state: State<'_, AppState>,
    agent_id: String,
    server_id: String,
    key: String,
) -> Result<String> {
    let server = state.mcp_server(&agent_id, &server_id)?;
    if !secrets::is_secret_key(&key) {
        return Err(AppError::InvalidInput(format!(
            "'{key}' is not a secret field"
        )));
    }

    let path = state
        .document_target(&agent_id, &server.source_config)?
        .path;
    let adapter = state.adapter(&agent_id)?;
    let format = adapter
        .manifest()
        .mcp
        .as_ref()
        .map(|spec| spec.format)
        .unwrap_or_else(|| crate::domain::ConfigFormat::from_extension(&server.source_config));

    let content = crate::platform::read_text(&path)?;
    let document = crate::adapters::mcp_parse::document_to_value(format, &content)?;
    let entry = crate::adapters::mcp_parse::value_at(&document, &server.key_path)
        .ok_or_else(|| AppError::NotFound(format!("{} in {}", key, server.source_config)))?;

    let collection = entry
        .get("env")
        .or_else(|| entry.get("environment"))
        .or_else(|| entry.get("headers"))
        .and_then(|value| value.get(&key))
        .map(|value| match value {
            serde_json::Value::String(text) => text.clone(),
            other => other.to_string(),
        });

    collection.ok_or_else(|| AppError::NotFound(format!("{key} in {}", server.name)))
}
