use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::manifest::Severity;

/// Something that went wrong while loading the catalog (builtin or user manifests).
///
/// Problems never fail the whole scan: a broken manifest is skipped and reported,
/// so one bad file cannot take the application down.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct CatalogProblem {
    pub severity: Severity,
    /// `None` when the file could not even be parsed enough to know its id.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manifest_id: Option<String>,
    /// Dotted field path, when the problem is attributable to one manifest field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub field: Option<String>,
    pub source: String,
    pub message: String,
}

impl CatalogProblem {
    pub fn error(source: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Error,
            manifest_id: None,
            field: None,
            source: source.into(),
            message: message.into(),
        }
    }

    pub fn warning(source: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            severity: Severity::Warning,
            manifest_id: None,
            field: None,
            source: source.into(),
            message: message.into(),
        }
    }

    pub fn with_id(mut self, id: impl Into<String>) -> Self {
        self.manifest_id = Some(id.into());
        self
    }

    pub fn with_field(mut self, field: impl Into<String>) -> Self {
        self.field = Some(field.into());
        self
    }
}
