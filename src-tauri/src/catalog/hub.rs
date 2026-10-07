//! Hub sources: where the library comes from.
//!
//! Same two-layer story as [`crate::catalog::loader`]: **builtin** sources are TOML files
//! embedded in the binary at compile time (`catalog/hub/*.toml`, see `build.rs`) and **user**
//! sources come from `<app config>/hub/*.toml`, where a file with the same id replaces the
//! builtin one. A source that fails to parse or validate is skipped and reported, never fatal.
//!
//! A source is validated strictly, because everything it declares is turned into a request:
//! the `owning` repository and the git ref must be plain enough that no path can be smuggled
//! into the tarball URL, and the id must be addressable (it is the first half of every entry id).

use std::path::Path;

use crate::domain::{
    CatalogProblem, HubResourceKind, HubSource, HubSourceCatalog, HubSourceKind, MAX_TAGS,
    MAX_TAG_LEN,
};

mod builtin {
    include!(concat!(env!("OUT_DIR"), "/builtin_hub_sources.rs"));
}

/// Ids of the sources compiled into the binary (test helper / diagnostics).
pub fn builtin_ids() -> Vec<&'static str> {
    builtin::BUILTIN_HUB_SOURCES
        .iter()
        .map(|(id, _)| *id)
        .collect()
}

/// Number of embedded sources.
pub fn builtin_count() -> usize {
    builtin::BUILTIN_HUB_SOURCES.len()
}

/// Load the builtin sources merged with the user ones from `user_dir` (when given).
///
/// `user_dir` is returned in the catalog so the UI can tell the user where to drop a source file.
pub fn load(user_dir: Option<&Path>) -> HubSourceCatalog {
    let mut catalog = HubSourceCatalog {
        user_dir: user_dir
            .map(|dir| dir.to_string_lossy().to_string())
            .unwrap_or_default(),
        ..HubSourceCatalog::default()
    };

    for (origin_id, raw) in builtin::BUILTIN_HUB_SOURCES {
        match parse_source(raw, &format!("builtin:{origin_id}")) {
            Ok(mut source) => {
                source.builtin = true;
                push(&mut catalog, source);
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
                format!("cannot read the hub source directory: {error}"),
            ));
            finalize(&mut catalog);
            return catalog;
        }
    };
    files.sort();

    for file in files {
        let origin = file.to_string_lossy().to_string();
        let raw = match std::fs::read_to_string(&file) {
            Ok(raw) => raw,
            Err(error) => {
                catalog.problems.push(CatalogProblem::error(
                    origin.clone(),
                    format!("cannot read hub source: {error}"),
                ));
                continue;
            }
        };
        match parse_source(&raw, &origin) {
            Ok(mut source) => {
                source.builtin = false;
                source.source_file = Some(origin.clone());
                // A user source replaces the builtin one with the same id, so a collection that
                // moved or went stale can be corrected without a new release.
                catalog.sources.retain(|existing| existing.id != source.id);
                push(&mut catalog, source);
            }
            Err(problem) => catalog.problems.push(problem),
        }
    }

    finalize(&mut catalog);
    catalog
}

/// Parse and validate one source. Warnings are reported by [`push`]; errors are returned here.
pub fn parse_source(raw: &str, origin: &str) -> Result<HubSource, CatalogProblem> {
    let source: HubSource = toml_edit::de::from_str(raw)
        .map_err(|error| CatalogProblem::error(origin, format!("invalid hub source: {error}")))?;

    let problems = validate(&source);
    let errors: Vec<&String> = problems
        .iter()
        .filter(|(fatal, _)| *fatal)
        .map(|(_, message)| message)
        .collect();
    if !errors.is_empty() {
        let message = errors
            .iter()
            .map(|message| message.as_str())
            .collect::<Vec<_>>()
            .join("; ");
        return Err(CatalogProblem::error(origin, message).with_id(source.id.clone()));
    }
    Ok(source)
}

