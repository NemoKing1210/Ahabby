//! The project adapter: one project's resources, through the ordinary manifest-driven reader.
//!
//! A project is not an agent — it is a directory the user works in — but what Ahabby has to do
//! to it is identical: read the skills, MCP servers and documents it declares, edit a file, add a
//! server, switch something off, delete it. Wrapping the [`ManifestAdapter`] instead of
//! reimplementing that is what keeps one set of path checks, one editor and one backup rule.
//!
//! This wrapper owns two things the inner adapter cannot know:
//!
//! * **the root.** `catalog/project.toml` declares *relative* paths, and every call is given a
//!   context rooted at this project — whatever context the caller passed. A project path can
//!   therefore only ever resolve inside its own project, which is what makes a forged path from
//!   the webview pointless instead of dangerous.
//! * **the owner.** Everything the project yields is stamped with the project as its owner and
//!   with `Scope::Project`, including what a *write* returns, so no caller ever sees the surface
//!   manifest (`project`) as the owner of a skill it just created.

use std::path::PathBuf;

use async_trait::async_trait;

use crate::domain::{
    project_owner_ref, AgentManifest, AgentRef, ConfigFile, Detection, InstallAction, InstallPlan,
    McpServer, McpServerDraft, OtherResource, Scope, Skill, SkillDraft, SkillInstall, Version,
};
use crate::error::Result;
use crate::platform::PlatformContext;

use super::{AgentAdapter, ManifestAdapter};

pub struct ProjectAdapter {
    inner: ManifestAdapter,
    root: PathBuf,
    owner: AgentRef,
    scope: Scope,
}

impl ProjectAdapter {
    pub fn new(manifest: AgentManifest, root: PathBuf) -> Self {
        let root = crate::platform::canonical_dir(&root).unwrap_or(root);
        let owner = project_owner_ref(&root);
        let scope = Scope::Project {
            root: root.to_string_lossy().to_string(),
        };
        Self {
            // The inner adapter's ownership guards compare against the id its resources carry,
            // which for a project is the project's own id — not the surface manifest's.
            inner: ManifestAdapter::new(manifest).owned_by(owner.id.clone()),
            root,
            owner,
            scope,
        }
    }

    /// The root of the project this adapter reads.
    pub fn root(&self) -> &std::path::Path {
        &self.root
    }

    /// The context a call must actually run with: the caller's, rooted at this project.
    fn at(&self, ctx: &PlatformContext) -> PlatformContext {
        ctx.clone().with_project_root(&self.root)
    }

    fn stamp_skill(&self, skill: &mut Skill) {
        skill.scope = self.scope.clone();
        skill.agents = vec![self.owner.clone()];
    }

    fn stamp_server(&self, server: &mut McpServer) {
        server.scope = self.scope.clone();
        server.agent = self.owner.clone();
    }

    fn stamp_config(&self, config: &mut ConfigFile) {
        config.scope = self.scope.clone();
        config.agent = self.owner.clone();
    }

    fn stamp_resource(&self, resource: &mut OtherResource) {
        resource.scope = self.scope.clone();
        resource.agent = self.owner.clone();
    }
}

#[async_trait]
impl AgentAdapter for ProjectAdapter {
    fn manifest(&self) -> &AgentManifest {
        self.inner.manifest()
    }

    fn agent_ref(&self) -> AgentRef {
        self.owner.clone()
    }

    /// A project is never detected, installed or versioned: the caller reads its resources.
    async fn detect(&self, _ctx: &PlatformContext) -> Result<Option<Detection>> {
        Ok(None)
    }

    async fn version(&self, _ctx: &PlatformContext, _detection: &Detection) -> Option<Version> {
        None
    }

    async fn config_files(&self, ctx: &PlatformContext) -> Result<Vec<ConfigFile>> {
        let mut configs = self.inner.config_files(&self.at(ctx)).await?;
        for config in &mut configs {
            self.stamp_config(config);
        }
        Ok(configs)
    }

    async fn list_skills(&self, ctx: &PlatformContext) -> Result<Vec<Skill>> {
        let mut skills = self.inner.list_skills(&self.at(ctx)).await?;
        for skill in &mut skills {
            self.stamp_skill(skill);
        }
        Ok(skills)
    }

    async fn list_mcp_servers(&self, ctx: &PlatformContext) -> Result<Vec<McpServer>> {
        let mut servers = self.inner.list_mcp_servers(&self.at(ctx)).await?;
        for server in &mut servers {
            self.stamp_server(server);
        }
        Ok(servers)
    }

