//! What the Hub offers, held against what this machine already has.
//!
//! The Hub does not remember what it installed: a skill written for an agent is that agent's skill
//! like any other, whoever put it there. So "already installed" is answered from the scan — the
//! very report the Library reads — and a card can name the owners that hold the entry.
//!
//! A repeating name is not proof, and a copy that was edited since (or one the publisher has since
//! changed) is not the same copy, so wherever the payload is at hand the two are compared by
//! content: a skill by the SHA-256 of its `SKILL.md`, a server by its launch recipe. That is what
//! turns "a skill of this name exists" into "this is the same thing, over there" — or into "the
//! collection publishes something else now".

use std::collections::HashMap;
use std::path::Path;

use sha2::{Digest, Sha256};

use crate::domain::{
    AgentRef, HubEntry, HubEntryInstall, HubResourceKind, McpServer, McpTransport, Scope, Skill,
};
use crate::services::scanner::ScanReport;

/// The identity of a skill payload: the SHA-256 of its entry file (`SKILL.md`).
///
/// An install writes that file exactly as the collection published it, so identical bytes mean the
/// same skill — and an edit at either end shows up as a difference instead of being hidden behind
/// a shared name.
pub fn skill_identity(bytes: &[u8]) -> String {
    format!("sha256:{}", hex::encode(Sha256::digest(bytes)))
}

/// The identity of a server: its launch recipe, and nothing else.
///
/// Two entries that run the same program with the same arguments *are* the same server however
/// they are named, and the protocol spelling (`sse` in one config, `streamable-http` in another) is
/// not part of that. A shape Ahabby does not understand has nothing to compare.
pub fn server_identity(transport: &McpTransport) -> Option<String> {
    match transport {
        McpTransport::Stdio { command, args } => Some(format!(
            "stdio:{}|{}",
            command.trim(),
            args.iter()
                .map(|argument| argument.trim())
                .collect::<Vec<_>>()
                .join("\u{1f}")
        )),
        McpTransport::Http { url, .. } => Some(format!("http:{}", url.trim())),
        McpTransport::Unknown { .. } => None,
    }
}

/// The key two names share when they name the same skill or server: case-insensitive, with every
/// run of characters that is not a letter or a digit collapsed to one `-`.
///
/// A skill installed from the Hub keeps the name its `SKILL.md` declares, while its directory is
/// derived from that name (`pdf-processing` for "PDF Processing"), so the comparison has to hold
/// across that spelling difference without merging genuinely different names.
pub fn match_key(name: &str) -> String {
    let mut key = String::new();
    let mut separator = false;
    for character in name.chars() {
        if character.is_alphanumeric() {
            key.extend(character.to_lowercase());
            separator = false;
        } else if !separator {
            key.push('-');
            separator = true;
        }
    }
    key.trim_matches('-').to_string()
}

/// One installed copy of a hub resource.
struct Candidate {
    owner: AgentRef,
    scope: Scope,
    /// The skill's own directory, or the config file holding the server entry.
    path: String,
    /// The entry file of an installed skill — reading it is what makes a comparison exact.
    entry_path: Option<String>,
    /// The identity of a server's recipe, known without touching the disk.
    known: Option<String>,
    enabled: bool,
}

impl Candidate {
    /// The identity of the copy: the recipe it already carries, or the `SKILL.md` read from disk.
    ///
    /// A file that cannot be read (removed between the scan and this comparison) simply has no
    /// identity, and the copy is reported as installed without the "same content" claim.
    fn identity(&self) -> Option<String> {
        if let Some(known) = &self.known {
            return Some(known.clone());
        }
        let entry = self.entry_path.as_deref()?;
        std::fs::read(entry)
            .ok()
            .map(|bytes| skill_identity(&bytes))
    }

    fn install(&self, published: Option<&str>) -> HubEntryInstall {
        HubEntryInstall {
            owner: self.owner.clone(),
            scope: self.scope.clone(),
            path: self.path.clone(),
            enabled: self.enabled,
            identical: published
                .and_then(|published| self.identity().map(|found| found == published)),
        }
    }
}

/// Every installed skill and server, keyed by the name a hub entry would have for it.
#[derive(Default)]
pub struct InstalledIndex {
    skills: HashMap<String, Vec<Candidate>>,
    servers: HashMap<String, Vec<Candidate>>,
}

