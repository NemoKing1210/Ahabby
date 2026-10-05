//! Aggregation of the scan result into the "Library" view.
//!
//! Skills and MCP servers are returned **per agent and per path**, not merged by name:
//! two agents can ship a skill with the same name but different contents, and deleting a
//! merged row would be ambiguous. Grouping by name happens in the UI, where it is a pure
//! presentation concern; each row here still points at exactly one thing on disk.

use crate::domain::{Library, LibraryStats, Skill};

use super::scanner::ScanReport;

pub fn aggregate(report: &ScanReport) -> Library {
    let mut skills: Vec<Skill> = Vec::new();
    let mut mcp_servers = Vec::new();
    let mut other = Vec::new();

    for agent in &report.agents {
        if !agent.is_installed() {
            continue;
        }
        skills.extend(agent.skills.iter().cloned());
        mcp_servers.extend(agent.mcp_servers.iter().cloned());
        other.extend(agent.other.iter().cloned());
    }

    // Identical ids can only come from the same file read twice; keep the first.
    dedupe_by_id(&mut skills);
    dedupe_by_id(&mut mcp_servers);
    dedupe_by_id(&mut other);

    skills.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    mcp_servers.sort_by(|a, b| {
        a.name
            .to_lowercase()
            .cmp(&b.name.to_lowercase())
            .then_with(|| a.agent.id.cmp(&b.agent.id))
    });
    other.sort_by(|a, b| {
        format!("{:?}", a.kind)
            .cmp(&format!("{:?}", b.kind))
            .then_with(|| a.label.to_lowercase().cmp(&b.label.to_lowercase()))
    });

    let stats = LibraryStats {
        agents: report.agents.len(),
        installed_agents: report.installed,
        skills: skills.len(),
        mcp_servers: mcp_servers.len(),
        other: other.len(),
    };

    Library {
        skills,
        mcp_servers,
        other,
        stats,
        scanned_at_ms: report.scanned_at_ms,
        problems: report.problems.clone(),
    }
}

fn dedupe_by_id<T: HasId>(items: &mut Vec<T>) {
    let mut seen: Vec<String> = Vec::new();
    items.retain(|item| {
        let id = item.id();
        if seen.contains(&id) {
            false
        } else {
            seen.push(id);
            true
        }
    });
}

trait HasId {
    fn id(&self) -> String;
}

impl HasId for Skill {
    fn id(&self) -> String {
        self.id.clone()
    }
}

impl HasId for crate::domain::McpServer {
    fn id(&self) -> String {
        self.id.clone()
    }
}

impl HasId for crate::domain::OtherResource {
    fn id(&self) -> String {
        self.id.clone()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{
        Agent, AgentRef, AgentStatus, CatalogProblem, ConfigFormat, EnvVar, McpServer,
        McpTransport, Os, OtherKind, OtherResource, RemovalKind, Scope, Severity, Version,
    };

    fn agent_ref(id: &str) -> AgentRef {
        AgentRef {
            id: id.to_string(),
            name: id.to_string(),
            icon: None,
        }
    }

    fn skill(agent: &str, name: &str, path: &str) -> Skill {
        Skill {
            id: Skill::new_id(name, path),
            name: name.to_string(),
            description: Some(format!("about {name}")),
            path: path.to_string(),
            entry_path: Some(format!("{path}/SKILL.md")),
            scope: Scope::Global,
            agents: vec![agent_ref(agent)],
            frontmatter: Vec::new(),
            content: Some("# body".to_string()),
            size_bytes: Some(10),
            removable: true,
            unverified: false,
        }
    }

    fn server(agent: &str, name: &str, file: &str) -> McpServer {
        let key_path = vec!["mcpServers".to_string(), name.to_string()];
        McpServer {
            id: McpServer::new_id(name, file, &key_path),
            name: name.to_string(),
            transport: McpTransport::Stdio {
                command: "npx".to_string(),
                args: vec!["-y".to_string()],
            },
            scope: Scope::Global,
            agent: agent_ref(agent),
            source_config: file.to_string(),
            key_path,
            env: vec![EnvVar {
                key: "TOKEN".to_string(),
                value: None,
                masked: true,
            }],
            headers: Vec::new(),
            raw: "{}".to_string(),
            has_secrets: true,
            removable: true,
            unverified: false,
        }
    }

    fn empty_agent(id: &str, status: AgentStatus) -> Agent {
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
            status,
            binary_path: None,
            found_in: None,
            version: Some(Version::parse("1.0.0").unwrap()),
            installed_via: None,
            install_options: Vec::new(),
            can_install: false,
            install_docs_url: None,
            can_update: false,
            configs: Vec::new(),
            skills: Vec::new(),
            mcp_servers: Vec::new(),
            other: Vec::new(),
            update: None,
            unverified: Vec::new(),
            notes: None,
            manifest_source: Default::default(),
            removal: RemovalKind::Hidden,
            warnings: Vec::new(),
            scan_ms: 1,
        }
    }

