//! Catalog loading.
//!
//! Two sources, merged by manifest id:
//! 1. **builtin** manifests embedded in the binary at compile time (see `build.rs`);
//! 2. **user** manifests from `<app config>/catalog/*.toml`, which win over builtin ones.
//!
//! A manifest that fails to parse or validate is skipped and reported as a
//! [`CatalogProblem`] — a single bad file never breaks the application.

use std::path::Path;

use crate::domain::manifest::Severity;
use crate::domain::{AgentManifest, CatalogProblem, ManifestSource};

mod builtin {
    include!(concat!(env!("OUT_DIR"), "/builtin_manifests.rs"));
}

/// Result of loading the catalog.
#[derive(Debug, Clone, Default)]
pub struct Catalog {
    pub manifests: Vec<AgentManifest>,
    pub problems: Vec<CatalogProblem>,
}

impl Catalog {
    pub fn get(&self, id: &str) -> Option<&AgentManifest> {
        self.manifests.iter().find(|manifest| manifest.id == id)
    }

    pub fn ids(&self) -> Vec<String> {
        self.manifests
            .iter()
            .map(|manifest| manifest.id.clone())
            .collect()
    }
}

/// Ids of the manifests compiled into the binary (test helper / diagnostics).
pub fn builtin_ids() -> Vec<&'static str> {
    builtin::BUILTIN_MANIFESTS
        .iter()
        .map(|(id, _)| *id)
        .collect()
}

/// Number of embedded manifests.
pub fn builtin_count() -> usize {
    builtin::BUILTIN_MANIFESTS.len()
}

/// Load the builtin catalog merged with user overrides from `user_dir` (when given).
pub fn load(user_dir: Option<&Path>) -> Catalog {
    let mut catalog = Catalog::default();
    let mut seen_ids: Vec<String> = Vec::new();

    for (origin_id, raw) in builtin::BUILTIN_MANIFESTS {
        match parse_manifest(raw, &format!("builtin:{origin_id}")) {
            Ok(manifest) => {
                push_manifest(&mut catalog, manifest, &mut seen_ids);
            }
            Err(problem) => catalog.problems.push(problem),
        }
    }

    let Some(user_dir) = user_dir else {
        finalize(&mut catalog);
        return catalog;
    };
    if !user_dir.is_dir() {
        finalize(&mut catalog);
        return catalog;
    }

    let mut files: Vec<std::path::PathBuf> = match std::fs::read_dir(user_dir) {
        Ok(entries) => entries
            .flatten()
            .map(|entry| entry.path())
            .filter(|path| {
                path.is_file() && path.extension().and_then(|e| e.to_str()) == Some("toml")
            })
            .collect(),
        Err(error) => {
            catalog.problems.push(CatalogProblem::error(
                user_dir.to_string_lossy().to_string(),
                format!("cannot read the user catalog directory: {error}"),
            ));
            finalize(&mut catalog);
            return catalog;
        }
    };
    files.sort();

    for file in files {
        let source = file.to_string_lossy().to_string();
        let raw = match std::fs::read_to_string(&file) {
            Ok(raw) => raw,
            Err(error) => {
                catalog.problems.push(CatalogProblem::error(
                    source.clone(),
                    format!("cannot read manifest: {error}"),
                ));
                continue;
            }
        };
        match parse_manifest(&raw, &source) {
            Ok(mut manifest) => {
                manifest.source = ManifestSource::User {
                    path: source.clone(),
                };
                // User manifests replace builtin ones with the same id.
                catalog
                    .manifests
                    .retain(|existing| existing.id != manifest.id);
                push_manifest(&mut catalog, manifest, &mut seen_ids);
            }
            Err(problem) => catalog.problems.push(problem),
        }
    }

    finalize(&mut catalog);
    catalog
}

