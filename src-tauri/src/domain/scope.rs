use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Where a config / skill / MCP server lives.
///
/// v1 only surfaces `Global`, but the whole data model carries `Scope` so project
/// level entities can be enabled later without a migration.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum Scope {
    #[default]
    Global,
    Project {
        root: String,
    },
}

impl Scope {
    pub fn is_global(&self) -> bool {
        matches!(self, Scope::Global)
    }

    /// Stable key used for grouping and for the frontend cache.
    pub fn key(&self) -> String {
        match self {
            Scope::Global => "global".to_string(),
            Scope::Project { root } => format!("project:{root}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_as_tagged_union() {
        let value = serde_json::to_value(Scope::Project {
            root: "/repo".into(),
        })
        .unwrap();
        assert_eq!(value["kind"], "project");
        assert_eq!(value["root"], "/repo");
        assert_eq!(
            serde_json::to_value(Scope::Global).unwrap()["kind"],
            "global"
        );
    }

    #[test]
    fn keys_are_stable() {
        assert_eq!(Scope::Global.key(), "global");
        assert_eq!(Scope::Project { root: "/r".into() }.key(), "project:/r");
    }
}
