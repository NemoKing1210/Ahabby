//! Editors Ahabby can hand a file to.
//!
//! Ahabby never edits through them and never waits for them: the file is opened by the editor
//! the user picked, on the path the scan already resolved, and the process is left behind.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// An editor installed on this machine that can open a file.
///
/// `id` is both the stable key the frontend sends back and the brand key it paints the picker's
/// icon from, so a row is recognisable before its label is read.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct ExternalEditor {
    pub id: String,
    pub name: String,
    /// The command-line shim or `.app` bundle that was found on this machine.
    pub path: String,
}
