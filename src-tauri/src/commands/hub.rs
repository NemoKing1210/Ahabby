//! Hub commands: where the library comes from, what it holds, and installing one entry.
//!
//! Installing is the only one that writes, and it writes through the very same adapter the rest
//! of the app uses for a manual "create skill" / "add server": the owner is resolved from the
//! scan (an agent id, the shared surface, or a project), the destination is the skills directory
//! or MCP config file the manifest declares, and the payload is checked before a byte lands.
//! Nothing here knows a filesystem layout of its own.

use tauri::State;

use crate::domain::{
    HubEntryDetail, HubInstall, HubInstallRequest, HubPage, HubQuery, HubResourceKind,
    HubSourceCatalog, McpDraftTransport, McpServerDraft, McpTransport,
};
use crate::error::{AppError, Result};
use crate::state::AppState;

use super::MutationResult;

/// The sources the hub reads, and the ones that failed to load.
#[tauri::command]
pub async fn list_hub_sources(state: State<'_, AppState>) -> Result<HubSourceCatalog> {
    Ok(state.hub_sources())
}

/// One page of one source.
#[tauri::command]
pub async fn search_hub(
    state: State<'_, AppState>,
    source_id: String,
    query: HubQuery,
) -> Result<HubPage> {
    let catalog = state.hub_sources();
    state.hub().search(&catalog, &source_id, &query).await
}

/// One entry: its files (a skill) or its launch recipe (an MCP server), as the dialog shows them.
#[tauri::command]
pub async fn get_hub_entry(
    state: State<'_, AppState>,
    entry_id: String,
    refresh: bool,
) -> Result<HubEntryDetail> {
    let catalog = state.hub_sources();
    state.hub().detail(&catalog, &entry_id, refresh).await
}

/// Install one entry for any owner the scan knows.
///
/// `confirm` is the user's answer to the review dialog: the frontend lists what will be written
/// and where, and the backend refuses an install that was not confirmed, so a UI that skips its
/// review cannot put a third-party payload on disk.
#[tauri::command]
pub async fn install_hub_resource(
    state: State<'_, AppState>,
    request: HubInstallRequest,
) -> Result<MutationResult<HubInstall>> {
    crate::commands::require_confirmation(request.confirm, "installing from the hub")?;

    let catalog = state.hub_sources();
    let service = state.hub();
    let detail = service.detail(&catalog, &request.entry_id, false).await?;
    let adapter = state.adapter(&request.owner_id)?;
    let context = state.platform_context();
    let owner = adapter.agent_ref();
    let name = request
        .name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .unwrap_or(&detail.entry.name)
        .to_string();

    let install = match detail.entry.kind {
        HubResourceKind::Skill => {
            let payload = service
                .skill_install(&catalog, &request.entry_id, name)
                .await?;
            let files_written = payload.files.len() as u32;
            let skill = adapter.install_skill(&context, &payload).await?;
            HubInstall {
                kind: HubResourceKind::Skill,
                entry_id: request.entry_id.clone(),
                owner,
                path: skill.path.clone(),
                files_written,
                skill: Some(skill),
                server: None,
            }
        }
        HubResourceKind::Mcp => {
            if !detail.entry.installable {
                return Err(AppError::NotSupported(
                    detail
                        .entry
                        .install_problem
                        .clone()
                        .unwrap_or_else(|| "this entry cannot be installed".to_string()),
                ));
            }
            // What the form reviewed, or — for a caller that sent only the entry id — the recipe
            // the source itself declares.
            let transport = request
                .transport
                .clone()
                .or_else(|| detail.transport.as_ref().and_then(draft_of))
                .ok_or_else(|| {
                    AppError::NotSupported(format!(
                        "Ahabby has no way to run '{}'",
                        detail.entry.name
                    ))
                })?;
            let server = adapter
                .create_mcp_server(&context, &McpServerDraft { name, transport })
                .await?;
            HubInstall {
                kind: HubResourceKind::Mcp,
                entry_id: request.entry_id.clone(),
                owner,
                path: server.source_config.clone(),
                files_written: 1,
                skill: None,
                server: Some(server),
            }
        }
    };

    let report = state.scan().await;
    Ok(MutationResult::new(install, report))
}

/// The launch recipe an entry declares, in the form the creation path takes.
///
/// The environment variables a registry record mentions are deliberately *not* copied in: they
/// are values the user has to supply, and the form is where that happens.
fn draft_of(transport: &McpTransport) -> Option<McpDraftTransport> {
    match transport {
        McpTransport::Stdio { command, args } => Some(McpDraftTransport::Stdio {
            command: command.clone(),
            args: args.clone(),
            env: Vec::new(),
        }),
        McpTransport::Http { url, .. } => Some(McpDraftTransport::Http {
            url: url.clone(),
            headers: Vec::new(),
        }),
        McpTransport::Unknown { .. } => None,
    }
}