    fn report(agents: Vec<Agent>) -> ScanReport {
        ScanReport {
            installed: agents.iter().filter(|agent| agent.is_installed()).count(),
            agents,
            problems: vec![CatalogProblem::warning("test", "something").with_field("methods")],
            scanned_at_ms: 42,
            duration_ms: 7,
            available_to_install: 0,
            os: Os::Linux,
        }
    }

    #[test]
    fn aggregates_and_sorts_across_agents() {
        let mut first = empty_agent("claude-code", AgentStatus::Installed);
        first.skills = vec![skill("claude-code", "zeta", "/home/u/.claude/skills/zeta")];
        first.mcp_servers = vec![server("claude-code", "github", "/home/u/.claude.json")];
        first.other = vec![OtherResource {
            id: "claude-code.instructions.1".to_string(),
            kind: OtherKind::Instructions,
            label: "CLAUDE.md".to_string(),
            path: "/home/u/.claude/CLAUDE.md".to_string(),
            agent: agent_ref("claude-code"),
            scope: Scope::Global,
            format: ConfigFormat::Markdown,
            description: None,
            content: None,
            size_bytes: None,
            is_directory: false,
            exists: false,
            item_count: None,
            unverified: false,
        }];

        let mut second = empty_agent("opencode", AgentStatus::Installed);
        second.skills = vec![skill(
            "opencode",
            "alpha",
            "/home/u/.config/opencode/skill/alpha",
        )];

        let mut absent = empty_agent("codex", AgentStatus::NotInstalled);
        absent.skills = vec![skill("codex", "ignored", "/home/u/.codex/skills/ignored")];

        let library = aggregate(&report(vec![first, second, absent]));

        assert_eq!(library.skills.len(), 2, "only installed agents contribute");
        assert_eq!(library.skills[0].name, "alpha");
        assert_eq!(library.skills[1].name, "zeta");
        assert_eq!(library.mcp_servers.len(), 1);
        assert_eq!(library.other.len(), 1);

        assert_eq!(library.stats.agents, 3);
        assert_eq!(library.stats.installed_agents, 2);
        assert_eq!(library.stats.skills, 2);
        assert_eq!(library.stats.mcp_servers, 1);
        assert_eq!(library.scanned_at_ms, 42);
        assert_eq!(library.problems.len(), 1);
        assert_eq!(library.problems[0].severity, Severity::Warning);
    }

    #[test]
    fn same_named_skills_from_different_agents_stay_separate_documents() {
        let mut first = empty_agent("claude-code", AgentStatus::Installed);
        first.skills = vec![skill("claude-code", "pdf", "/a/pdf")];
        let mut second = empty_agent("opencode", AgentStatus::Installed);
        second.skills = vec![skill("opencode", "pdf", "/b/pdf")];

        let library = aggregate(&report(vec![first, second]));
        assert_eq!(library.skills.len(), 2);
        assert!(library.skills.iter().all(|skill| skill.name == "pdf"));
        assert_ne!(library.skills[0].path, library.skills[1].path);
    }
}
