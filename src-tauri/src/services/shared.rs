//! The agent-neutral ("shared") surface.
//!
//! Agents in the wild converge on one cross-tool location for global knowledge — the
//! `.agents` directory (`~/.agents/skills`, `~/.agents/mcp.json`, `~/.agents/AGENTS.md`) —
//! and several manifests already declare those exact paths as their own. Reading them once,
//! as a surface that belongs to no single agent, is what lets the Library show a global
//! skill as "shared" instead of attributing it to whichever agent happens to declare it.
//!
//! The surface is described by `catalog/shared.toml` and read through the same
//! [`ManifestAdapter`] as a regular agent, so formats, globs, secret masking and — critically
//! — the path checks that guard deletion and writing are shared, not reimplemented.

use std::future::Future;
use std::path::PathBuf;
use std::sync::{Arc, LazyLock};
use std::time::Duration;

use tracing::warn;

use crate::adapters::{AgentAdapter, ManifestAdapter};
use crate::catalog::parse_manifest;
use crate::domain::{AgentManifest, SharedResources};
use crate::error::Result;
use crate::platform::PlatformContext;
use crate::state::{resolve_in, DocumentTarget};

/// Reading the shared surface must never hang a scan.
const SHARED_TIMEOUT: Duration = Duration::from_secs(10);

const MANIFEST_TOML: &str = include_str!("../../catalog/shared.toml");

/// The parsed manifest of the shared surface.
///
/// It is compiled in and validated by a unit test, so construction can only fail if the file
/// was edited into an invalid state.
pub fn manifest() -> &'static AgentManifest {
    static MANIFEST: LazyLock<AgentManifest> = LazyLock::new(|| {
        parse_manifest(MANIFEST_TOML, "shared").expect("catalog/shared.toml must stay valid")
    });
    &MANIFEST
}

/// The adapter that reads and deletes agents' shared resources. Removal goes through it, so
/// the "path must live under a declared root" rule is enforced exactly like for an agent.
pub fn adapter() -> Arc<dyn AgentAdapter> {
    Arc::new(ManifestAdapter::new(manifest().clone()))
}

/// Resolved roots of the shared surface, as strings for the scan report.
fn roots(ctx: &PlatformContext) -> Vec<String> {
    let manifest = manifest();
    let mut roots: Vec<PathBuf> = Vec::new();
    roots.extend(
        manifest
            .configs
            .iter()
            .filter_map(|spec| ctx.expand_map(&spec.path)),
    );
    if let Some(skills) = &manifest.skills {
        roots.extend(ctx.expand_map(&skills.path));
    }
    if let Some(mcp) = &manifest.mcp {
        roots.extend(ctx.expand_map(&mcp.path));
    }
    roots.extend(
        manifest
            .other
            .iter()
            .filter_map(|spec| ctx.expand_map(&spec.path)),
    );
    // A file can be declared twice (the shared `mcp.json` is both a config and the MCP
    // source); one root is enough.
    roots.sort();
    roots.dedup();
    roots
        .into_iter()
        .map(|root| root.to_string_lossy().to_string())
        .collect()
}

/// Read the whole shared surface. A directory that does not exist yields nothing; a failure
/// in one category never fails the scan.
pub async fn scan(ctx: &PlatformContext) -> SharedResources {
    let adapter = adapter();

    let configs = read("configs", adapter.config_files(ctx)).await;
    let skills = read("skills", adapter.list_skills(ctx)).await;
    let mcp_servers = read("mcp servers", adapter.list_mcp_servers(ctx)).await;
    // An `other` spec always produces an entry, existing or not; a shared document that is
    // absent would only be noise in the Library, so it is dropped here.
    let other: Vec<_> = read("documents", adapter.list_other_resources(ctx))
        .await
        .into_iter()
        .filter(|resource| resource.exists)
        .collect();

    SharedResources {
        configs,
        skills,
        mcp_servers,
        other,
        roots: roots(ctx),
    }
}

/// Resolve an addressable document of the shared surface (reading, editing, revealing).
pub fn resolve_document(resources: &SharedResources, path: &str) -> Result<DocumentTarget> {
    resolve_in(
        &resources.configs,
        &resources.other,
        &resources.skills,
        "the shared library",
        path,
    )
}

