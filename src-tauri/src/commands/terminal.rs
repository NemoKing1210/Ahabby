//! Terminal commands.
//!
//! Two ways to run an agent, both keyed by an *agent id* — the frontend never sends a program,
//! a command line or an interpreter — and both taking an optional working directory:
//!
//! * Ahabby's own terminal (`launch_terminal`): a PTY session the frontend renders with xterm,
//!   streamed through `terminal://output` and `terminal://exit`;
//! * a terminal installed on this machine (`open_in_terminal`): detected in
//!   `platform::terminals`, launched with its own documented CLI contract.

use std::path::PathBuf;

use tauri::State;

use crate::domain::{
    Agent, Os, TerminalCapability, TerminalCatalog, TerminalKind, TerminalOption, TerminalSession,
};
use crate::error::{AppError, Result};
use crate::platform::terminals::BUILTIN_ID;
use crate::services::TerminalRequest;
use crate::state::AppState;

/// The terminals Ahabby can hand an agent to on this machine, plus the default working
/// directory. The built-in terminal is always first and always available.
#[tauri::command]
pub async fn list_terminals(state: State<'_, AppState>) -> Result<TerminalCatalog> {
    let mut options = vec![TerminalOption {
        id: BUILTIN_ID.to_string(),
        // The frontend labels the built-in entry from i18n; this is only a fallback.
        name: "Ahabby".to_string(),
        kind: TerminalKind::Builtin,
        capability: TerminalCapability::RunsCommand,
        path: None,
    }];

    for terminal in crate::platform::terminals::detect(Os::current()) {
        options.push(TerminalOption {
            id: terminal.id.to_string(),
            name: terminal.name.to_string(),
            kind: TerminalKind::External,
            capability: terminal.capability,
            path: Some(terminal.path.to_string_lossy().to_string()),
        });
    }

    Ok(TerminalCatalog {
        options,
        default_cwd: home(&state).to_string_lossy().to_string(),
    })
}

/// Start an agent in Ahabby's own terminal. Returns the session the tab is bound to; output
/// arrives through `terminal://output`.
#[tauri::command]
pub async fn launch_terminal(
    state: State<'_, AppState>,
    agent_id: String,
    cwd: Option<String>,
    cols: u16,
    rows: u16,
) -> Result<TerminalSession> {
    let agent = installed_agent(&state, &agent_id)?;
    let binary = binary_of(&agent)?;
    let cwd = resolve_cwd(&state, cwd)?;

    state.terminals().spawn(TerminalRequest {
        agent_id: agent.id.clone(),
        agent_name: agent.name.clone(),
        binary,
        args: Vec::new(),
        cwd,
        cols,
        rows,
    })
}

/// Send keystrokes (or a paste) to a session. `data` is UTF-8 text from xterm.
#[tauri::command]
pub async fn write_terminal(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<()> {
    state.terminals().write(&session_id, &data)
}

#[tauri::command]
pub async fn resize_terminal(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<()> {
    state.terminals().resize(&session_id, cols, rows)
}

/// Kill a session's process. The tab itself lives in the frontend.
#[tauri::command]
pub async fn close_terminal(state: State<'_, AppState>, session_id: String) -> Result<bool> {
    state.terminals().close(&session_id)
}

/// Sessions the backend still holds. Used to reconcile tabs after a reload.
#[tauri::command]
pub async fn list_terminal_sessions(state: State<'_, AppState>) -> Result<Vec<TerminalSession>> {
    Ok(state.terminals().list())
}

/// Start an agent in a terminal installed on this machine.
#[tauri::command]
pub async fn open_in_terminal(
    state: State<'_, AppState>,
    agent_id: String,
    terminal_id: String,
    cwd: Option<String>,
) -> Result<()> {
    let agent = installed_agent(&state, &agent_id)?;
    let binary = binary_of(&agent)?;
    let cwd = resolve_cwd(&state, cwd)?;

    crate::platform::terminals::launch(&terminal_id, Os::current(), &cwd, &binary, &[])
}

/// An agent of the current scan that is actually installed — the scan is what decides which
/// executables Ahabby may start.
fn installed_agent(state: &State<'_, AppState>, agent_id: &str) -> Result<Agent> {
    let agent = state.agent(agent_id)?;
    if !agent.is_installed() {
        return Err(AppError::NotSupported(format!(
            "{} is not installed",
            agent.name
        )));
    }
    Ok(agent)
}

fn binary_of(agent: &Agent) -> Result<String> {
    agent.binary_path.clone().ok_or_else(|| {
        AppError::NotSupported(format!(
            "Ahabby could not locate {}\u{2019}s executable",
            agent.name
        ))
    })
}

/// The directory a session starts in: the one the user asked for (it must exist), else home.
fn resolve_cwd(state: &State<'_, AppState>, cwd: Option<String>) -> Result<PathBuf> {
    let requested = cwd
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    match requested {
        Some(path) => {
            let path = PathBuf::from(path);
            if !path.is_dir() {
                return Err(AppError::InvalidInput(format!(
                    "working directory does not exist: {}",
                    path.display()
                )));
            }
            Ok(path)
        }
        None => Ok(home(state)),
    }
}

fn home(state: &State<'_, AppState>) -> PathBuf {
    state.platform_context().home
}