/// Problems of one source: `(fatal, message)`.
///
/// Everything a source declares becomes a request URL or an address, so the checks are about
/// making that impossible to abuse rather than about tidiness.
fn validate(source: &HubSource) -> Vec<(bool, String)> {
    let mut problems: Vec<(bool, String)> = Vec::new();

    if source.id.is_empty()
        || !source
            .id
            .chars()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-' || c == '_')
    {
        fatal(
            &mut problems,
            "id must be lowercase letters, digits, '-' or '_' (it is the first half of every \
             entry id)",
        );
    }
    if source.name.trim().is_empty() {
        fatal(&mut problems, "name is required");
    }
    if source.provides.is_empty() {
        fatal(
            &mut problems,
            "provides must name at least one kind of resource",
        );
    }

    match source.kind {
        HubSourceKind::McpRegistry => {
            check_url(source, "url", &mut problems);
            if !source.offers(HubResourceKind::Mcp) {
                fatal(
                    &mut problems,
                    "a mcpRegistry source installs MCP servers, so provides must include \"mcp\"",
                );
            }
            if source.offers(HubResourceKind::Skill) {
                fatal(
                    &mut problems,
                    "the MCP registry lists servers only; use a githubSkills source for skills",
                );
            }
            if source.repository.is_some() {
                warn(
                    &mut problems,
                    "'repository' is ignored by a mcpRegistry source",
                );
            }
        }
        HubSourceKind::GithubSkills => {
            match source.repository() {
                Some(repository) => {
                    if let Err(message) = check_repository(repository) {
                        fatal(&mut problems, message);
                    }
                }
                None => fatal(
                    &mut problems,
                    "a githubSkills source needs 'repository' (\"owner/repo\")",
                ),
            }
            if let Err(message) = check_ref(source.git_ref()) {
                fatal(&mut problems, message);
            }
            if !source.offers(HubResourceKind::Skill) {
                fatal(
                    &mut problems,
                    "a githubSkills source installs skills, so provides must include \"skill\"",
                );
            }
            if source.offers(HubResourceKind::Mcp) {
                fatal(
                    &mut problems,
                    "a repository of SKILL.md directories holds no MCP servers; declare an index \
                     source for those",
                );
            }
            if source.url.is_some() {
                warn(&mut problems, "'url' is ignored by a githubSkills source");
            }
            if let Some(path) = &source.path {
                if let Err(message) = check_relative(path) {
                    fatal(&mut problems, format!("path {message}"));
                }
            }
            for exclude in &source.exclude {
                if let Err(message) = check_relative(exclude) {
                    fatal(&mut problems, format!("exclude {message}"));
                }
            }
        }
        HubSourceKind::Index => {
            check_url(source, "url", &mut problems);
            if source.offers(HubResourceKind::Skill) && source.repository.is_some() {
                warn(
                    &mut problems,
                    "'repository' on an index source is ignored: each entry names its own",
                );
            }
        }
    }

    if source
        .url
        .as_deref()
        .is_some_and(|url| !url.trim().starts_with("http"))
    {
        warn(&mut problems, "only http(s) URLs can be fetched");
    }

    // Tags never become a request, so nothing here is fatal: the source stays usable and the
    // problem is what its author reads.
    check_tags(&mut problems, "tags", &source.tags);
    for rule in &source.tag_rules {
        if rule.prefix.trim().is_empty() {
            fatal(
                &mut problems,
                "a tag rule needs 'prefix' — the name this source calls the entries it tags",
            );
            continue;
        }
        check_tags(
            &mut problems,
            &format!("the rule for '{}'", rule.prefix.trim()),
            &rule.tags,
        );
        if rule.tags.is_empty() {
            warn(
                &mut problems,
                format!("the tag rule for '{}' declares no tags", rule.prefix.trim()),
            );
        }
    }

    problems
}

/// Tags are shown on a card and offered as filters, so a source is told about the ones that
/// cannot be used instead of having them quietly dropped.
fn check_tags(problems: &mut Vec<(bool, String)>, field: &str, tags: &[String]) {
    for tag in tags {
        let tag = tag.trim();
        if tag.is_empty() {
            warn(
                problems,
                format!("{field} holds an empty tag, which is ignored"),
            );
        } else if tag.chars().count() > MAX_TAG_LEN {
            warn(
                problems,
                format!(
                    "{field} holds '{tag}', longer than {MAX_TAG_LEN} characters, which is ignored"
                ),
            );
        }
    }
    if tags.len() > MAX_TAGS {
        warn(
            problems,
            format!(
                "{field} declares more than {MAX_TAGS} tags; only the first {MAX_TAGS} are kept"
            ),
        );
    }
}

fn fatal(problems: &mut Vec<(bool, String)>, message: impl Into<String>) {
    problems.push((true, message.into()));
}

fn warn(problems: &mut Vec<(bool, String)>, message: impl Into<String>) {
    problems.push((false, message.into()));
}

fn check_url(source: &HubSource, field: &str, problems: &mut Vec<(bool, String)>) {
    match source.url.as_deref().map(str::trim) {
        Some(url) if url.starts_with("https://") || url.starts_with("http://") => {}
        Some(url) => fatal(
            problems,
            format!("{field} must be an http(s) URL, got '{url}'"),
        ),
        None => fatal(
            problems,
            format!("{field} is required by a {} source", kind_name(source.kind)),
        ),
    }
}