/// Run one reader with a hard timeout; a comment-worthy failure becomes an empty list.
async fn read<T>(label: &str, future: impl Future<Output = Result<Vec<T>>>) -> Vec<T> {
    match tokio::time::timeout(SHARED_TIMEOUT, future).await {
        Ok(Ok(items)) => items,
        Ok(Err(error)) => {
            warn!("shared {label}: {error}");
            Vec::new()
        }
        Err(_) => {
            warn!(
                "shared {label}: timed out after {}s",
                SHARED_TIMEOUT.as_secs()
            );
            Vec::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Os, Scope, SkillFormat};

    #[test]
    fn the_shared_manifest_is_valid_and_declares_what_the_library_needs() {
        let manifest = manifest();
        assert_eq!(manifest.id, crate::domain::SHARED_OWNER_ID);
        assert!(manifest
            .validate()
            .iter()
            .all(|problem| { problem.severity != crate::domain::Severity::Error }));

        let skills = manifest
            .skills
            .as_ref()
            .expect("shared skills are declared");
        assert_eq!(skills.format, SkillFormat::SkillMd);
        assert_eq!(skills.path.get(Os::Linux), Some("${HOME}/.agents/skills"));

        let mcp = manifest.mcp.as_ref().expect("shared MCP is declared");
        assert_eq!(mcp.key_path, vec!["mcpServers".to_string()]);
        assert!(mcp.shared_with_config);

        let config = manifest
            .configs
            .iter()
            .find(|spec| spec.id == "mcp")
            .expect("the mcp file is addressable");
        assert_eq!(config.scope, Scope::Global);

        assert!(manifest
            .other
            .iter()
            .any(|spec| spec.kind == crate::domain::OtherKind::Instructions));
    }

    #[test]
    fn roots_cover_every_declared_location() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = PlatformContext::for_tests(Os::Linux, dir.path(), dir.path(), dir.path());
        let roots = roots(&ctx);
        assert!(roots.iter().any(|root| root.ends_with(".agents/skills")));
        assert!(roots.iter().any(|root| root.ends_with(".agents/mcp.json")));
        assert!(roots.iter().any(|root| root.ends_with(".agents/AGENTS.md")));
    }

    #[tokio::test]
    async fn scan_reads_the_cross_agent_locations() {
        let dir = tempfile::tempdir().unwrap();
        let agents = dir.path().join(".agents");
        std::fs::create_dir_all(agents.join("skills/review")).unwrap();
        std::fs::write(
            agents.join("skills/review/SKILL.md"),
            "---\nname: review\ndescription: Review code\n---\n# Review\n",
        )
        .unwrap();
        std::fs::write(
            agents.join("mcp.json"),
            r#"{"mcpServers":{"github":{"command":"npx","args":["-y","server-github"]}}}"#,
        )
        .unwrap();
        std::fs::write(agents.join("AGENTS.md"), "# House rules\n").unwrap();

        let ctx = PlatformContext::for_tests(Os::Linux, dir.path(), dir.path(), dir.path());
        let shared = scan(&ctx).await;

        assert_eq!(shared.skills.len(), 1);
        assert_eq!(shared.skills[0].name, "review");
        assert_eq!(
            shared.skills[0].agents[0].id,
            crate::domain::SHARED_OWNER_ID
        );
        assert_eq!(shared.mcp_servers.len(), 1);
        assert_eq!(shared.mcp_servers[0].name, "github");
        assert_eq!(shared.other.len(), 1);
        assert!(std::path::Path::new(&shared.other[0].path).ends_with("AGENTS.md"));
        assert!(shared
            .roots
            .iter()
            .any(|root| root.ends_with(".agents/skills")));

        // A document of the shared surface resolves for reading and editing.
        let target = resolve_document(&shared, &shared.other[0].path).unwrap();
        assert!(target.editable);
        assert!(resolve_document(&shared, "/etc/passwd").is_err());
    }

    #[tokio::test]
    async fn scan_skips_absent_documents() {
        let dir = tempfile::tempdir().unwrap();
        let ctx = PlatformContext::for_tests(Os::Linux, dir.path(), dir.path(), dir.path());
        let shared = scan(&ctx).await;
        assert!(shared.skills.is_empty());
        assert!(shared.mcp_servers.is_empty());
        assert!(shared.other.is_empty(), "a missing AGENTS.md is not listed");
    }
}
