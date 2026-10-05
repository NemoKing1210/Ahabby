//! Single error type for the whole backend.
//!
//! Errors are serialized into a stable, UI-friendly shape: `{ code, message, details }`.
//! The frontend never parses `message`; it switches on `code` (see `src/shared/api/errors.ts`)
//! and uses `message` only for display.

use std::path::Path;

use serde::{Serialize, Serializer};

pub type Result<T, E = AppError> = std::result::Result<T, E>;

#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("path does not exist: {0}")]
    NotFound(String),

    #[error("cannot read {path}: {source}")]
    Io {
        path: String,
        #[source]
        source: std::io::Error,
    },

    #[error("{path} is not valid {format}: {message}")]
    InvalidFormat {
        format: &'static str,
        path: String,
        message: String,
    },

    #[error("{path} changed on disk since it was read; reload it and retry")]
    Stale { path: String },

    #[error("refusing to run command: {0}")]
    CommandNotAllowed(String),

    #[error("{manager} is not installed or not on PATH")]
    ManagerUnavailable { manager: String },

    #[error("no supported install method for {agent} on this platform")]
    NoInstallMethod { agent: String },

    #[error("not supported: {0}")]
    NotSupported(String),

    #[error("network request failed: {0}")]
    Network(String),

    #[error("unknown job: {0}")]
    JobNotFound(String),

    #[error("invalid input: {0}")]
    InvalidInput(String),

    #[error("manifest {manifest} is invalid: {message}")]
    Manifest { manifest: String, message: String },

    #[error("operation timed out after {0}s")]
    Timeout(u64),

    #[error("{0}")]
    Other(String),
}

impl AppError {
    pub fn io(path: impl AsRef<Path>, source: std::io::Error) -> Self {
        AppError::Io {
            path: path.as_ref().display().to_string(),
            source,
        }
    }

    pub fn invalid_format(
        format: &'static str,
        path: impl AsRef<Path>,
        message: impl Into<String>,
    ) -> Self {
        AppError::InvalidFormat {
            format,
            path: path.as_ref().display().to_string(),
            message: message.into(),
        }
    }

    pub fn other(message: impl Into<String>) -> Self {
        AppError::Other(message.into())
    }

    /// Stable machine readable identifier consumed by the UI.
    pub fn code(&self) -> &'static str {
        match self {
            AppError::NotFound(_) => "not_found",
            AppError::Io { .. } => "io",
            AppError::InvalidFormat { .. } => "invalid_format",
            AppError::Stale { .. } => "stale_file",
            AppError::CommandNotAllowed(_) => "command_not_allowed",
            AppError::ManagerUnavailable { .. } => "manager_unavailable",
            AppError::NoInstallMethod { .. } => "no_install_method",
            AppError::NotSupported(_) => "not_supported",
            AppError::Network(_) => "network",
            AppError::JobNotFound(_) => "job_not_found",
            AppError::InvalidInput(_) => "invalid_input",
            AppError::Manifest { .. } => "invalid_manifest",
            AppError::Timeout(_) => "timeout",
            AppError::Other(_) => "other",
        }
    }
}

impl Serialize for AppError {
    fn serialize<S: Serializer>(&self, serializer: S) -> std::result::Result<S::Ok, S::Error> {
        use serde::ser::SerializeStruct;
        let mut state = serializer.serialize_struct("AppError", 2)?;
        state.serialize_field("code", self.code())?;
        state.serialize_field("message", &self.to_string())?;
        state.end()
    }
}

impl From<std::io::Error> for AppError {
    fn from(source: std::io::Error) -> Self {
        AppError::Other(format!("I/O error: {source}"))
    }
}

impl From<serde_json::Error> for AppError {
    fn from(error: serde_json::Error) -> Self {
        AppError::Other(format!("JSON error: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_with_code_and_message() {
        let error = AppError::Stale {
            path: "/tmp/x".into(),
        };
        let value = serde_json::to_value(&error).unwrap();
        assert_eq!(value["code"], "stale_file");
        assert!(value["message"].as_str().unwrap().contains("/tmp/x"));
    }

    #[test]
    fn io_helper_keeps_path() {
        let error = AppError::io(
            "/tmp/y",
            std::io::Error::new(std::io::ErrorKind::PermissionDenied, "denied"),
        );
        assert_eq!(error.code(), "io");
        assert!(error.to_string().contains("/tmp/y"));
    }
}
