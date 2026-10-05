use std::fmt;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Host operating system, as far as the catalog cares.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum Os {
    Windows,
    Macos,
    Linux,
}

impl Os {
    /// Compile-time host OS. Manifests are matched against this at runtime.
    pub const fn current() -> Self {
        if cfg!(target_os = "windows") {
            Os::Windows
        } else if cfg!(target_os = "macos") {
            Os::Macos
        } else {
            Os::Linux
        }
    }

    pub const fn as_str(self) -> &'static str {
        match self {
            Os::Windows => "windows",
            Os::Macos => "macos",
            Os::Linux => "linux",
        }
    }

    pub fn parse(value: &str) -> Option<Self> {
        match value.trim().to_ascii_lowercase().as_str() {
            "windows" | "win" | "win32" => Some(Os::Windows),
            "macos" | "mac" | "darwin" | "osx" => Some(Os::Macos),
            "linux" => Some(Os::Linux),
            _ => None,
        }
    }
}

impl fmt::Display for Os {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_aliases() {
        assert_eq!(Os::parse("Darwin"), Some(Os::Macos));
        assert_eq!(Os::parse(" win32 "), Some(Os::Windows));
        assert_eq!(Os::parse("plan9"), None);
    }
}