fn kind_name(kind: HubSourceKind) -> &'static str {
    match kind {
        HubSourceKind::McpRegistry => "mcpRegistry",
        HubSourceKind::GithubSkills => "githubSkills",
        HubSourceKind::Index => "index",
    }
}

/// `owner/repo`, with both halves plain enough to be a URL path segment.
fn check_repository(repository: &str) -> Result<(), String> {
    if crate::domain::plain_repository(repository) {
        return Ok(());
    }
    Err(format!(
        "'{repository}' is not a plain repository (\"owner/repo\")"
    ))
}

/// A branch, tag or commit: it is pasted into a URL, so nothing that could redirect it.
fn check_ref(git_ref: &str) -> Result<(), String> {
    if crate::domain::plain_git_ref(git_ref) {
        return Ok(());
    }
    Err(format!(
        "gitRef '{git_ref}' is not a plain branch, tag or commit"
    ))
}

/// A repository-relative path: no root, no way up, no Windows drive.
fn check_relative(path: &str) -> Result<(), String> {
    if crate::domain::plain_relative_path(path) {
        return Ok(());
    }
    Err(format!(
        "'{path}' must be a plain relative '/'-separated path"
    ))
}

fn push(catalog: &mut HubSourceCatalog, source: HubSource) {
    for (fatal, message) in validate(&source) {
        if !fatal {
            catalog.problems.push(
                CatalogProblem::warning(
                    source
                        .source_file
                        .clone()
                        .unwrap_or_else(|| format!("builtin:{}", source.id)),
                    message,
                )
                .with_id(source.id.clone()),
            );
        }
    }
    catalog.sources.push(source);
}

fn finalize(catalog: &mut HubSourceCatalog) {
    catalog.sources.sort_by_key(|a| a.name.to_lowercase());
    catalog.problems.sort_by(|a, b| a.source.cmp(&b.source));
}

#[cfg(test)]
mod tests {
    use super::*;

    const REGISTRY: &str = r#"
id = "mcp-registry"
name = "MCP Registry"
kind = "mcpRegistry"
url = "https://registry.modelcontextprotocol.io"
provides = ["mcp"]
"#;

    const SKILLS: &str = r#"
id = "example-skills"
name = "Example Skills"
kind = "githubSkills"
repository = "owner/repo"
path = "skills"
exclude = ["template"]
provides = ["skill"]
"#;

    #[test]
    fn every_builtin_source_parses() {
        assert!(builtin_count() > 0, "the hub ships with sources");
        for (id, raw) in builtin::BUILTIN_HUB_SOURCES {
            let source = parse_source(raw, id)
                .unwrap_or_else(|problem| panic!("builtin:{id}: {}", problem.message));
            assert_eq!(&source.id, id, "a source file is named after its id");
        }
    }

    #[test]
    fn parses_a_registry_and_a_skills_source() {
        let registry = parse_source(REGISTRY, "test").unwrap();
        assert_eq!(registry.kind, HubSourceKind::McpRegistry);
        assert!(registry.offers(HubResourceKind::Mcp));

        let skills = parse_source(SKILLS, "test").unwrap();
        assert_eq!(skills.kind, HubSourceKind::GithubSkills);
        assert_eq!(skills.repository(), Some("owner/repo"));
        assert!(skills.offers(HubResourceKind::Skill));
    }

    #[test]
    fn rejects_sources_that_would_build_a_broken_request() {
        // A repository that is not `owner/repo` cannot become a tarball URL.
        for repository in ["owner", "owner/repo/extra", "own er/repo", "../etc/passwd"] {
            let raw = SKILLS.replace("owner/repo", repository);
            let problem = parse_source(&raw, "test").unwrap_err();
            assert!(
                problem.message.contains("repository"),
                "accepted '{repository}': {}",
                problem.message
            );
        }
        // A ref with a query or a traversal cannot be pasted into a URL either.
        for git_ref in ["../main", "main?x=1", "main ref"] {
            let raw = format!("{SKILLS}\ngitRef = \"{git_ref}\"\n");
            assert!(parse_source(&raw, "test").is_err(), "accepted '{git_ref}'");
        }
        // An entry-relative path that steps up is refused. (A backslash has to be written as
        // `\\` inside a TOML basic string, which is why the fixture doubles it.)
        for path in ["/etc", "a/../../b", "a\\\\b"] {
            let raw = SKILLS.replace("path = \"skills\"", &format!("path = \"{path}\""));
            assert!(parse_source(&raw, "test").is_err(), "accepted '{path}'");
        }
    }