    async fn list_other_resources(&self, ctx: &PlatformContext) -> Result<Vec<OtherResource>> {
        let mut resources = self.inner.list_other_resources(&self.at(ctx)).await?;
        for resource in &mut resources {
            self.stamp_resource(resource);
        }
        Ok(resources)
    }

    async fn remove_skill(&self, ctx: &PlatformContext, skill: &Skill) -> Result<()> {
        self.inner.remove_skill(&self.at(ctx), skill).await
    }

    async fn remove_mcp_server(&self, ctx: &PlatformContext, server: &McpServer) -> Result<()> {
        self.inner.remove_mcp_server(&self.at(ctx), server).await
    }

    async fn set_skill_enabled(
        &self,
        ctx: &PlatformContext,
        skill: &Skill,
        enabled: bool,
    ) -> Result<()> {
        self.inner
            .set_skill_enabled(&self.at(ctx), skill, enabled)
            .await
    }

    async fn set_mcp_server_enabled(
        &self,
        ctx: &PlatformContext,
        server: &McpServer,
        enabled: bool,
    ) -> Result<()> {
        self.inner
            .set_mcp_server_enabled(&self.at(ctx), server, enabled)
            .await
    }

    async fn create_skill(&self, ctx: &PlatformContext, draft: &SkillDraft) -> Result<Skill> {
        let mut skill = self.inner.create_skill(&self.at(ctx), draft).await?;
        self.stamp_skill(&mut skill);
        Ok(skill)
    }

    async fn install_skill(&self, ctx: &PlatformContext, install: &SkillInstall) -> Result<Skill> {
        let mut skill = self.inner.install_skill(&self.at(ctx), install).await?;
        self.stamp_skill(&mut skill);
        Ok(skill)
    }

    async fn create_mcp_server(
        &self,
        ctx: &PlatformContext,
        draft: &McpServerDraft,
    ) -> Result<McpServer> {
        let mut server = self.inner.create_mcp_server(&self.at(ctx), draft).await?;
        self.stamp_server(&mut server);
        Ok(server)
    }

    async fn install_plan(
        &self,
        ctx: &PlatformContext,
        action: InstallAction,
        method_id: Option<&str>,
    ) -> Result<InstallPlan> {
        self.inner
            .install_plan(&self.at(ctx), action, method_id)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Os, SkillFormat};
    use crate::services::project;

    #[tokio::test]
    async fn a_created_skill_already_carries_its_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("app");
        std::fs::create_dir_all(&root).unwrap();
        let ctx = PlatformContext::for_tests(Os::current(), dir.path(), dir.path(), dir.path());

        let adapter = ProjectAdapter::new(project::manifest().clone(), root.clone());
        let created = adapter
            .create_skill(
                &ctx,
                &SkillDraft {
                    name: "Deploy".to_string(),
                    description: None,
                    content: None,
                },
            )
            .await
            .unwrap();

        // The owner is the project, not the surface manifest it was read through.
        assert_eq!(created.agents.len(), 1);
        assert_eq!(
            created.agents[0].id,
            crate::domain::project_owner_id(&crate::domain::ProjectFolder::normalize(
                &root.to_string_lossy()
            ))
        );
        assert_eq!(created.agents[0].name, "app");
        assert!(matches!(created.scope, Scope::Project { .. }));

        // …and the file landed inside the project, in the directory the surface lists first.
        let entry = created.entry_path.clone().unwrap().replace('\\', "/");
        assert!(
            entry.ends_with("/app/.claude/skills/deploy/SKILL.md"),
            "{entry}"
        );
        assert_eq!(project::manifest().skills[0].format, SkillFormat::SkillMd);
    }

    #[tokio::test]
    async fn a_foreign_context_cannot_move_the_read_outside_the_project() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("app");
        let elsewhere = dir.path().join("elsewhere");
        std::fs::create_dir_all(root.join(".claude/skills/pdf")).unwrap();
        std::fs::create_dir_all(elsewhere.join(".claude/skills/other")).unwrap();
        std::fs::write(
            root.join(".claude/skills/pdf/SKILL.md"),
            "---\nname: pdf\n---\n",
        )
        .unwrap();
        std::fs::write(
            elsewhere.join(".claude/skills/other/SKILL.md"),
            "---\nname: other\n---\n",
        )
        .unwrap();

        let adapter = ProjectAdapter::new(project::manifest().clone(), root.clone());
        // A context rooted somewhere else is ignored: the adapter re-roots every call.
        let ctx = PlatformContext::for_tests(Os::current(), dir.path(), dir.path(), dir.path())
            .with_project_root(&elsewhere);
        let skills = adapter.list_skills(&ctx).await.unwrap();
        assert_eq!(skills.len(), 1);
        assert_eq!(skills[0].name, "pdf");
    }
}
