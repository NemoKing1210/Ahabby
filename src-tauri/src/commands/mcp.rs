//! MCP server commands: listing, deleting an entry, revealing a single secret.

use tauri::State;

use crate::domain::{secrets, McpServer, McpServerDraft};
use crate::error::{AppError, Result};
use crate::state::AppState;

use super::{McpRemoval, McpToggle, MutationResult};

#[tauri::command]
pub async fn list_agent_mcp_servers(
    state: State<'_, AppState>,
    agent_id: String,
) -> Result<Vec<McpServer>> {
    Ok(state.agent(&agent_id)?.mcp_servers)
}

/// Add a server to the MCP config file the manifest declares.
///
/// Like [`create_skill`](crate::commands::skills::create_skill), `agent_id` is any owner the
/// scan knows — a real agent or the reserved shared surface. The entry is written at the
/// `name -> server` position the reader uses, in the manifest's own format, so the new server
/// is a full entry from the next scan on.
#[tauri::command]
pub async fn create_mcp_server(
    state: State<'_, AppState>,
    agent_id: String,
    draft: McpServerDraft,
) -> Result<MutationResult<McpServer>> {
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    let server = adapter.create_mcp_server(&context, &draft).await?;

    let report = state.scan().await;
    Ok(MutationResult::new(server, report))
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

/// Switch an MCP server on or off.
///
/// The entry is moved between the object the agent reads (`mcpServers`) and its disabled
/// sibling (`mcpServersDisabled`), where no agent looks for servers. A timestamped backup is
/// taken and the switch is reversible, so no confirmation is required.
#[tauri::command]
pub async fn set_mcp_server_enabled(
    state: State<'_, AppState>,
    agent_id: String,
    server_id: String,
    enabled: bool,
) -> Result<MutationResult<McpToggle>> {
    let server = state.mcp_server(&agent_id, &server_id)?;
    let adapter = state.adapter(&agent_id)?;
    let context = state.platform_context();
    adapter
        .set_mcp_server_enabled(&context, &server, enabled)
        .await?;

    let report = state.scan().await;
    Ok(MutationResult::new(
        McpToggle {
            server_id,
            name: server.name,
            enabled,
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

    let target = state.document_target(&agent_id, &server.source_config)?;
    let adapter = state.adapter(&agent_id)?;
    // A server does not record which declared source it came from, so the format is resolved
    // from what the scan knew: with a single source the manifest is authoritative, and with
    // several the document's own declared format picks the right one (JSONC stays JSONC).
    let specs = &adapter.manifest().mcp;
    let format = match specs.first() {
        Some(only) if specs.len() == 1 => only.format,
        _ => specs
            .iter()
            .map(|spec| spec.format)
            .find(|format| *format == target.format)
            .unwrap_or(target.format),
    };
    let path = target.path;

    let content = crate::platform::read_text(&path)?;
    let document = crate::adapters::mcp_parse::document_to_value(format, &content)?;
    // A switched-off server lives in the disabled sibling container, so the entry is looked up
    // where it actually is.
    let location = crate::adapters::mcp_entry_location(&server.key_path, server.enabled)?;
    let entry = crate::adapters::mcp_parse::value_at(&document, &location)
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