impl InstalledIndex {
    /// Read the machine's own report.
    ///
    /// Agents that are not installed contribute nothing; the shared surface and the user's projects
    /// contribute exactly as the Library shows them — including the Library's own ownership rule,
    /// that a resource an agent manifest declares inside a shared root is reported through the
    /// shared surface only, so one document is never two "installs".
    ///
    /// The report is read where it lies rather than aggregated into a second copy of itself: a
    /// skill's body and a server's raw JSON are never needed here, and the Hub asks for this on
    /// every page it serves.
    pub fn of(report: &ScanReport) -> Self {
        let mut index = Self::default();
        let roots: Vec<&Path> = report.shared.roots.iter().map(Path::new).collect();
        let shared = |path: &str| roots.iter().any(|root| Path::new(path).starts_with(root));

        for agent in report.agents.iter().filter(|agent| agent.is_installed()) {
            for skill in &agent.skills {
                if !shared(&skill.path) {
                    index.push_skill(skill);
                }
            }
            for server in &agent.mcp_servers {
                if !shared(&server.source_config) {
                    index.push_server(server);
                }
            }
        }
        for skill in &report.shared.skills {
            index.push_skill(skill);
        }
        for server in &report.shared.mcp_servers {
            index.push_server(server);
        }
        // Projects are owners of their own (they never mix into the Library), but a resource inside
        // one is as installed as any other.
        for project in &report.projects.projects {
            for skill in &project.skills {
                index.push_skill(skill);
            }
            for server in &project.mcp_servers {
                index.push_server(server);
            }
        }

        index.finish();
        index
    }

    /// Say, for every entry, where it already is.
    ///
    /// Called on each answer rather than remembered: the report moves (an install, a deletion, a
    /// rescan), and an entry that was installed a second ago has to say so the next time it is
    /// asked about.
    pub fn annotate(&self, entries: &mut [HubEntry]) {
        for entry in entries {
            let known = match entry.kind {
                HubResourceKind::Skill => self.skills.get(&match_key(&entry.name)),
                HubResourceKind::Mcp => self.servers.get(&match_key(&entry.name)),
            };
            let Some(candidates) = known else { continue };
            entry.installed = candidates
                .iter()
                .map(|candidate| candidate.install(entry.identity.as_deref()))
                .collect();
        }
    }

    /// One installed skill, under every owner the scan stamped on it (an agent, the shared surface,
    /// a project) — the owners are the scan's, never recomputed here.
    fn push_skill(&mut self, skill: &Skill) {
        for owner in &skill.agents {
            self.push(
                HubResourceKind::Skill,
                &skill.name,
                Candidate {
                    owner: owner.clone(),
                    scope: skill.scope.clone(),
                    path: skill.path.clone(),
                    entry_path: skill.entry_path.clone(),
                    known: None,
                    enabled: skill.enabled,
                },
            );
        }
    }

    /// One installed server: its owner is the one the scan stamped on the entry itself.
    fn push_server(&mut self, server: &McpServer) {
        self.push(
            HubResourceKind::Mcp,
            &server.name,
            Candidate {
                owner: server.agent.clone(),
                scope: server.scope.clone(),
                path: server.source_config.clone(),
                entry_path: None,
                known: server_identity(&server.transport),
                enabled: server.enabled,
            },
        );
    }

    fn push(&mut self, kind: HubResourceKind, name: &str, candidate: Candidate) {
        let key = match_key(name);
        if key.is_empty() {
            return;
        }
        let table = match kind {
            HubResourceKind::Skill => &mut self.skills,
            HubResourceKind::Mcp => &mut self.servers,
        };
        let bucket = table.entry(key).or_default();
        // The same document can be read for two owners (a project read through two manifests, a
        // path reachable two ways): one copy on disk is one install, whatever reported it.
        if bucket
            .iter()
            .any(|known| known.owner.id == candidate.owner.id && known.path == candidate.path)
        {
            return;
        }
        bucket.push(candidate);
    }