/// Parse + validate a single manifest.
pub fn parse_manifest(raw: &str, source: &str) -> Result<AgentManifest, CatalogProblem> {
    let manifest: AgentManifest = toml_edit::de::from_str(raw)
        .map_err(|error| CatalogProblem::error(source, format!("invalid manifest: {error}")))?;

    let problems = manifest.validate();
    let errors: Vec<&crate::domain::ManifestProblem> = problems
        .iter()
        .filter(|problem| problem.severity == Severity::Error)
        .collect();
    if !errors.is_empty() {
        let message = errors
            .iter()
            .map(|problem| format!("{}: {}", problem.field, problem.message))
            .collect::<Vec<_>>()
            .join("; ");
        return Err(CatalogProblem::error(source, message).with_id(manifest.id.clone()));
    }
    Ok(manifest)
}

fn push_manifest(catalog: &mut Catalog, manifest: AgentManifest, seen: &mut Vec<String>) {
    for problem in manifest.validate() {
        if problem.severity == Severity::Warning {
            catalog.problems.push(
                CatalogProblem::warning(
                    match &manifest.source {
                        ManifestSource::Builtin => format!("builtin:{}", manifest.id),
                        ManifestSource::User { path } => path.clone(),
                    },
                    problem.message,
                )
                .with_id(manifest.id.clone())
                .with_field(problem.field),
            );
        }
    }
    seen.push(manifest.id.clone());
    catalog.manifests.push(manifest);
}

fn finalize(catalog: &mut Catalog) {
    catalog.manifests.sort_by_key(|a| a.name.to_lowercase());
    catalog.problems.sort_by(|a, b| a.source.cmp(&b.source));
}

#[cfg(test)]
mod tests {
    use super::*;

    const VALID: &str = r#"
id = "unit-demo"
name = "Unit Demo"
description = "used by tests"

[binaries]
names = ["unit-demo"]

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g unit-demo"
"#;

    #[test]
    fn parses_a_valid_manifest() {
        let manifest = parse_manifest(VALID, "test").unwrap();
        assert_eq!(manifest.id, "unit-demo");
    }

    #[test]
    fn rejects_manifests_with_errors() {
        let broken = VALID.replace("names = [\"unit-demo\"]", "names = []");
        let problem = parse_manifest(&broken, "test").unwrap_err();
        assert_eq!(problem.severity, Severity::Error);
        assert!(problem.message.contains("binaries.names"));
    }

    #[test]
    fn reports_syntax_errors_without_panicking() {
        let problem = parse_manifest("not toml at all", "test").unwrap_err();
        assert!(problem.message.contains("invalid manifest"));
    }

    #[test]
    fn user_manifest_overrides_builtin() {
        let dir = tempfile::tempdir().unwrap();
        let id = builtin_ids()
            .first()
            .copied()
            .expect("builtin manifests ship with the app");
        let path = dir.path().join(format!("{id}.toml"));
        std::fs::write(
            &path,
            format!(
                r#"
id = "{id}"
name = "Overridden {id}"
description = "user override"

[binaries]
names = ["{id}"]
"#
            ),
        )
        .unwrap();

        let catalog = load(Some(dir.path()));
        let manifest = catalog.get(id).expect("manifest present");
        assert_eq!(manifest.name, format!("Overridden {id}"));
        assert!(matches!(manifest.source, ManifestSource::User { .. }));
        // Exactly one manifest per id.
        assert_eq!(catalog.manifests.iter().filter(|m| m.id == id).count(), 1);
    }

    #[test]
    fn broken_user_manifest_is_reported_not_fatal() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("broken.toml"), "id = ").unwrap();
        let catalog = load(Some(dir.path()));
        assert!(catalog
            .problems
            .iter()
            .any(|problem| problem.source.ends_with("broken.toml")));
        assert_eq!(
            catalog.manifests.len(),
            builtin_count(),
            "problems: {:#?}",
            catalog.problems
        );
    }

    #[test]
    fn missing_user_dir_is_fine() {
        let catalog = load(Some(Path::new("/definitely/not/here")));
        assert_eq!(
            catalog.manifests.len(),
            builtin_count(),
            "builtin manifests failed to load: {:#?}",
            catalog.problems
        );
        assert!(
            catalog.problems.is_empty(),
            "problems: {:#?}",
            catalog.problems
        );
    }
}