    #[test]
    fn rejects_ids_that_cannot_address_an_entry() {
        for id in ["", "Upper", "with space", "with/slash"] {
            let raw = REGISTRY.replace("\"mcp-registry\"", &format!("\"{id}\""));
            assert!(parse_source(&raw, "test").is_err(), "accepted id '{id}'");
        }
    }

    #[test]
    fn rejects_a_source_that_offers_nothing_or_the_wrong_kind() {
        let nothing = REGISTRY.replace("provides = [\"mcp\"]", "provides = []");
        assert!(parse_source(&nothing, "test").is_err());

        let mismatch = REGISTRY.replace("provides = [\"mcp\"]", "provides = [\"skill\", \"mcp\"]");
        assert!(parse_source(&mismatch, "test").is_err());

        let missing_url =
            REGISTRY.replace("url = \"https://registry.modelcontextprotocol.io\"", "");
        assert!(parse_source(&missing_url, "test").is_err());
    }

    #[test]
    fn refuses_a_source_that_cannot_be_fetched_from() {
        let raw = REGISTRY.replace(
            "https://registry.modelcontextprotocol.io",
            "ftp://example.com",
        );
        let problem = parse_source(&raw, "test").unwrap_err();
        assert!(problem.message.contains("http"), "{}", problem.message);
    }

    #[test]
    fn a_user_source_replaces_a_builtin_one_and_a_broken_one_is_reported() {
        let dir = tempfile::tempdir().unwrap();
        let builtin_id = builtin_ids()[0];
        std::fs::write(
            dir.path().join("override.toml"),
            REGISTRY.replace("mcp-registry", builtin_id),
        )
        .unwrap();
        std::fs::write(dir.path().join("broken.toml"), "id = ").unwrap();

        let catalog = load(Some(dir.path()));
        assert_eq!(
            catalog
                .sources
                .iter()
                .filter(|s| s.id == builtin_id)
                .count(),
            1
        );
        // Exactly one per id, and the override is the user's file.
        let overridden = catalog.sources.iter().find(|s| s.id == builtin_id).unwrap();
        assert!(overridden
            .source_file
            .as_deref()
            .is_some_and(|path| path.ends_with("override.toml")));
        assert!(!overridden.builtin);
        assert_eq!(catalog.sources.len(), builtin_count());
        assert!(catalog
            .problems
            .iter()
            .any(|problem| problem.source.ends_with("broken.toml")));
        assert_eq!(catalog.user_dir, dir.path().to_string_lossy());
    }

    #[test]
    fn tag_rules_are_checked_and_an_unusable_one_is_reported() {
        let dir = tempfile::tempdir().unwrap();

        // A rule says what it is about: without a prefix there is nothing to match.
        let missing = format!("{SKILLS}\n[[tag_rules]]\ntags = [\"design\"]\n");
        assert!(parse_source(&missing, "test").is_err());
        let blank = format!("{SKILLS}\n[[tag_rules]]\nprefix = \"  \"\ntags = [\"design\"]\n");
        let problem = parse_source(&blank, "test").unwrap_err();
        assert!(problem.message.contains("prefix"), "{}", problem.message);

        // Tags that cannot be used are reported, and the source still loads.
        std::fs::write(
            dir.path().join("tagged.toml"),
            format!(
                "{SKILLS}\ntags = [\"design\", \"\"]\n\n[[tag_rules]]\nprefix = \"skills/pdf\"\ntags = [\"documents\"]\n"
            ),
        )
        .unwrap();
        let catalog = load(Some(dir.path()));
        let source = catalog
            .sources
            .iter()
            .find(|source| source.id == "example-skills")
            .expect("the tagged source loaded");
        assert_eq!(source.declared_tags("skills/pdf"), ["design", "documents"]);
        assert!(
            catalog
                .problems
                .iter()
                .any(|problem| problem.message.contains("empty tag")),
            "{:#?}",
            catalog.problems
        );

        // A rule with no tags is a warning too, never a refusal.
        std::fs::write(
            dir.path().join("toothless.toml"),
            format!("{SKILLS}\n[[tag_rules]]\nprefix = \"skills/pdf\"\n"),
        )
        .unwrap();
        let catalog = load(Some(dir.path()));
        assert!(catalog
            .problems
            .iter()
            .any(|problem| problem.message.contains("declares no tags")));
    }
}