    /// A stable order: what is switched on first, then by owner — so a card's chips do not shuffle
    /// between two answers about the same machine.
    fn finish(&mut self) {
        for table in [&mut self.skills, &mut self.servers] {
            for bucket in table.values_mut() {
                bucket.sort_by(|a, b| {
                    b.enabled
                        .cmp(&a.enabled)
                        .then_with(|| {
                            a.owner
                                .name
                                .to_lowercase()
                                .cmp(&b.owner.name.to_lowercase())
                        })
                        .then_with(|| a.owner.id.cmp(&b.owner.id))
                });
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        Agent, AgentStatus, HubResourceKind, McpServer, Os, Project, RemovalKind, SharedResources,
        Skill, Version, SHARED_OWNER_ID,
    };
    use crate::services::ScanReport;

    fn owner(id: &str) -> AgentRef {
        AgentRef {
            id: id.to_string(),
            name: id.to_string(),
            icon: None,
        }
    }

    fn skill(name: &str, path: &str, owner_id: &str) -> Skill {
        Skill {
            id: Skill::new_id(name, path),
            name: name.to_string(),
            description: None,
            path: path.to_string(),
            entry_path: Some(format!("{path}/SKILL.md")),
            scope: Scope::Global,
            agents: vec![owner(owner_id)],
            frontmatter: Vec::new(),
            content: None,
            size_bytes: None,
            created_ms: None,
            modified_ms: None,
            enabled: true,
            removable: true,
            unverified: false,
        }
    }

    fn without_entry(skill: &mut Skill) {
        skill.entry_path = None;
    }

    fn server(name: &str, command: &str, owner_id: &str) -> McpServer {
        let key_path = vec!["mcpServers".to_string(), name.to_string()];
        McpServer {
            id: McpServer::new_id(name, "/home/u/.config/mcp.json", &key_path),
            name: name.to_string(),
            transport: McpTransport::Stdio {
                command: command.to_string(),
                args: vec!["-y".to_string()],
            },
            scope: Scope::Global,
            agent: owner(owner_id),
            source_config: "/home/u/.config/mcp.json".to_string(),
            key_path,
            env: Vec::new(),
            headers: Vec::new(),
            raw: "{}".to_string(),
            created_ms: None,
            modified_ms: None,
            has_secrets: false,
            enabled: true,
            removable: true,
            unverified: false,
        }
    }

    fn agent(id: &str, skills: Vec<Skill>, servers: Vec<McpServer>) -> Agent {
        Agent {
            id: id.to_string(),
            name: id.to_string(),
            description: String::new(),
            tagline: None,
            icon: None,
            category: None,
            website: None,
            docs: None,
            vendor: None,
            features: Vec::new(),
            github: None,
            popular: false,
            status: AgentStatus::Installed,
            binary_path: None,
            found_in: None,
            version: Some(Version::parse("1.0.0").unwrap()),
            installed_via: None,
            install_options: Vec::new(),
            can_install: false,
            install_docs_url: None,
            can_update: false,
            can_uninstall: false,
            configs: Vec::new(),
            facts: Vec::new(),
            skills,
            mcp_servers: servers,
            other: Vec::new(),
            extensions: Vec::new(),
            extensions_supported: false,
            update: None,
            unverified: Vec::new(),
            notes: None,
            manifest_source: Default::default(),
            removal: RemovalKind::Hidden,
            warnings: Vec::new(),
            scan_ms: 1,
        }
    }

    fn report(agents: Vec<Agent>, projects: Vec<Project>) -> ScanReport {
        ScanReport {
            installed: agents.len(),
            agents,
            problems: Vec::new(),
            scanned_at_ms: 1,
            duration_ms: 1,
            available_to_install: 0,
            os: Os::Linux,
            shared: SharedResources::default(),
            projects: crate::domain::ProjectScan {
                folders: Vec::new(),
                projects,
                scanned_at_ms: 1,
                duration_ms: 1,
            },
        }
    }

    fn entry(kind: HubResourceKind, name: &str, identity: Option<&str>) -> HubEntry {
        HubEntry {
            id: format!("source/{name}"),
            source_id: "source".to_string(),
            source_name: "Source".to_string(),
            kind,
            name: name.to_string(),
            title: None,
            description: None,
            version: None,
            vendor: None,
            homepage: None,
            repository: None,
            license: None,
            tags: Vec::new(),
            group: None,
            file_count: None,
            size_bytes: None,
            installable: true,
            install_problem: None,
            input_count: 0,
            has_scripts: false,
            installed: Vec::new(),
            identity: identity.map(str::to_string),
        }
    }

    #[test]
    fn names_are_compared_across_spellings_but_not_across_words() {
        assert_eq!(match_key("PDF Processing"), "pdf-processing");
        assert_eq!(match_key("pdf_processing"), "pdf-processing");
        assert_eq!(match_key("  PDF-Processing  "), "pdf-processing");
        assert_eq!(match_key("!!!"), "");
        assert_ne!(match_key("pdf"), match_key("pdf-processing"));
    }

    #[test]
    fn a_recipe_is_the_same_server_however_it_is_named() {
        let stdio = McpTransport::Stdio {
            command: " npx ".to_string(),
            args: vec![" -y ".to_string(), "@x/y".to_string()],
        };
        assert_eq!(
            server_identity(&stdio).unwrap(),
            server_identity(&McpTransport::Stdio {
                command: "npx".to_string(),
                args: vec!["-y".to_string(), "@x/y".to_string()],
            })
            .unwrap()
        );
        assert!(server_identity(&McpTransport::Unknown {
            detail: "?".to_string()
        })
        .is_none());
    }

    #[test]
    fn an_installed_skill_is_reported_for_its_owner() {
        let mut installed = skill(
            "PDF Processing",
            "/home/u/.claude/skills/pdf-processing",
            "claude-code",
        );
        without_entry(&mut installed);

        let index = InstalledIndex::of(&report(
            vec![agent("claude-code", vec![installed], Vec::new())],
            Vec::new(),
        ));
        let mut entries = vec![entry(HubResourceKind::Skill, "pdf processing", None)];
        index.annotate(&mut entries);

        let found = &entries[0].installed;
        assert_eq!(found.len(), 1);
        assert_eq!(found[0].owner.id, "claude-code");
        assert_eq!(found[0].path, "/home/u/.claude/skills/pdf-processing");
        assert!(found[0].enabled);
        // Nothing was published to compare against, so the card may say "installed" and no more.
        assert_eq!(found[0].identical, None);
    }

    #[test]
    fn a_skill_whose_contents_are_known_is_compared_by_hash() {
        let directory = tempfile::tempdir().unwrap();
        let entry_file = directory.path().join("SKILL.md");
        std::fs::write(&entry_file, b"# PDF\n").unwrap();

        let mut installed = skill("pdf", "/home/u/.claude/skills/pdf", "claude-code");
        installed.entry_path = Some(entry_file.to_string_lossy().to_string());

        let index = InstalledIndex::of(&report(
            vec![agent("claude-code", vec![installed], Vec::new())],
            Vec::new(),
        ));

        let published = skill_identity(b"# PDF\n");
        let mut entries = vec![entry(HubResourceKind::Skill, "pdf", Some(&published))];
        index.annotate(&mut entries);
        assert_eq!(entries[0].installed[0].identical, Some(true));

        // The collection moved on: the same name, a different payload.
        let moved = skill_identity(b"# PDF v2\n");
        let mut entries = vec![entry(HubResourceKind::Skill, "pdf", Some(&moved))];
        index.annotate(&mut entries);
        assert_eq!(entries[0].installed[0].identical, Some(false));
    }

    #[test]
    fn a_server_is_matched_by_its_recipe_and_says_nothing_about_other_names() {
        let index = InstalledIndex::of(&report(
            vec![agent(
                "cursor",
                Vec::new(),
                vec![server("github", "npx", "cursor")],
            )],
            Vec::new(),
        ));

        let recipe = server_identity(&McpTransport::Stdio {
            command: "npx".to_string(),
            args: vec!["-y".to_string()],
        });

        let mut entries = vec![
            entry(HubResourceKind::Mcp, "GitHub", recipe.as_deref()),
            entry(HubResourceKind::Mcp, "gitlab", recipe.as_deref()),
            entry(HubResourceKind::Skill, "github", recipe.as_deref()),
        ];
        index.annotate(&mut entries);

        assert_eq!(entries[0].installed.len(), 1);
        assert_eq!(entries[0].installed[0].owner.id, "cursor");
        assert_eq!(entries[0].installed[0].identical, Some(true));
        assert!(
            entries[1].installed.is_empty(),
            "a different name is not this server"
        );
        assert!(entries[2].installed.is_empty(), "a skill is not a server");
    }

    #[test]
    fn a_project_and_the_shared_surface_are_owners_too() {
        let project = Project {
            id: "project:abc123".to_string(),
            name: "Ahabby".to_string(),
            root: "/home/u/work/Ahabby".to_string(),
            folder_id: "folder".to_string(),
            skills: vec![skill(
                "pdf",
                "/home/u/work/Ahabby/.claude/skills/pdf",
                "project:abc123",
            )],
            mcp_servers: Vec::new(),
            other: Vec::new(),
            configs: Vec::new(),
            modified_ms: None,
            warnings: Vec::new(),
            scan_ms: 1,
        };

        let mut scan = report(Vec::new(), vec![project]);
        scan.shared.skills = vec![skill("pdf", "/home/u/.agents/skills/pdf", SHARED_OWNER_ID)];

        let index = InstalledIndex::of(&scan);
        let mut entries = vec![entry(HubResourceKind::Skill, "pdf", None)];
        index.annotate(&mut entries);

        let owners: Vec<&str> = entries[0]
            .installed
            .iter()
            .map(|install| install.owner.id.as_str())
            .collect();
        assert_eq!(owners, vec!["project:abc123", SHARED_OWNER_ID]);
    }

    #[test]
    fn a_shared_root_declared_by_an_agent_counts_once_and_as_global() {
        let path = "/home/u/.agents/skills/pdf";
        let mut scan = report(
            vec![agent(
                "goose",
                vec![skill("pdf", path, "goose")],
                Vec::new(),
            )],
            Vec::new(),
        );
        scan.shared.skills = vec![skill("pdf", path, SHARED_OWNER_ID)];
        scan.shared.roots = vec!["/home/u/.agents".to_string()];

        let mut entries = vec![entry(HubResourceKind::Skill, "pdf", None)];
        InstalledIndex::of(&scan).annotate(&mut entries);

        // The Library's own rule: a path an agent manifest also declares inside a shared root is
        // reported as the shared surface's, so one document is one install.
        assert_eq!(entries[0].installed.len(), 1);
        assert_eq!(entries[0].installed[0].owner.id, SHARED_OWNER_ID);
    }
}
