//! Terminal models: everything the Settings picker and the Terminal screen exchange.
//!
//! A session is *always* started from an agent id — the frontend never sends a program or a
//! command line — and it is always a real shell inside a PTY (see `services::terminal`), so
//! full-screen agents like Claude Code work exactly as they do in an ordinary terminal.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a session runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum TerminalKind {
    /// Ahabby's own terminal: PTY sessions in tabs, inside the app.
    Builtin,
    /// A terminal emulator installed on this machine.
    External,
}

/// What a terminal can be asked to do with an agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum TerminalCapability {
    /// The agent is started inside it.
    RunsCommand,
    /// It can only be opened in the working directory; the user starts the agent there.
    /// Warp has no command-line escape hatch for this (`warpdotdev/warp#3959`), only a URI
    /// that opens a window or tab at a path.
    OpensDirectory,
}

/// One entry of the terminal picker in Settings.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct TerminalOption {
    pub id: String,
    pub name: String,
    pub kind: TerminalKind,
    pub capability: TerminalCapability,
    /// Where the terminal was found; `None` for the built-in one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
}

/// The picker's options plus the directory a new session starts in.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct TerminalCatalog {
    pub options: Vec<TerminalOption>,
    /// Home directory, offered as the default working directory.
    pub default_cwd: String,
}

/// A live (or already finished) terminal session.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct TerminalSession {
    pub id: String,
    pub agent_id: String,
    pub agent_name: String,
    /// Directory the shell was started in.
    pub cwd: String,
    /// The shell the session runs.
    pub shell: String,
    /// The command line that was typed into the shell (the agent binary).
    pub command: String,
    pub cols: u16,
    pub rows: u16,
    pub running: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
    #[ts(type = "number")]
    pub started_at_ms: i64,
}

/// One chunk of PTY output.
///
/// `data` is base64: a read can split a UTF-8 sequence in the middle, so the raw bytes travel
/// losslessly and are decoded into the terminal's own UTF-8 decoder in the frontend.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: String,
}

/// The process inside a session ended (the tab stays open until the user closes it).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct TerminalExit {
    pub session_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub exit_code: Option<i32>,
}
