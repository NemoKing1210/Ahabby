//! The Hub service: fetching, caching and resolving what the hub sources publish.
//!
//! The design goal is that browsing a library of thousands of entries costs one request per
//! source, and installing one entry costs nothing extra:
//!
//! * the **MCP registry** is searched and paged by the registry itself (one request per page);
//! * a **GitHub collection** is one tarball per repository, parsed once into a snapshot of skills
//!   that every page, detail and install of that source is served from;
//! * a published **index document** is one request, with an entry's own repository fetched only
//!   when that entry is opened or installed.
//!
//! Everything is cached in memory with a short TTL, and every limit is explicit: a source is
//! third-party input, so nothing it publishes may make Ahabby read an unbounded number of bytes.
//!
//! Failures are per source: [`HubService::search`] answers with the entries it got *and* a report
//! that says who failed and why, so one unreachable collection never empties the screen.

pub mod installed;
mod parse;
mod repo_cache;

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock};
use std::time::{Duration, Instant};

use tracing::warn;

use crate::catalog::hub as catalog_hub;
use crate::domain::skill::{SkillInstall, SkillInstallFile};
use crate::domain::{
    normalize_tags, tags_match, HubEntry, HubEntryDetail, HubFileInfo, HubInput, HubPage,
    HubPreview, HubQuery, HubResourceKind, HubSource, HubSourceCatalog, HubSourceKind,
    HubSourceReport, McpTransport, Proxy,
};
use crate::error::{AppError, Result};
use crate::platform::now_ms;

use super::http;
use parse::{IndexItem, RegistryItem, RepoFacts, RepoSkill, TarFile};
use repo_cache::{resolve_repo_facts, RepoCache};

/// Repository payloads kept in memory before the oldest one is dropped.
const CACHE_BUDGET_BYTES: u64 = 96 * 1024 * 1024;
/// How long a fetched page, document or repository is reused.
const CACHE_TTL_MS: i64 = 10 * 60 * 1000;
/// A source that does not answer within this is reported as unreachable.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
/// How many hops a source may take (a repository download goes through a redirect).
const MAX_REDIRECTS: usize = 10;
/// Largest body Ahabby will read from one source (a repository tarball is the big one).
const MAX_DOWNLOAD_BYTES: u64 = parse::MAX_ARCHIVE_BYTES;

/// Where GitHub serves the tarball of a repository at a ref.
const CODELOAD: &str = "https://codeload.github.com";

/// Where GitHub answers about a repository — the star count the Hub shows next to a collection.
const GITHUB_API: &str = "https://api.github.com";

/// The Hub: where its sources are, and what they answered.
pub struct HubService {
    client: RwLock<reqwest::Client>,
    cache: Mutex<Cache>,
    repos: Mutex<RepoCache>,
}

impl HubService {
    /// `proxy` decides how requests leave the machine, exactly as it does for version checks.
    ///
    /// `app_data` holds the on-disk repository cache (`cache/hub-repos.json`), so a rate-limited
    /// or offline open still keeps the last known popularity order and avatars.
    pub fn new(proxy: &Proxy, app_data: &Path) -> Self {
        Self {
            client: RwLock::new(http::client(proxy, REQUEST_TIMEOUT, MAX_REDIRECTS)),
            cache: Mutex::new(Cache::default()),
            repos: Mutex::new(RepoCache::load(app_data)),
        }
    }

    /// Settings changed: the cache is still valid, the connection is not.
    pub fn set_proxy(&self, proxy: &Proxy) {
        match self.client.write() {
            Ok(mut client) => *client = http::client(proxy, REQUEST_TIMEOUT, MAX_REDIRECTS),
            Err(error) => warn!("could not rebuild the hub client: {error}"),
        }
    }

    /// The hub's sources: the builtin ones plus the user's own from `user_dir`.
    pub fn sources(&self, user_dir: &Path) -> HubSourceCatalog {
        catalog_hub::load(Some(user_dir))
    }

    /// The hub's sources for the screen: every source with what GitHub says about its repository
    /// — the star count and the owner's avatar — ordered by popularity.
    ///
    /// Both are third-party trivia read over the network, so a failed refresh is not fatal: what
    /// was read before (memory, then the on-disk cache) stays on the source and the popularity
    /// order is kept. A source that is not on GitHub, or whose repository was never read, simply
    /// carries neither. Any other command keeps using [`HubService::sources`]: resolving an entry
    /// needs neither, and no request.
    pub async fn sources_for_screen(&self, user_dir: &Path) -> HubSourceCatalog {
        let mut catalog = catalog_hub::load(Some(user_dir));
        self.annotate_repositories(&mut catalog.sources).await;
        sort_by_popularity(&mut catalog.sources);
        catalog
    }

    /// Fill in what GitHub knows about every source's repository, one request per distinct one.
    ///
    /// Fresh answers are served from the cache without a network round trip. Stale or missing ones
    /// are asked for together — several collections, one after another, would otherwise be several
    /// round trips of latency on a cold cache — and a failed ask keeps the last known values, so
    /// neither the sort nor the avatars collapse.
    async fn annotate_repositories(&self, sources: &mut [HubSource]) {
        let mut repositories: Vec<String> = Vec::new();
        for source in sources.iter() {
            if source.kind != HubSourceKind::GithubSkills {
                continue;
            }
            if let Some(repository) = source.repository() {
                if !repositories.iter().any(|kept| kept == repository) {
                    repositories.push(repository.to_string());
                }
            }
        }
        if repositories.is_empty() {
            return;
        }

        let answers = futures::future::join_all(
            repositories
                .iter()
                .map(|repository| self.repo_facts(repository)),
        )
        .await;
        let facts: HashMap<&str, RepoFacts> = repositories
            .iter()
            .map(String::as_str)
            .zip(answers)
            .collect();

        for source in sources.iter_mut() {
            if source.kind != HubSourceKind::GithubSkills {
                continue;
            }
            if let Some(repository) = source.repository() {
                let facts = facts.get(repository).cloned().unwrap_or_default();
                source.stars = facts.stars;
                source.avatar = facts.avatar;
            }
        }
    }

    /// One repository's facts: fresh cache → GitHub → last known (stale) cache.
    ///
    /// Empty only when nothing has ever been read for this repository — a rate limit or an offline
    /// machine must not erase a count that already ordered the Hub once, nor the picture that came
    /// with it.
    async fn repo_facts(&self, repository: &str) -> RepoFacts {
        let fresh = {
            let repos = self.repos.lock().unwrap_or_else(PoisonError::into_inner);
            repos.get_fresh(repository)
        };
        if let Some(facts) = fresh {
            return facts;
        }

        let stale = {
            let repos = self.repos.lock().unwrap_or_else(PoisonError::into_inner);
            repos.get_any(repository)
        };

        let answer = self.fetch_repo_facts(repository).await;
        let fetched = (!answer.is_empty()).then_some(answer);
        if let Some(facts) = &fetched {
            let mut repos = self.repos.lock().unwrap_or_else(PoisonError::into_inner);
            repos.put(repository, facts);
        }

        resolve_repo_facts(None, fetched, stale)
    }

    /// Ask GitHub about one repository. A failure is an empty answer, never an error.
    async fn fetch_repo_facts(&self, repository: &str) -> RepoFacts {
        let url = format!("{GITHUB_API}/repos/{repository}");
        match self.get_json(&url).await {
            Ok(body) => parse::repo_facts(&body),
            Err(_) => RepoFacts::default(),
        }
    }

    /// One page of one source.
    pub async fn search(
        &self,
        catalog: &HubSourceCatalog,
        source_id: &str,
        query: &HubQuery,
    ) -> Result<HubPage> {
        let source = catalog
            .sources
            .iter()
            .find(|source| source.id == source_id)
            .ok_or_else(|| AppError::NotFound(format!("hub source '{source_id}'")))?;
        if let Some(kind) = query.kind {
            if !source.offers(kind) {
                return Err(AppError::InvalidInput(format!(
                    "'{}' does not offer {}s",
                    source.name,
                    kind.label()
                )));
            }
        }

        let started = Instant::now();
        let outcome = self.page(source, query).await;
        let duration_ms = started.elapsed().as_millis() as u64;

        let (entries, from_cache, next_cursor, total, problems, error) = match outcome {
            Ok(page) => (
                page.entries,
                page.from_cache,
                page.next_cursor,
                page.total,
                page.problems,
                None,
            ),
            Err(failure) => (
                Vec::new(),
                false,
                None,
                None,
                Vec::new(),
                Some(failure.to_string()),
            ),
        };

        let report = HubSourceReport {
            id: source.id.clone(),
            name: source.name.clone(),
            kind: source.kind,
            provides: source.provides.clone(),
            description: source.description.clone(),
            homepage: source.homepage.clone(),
            builtin: source.builtin,
            count: entries.len() as u32,
            total,
            next_cursor,
            duration_ms,
            from_cache,
            error,
            problems,
        };
        Ok(HubPage {
            entries,
            report,
            fetched_at_ms: now_ms(),
        })
    }

    /// One entry, with everything the install dialog shows.
    pub async fn detail(
        &self,
        catalog: &HubSourceCatalog,
        entry_id: &str,
        refresh: bool,
    ) -> Result<HubEntryDetail> {
        let prepared = self.prepare(catalog, entry_id, refresh).await?;
        Ok(HubEntryDetail {
            entry: prepared.entry,
            files: prepared.files,
            preview: prepared.preview,
            transport: prepared.transport,
            inputs: prepared.inputs,
            source_url: prepared.source_url,
        })
    }

    /// Resolve an entry down to what installing it needs.
    pub async fn prepare(
        &self,
        catalog: &HubSourceCatalog,
        entry_id: &str,
        refresh: bool,
    ) -> Result<Prepared> {
        let (source, local) = split_entry_id(catalog, entry_id)?;
        match source.kind {
            HubSourceKind::McpRegistry => {
                let item = self.registry_item(source, local, refresh).await?;
                Ok(Prepared {
                    entry: with_identity(item.entry, item.transport.as_ref()),
                    files: Vec::new(),
                    preview: None,
                    transport: item.transport,
                    inputs: item.inputs,
                    source_url: item.source_url,
                })
            }
            HubSourceKind::GithubSkills => {
                let repository = require_repository(source)?;
                let (snapshot, _) = self
                    .snapshot(source, repository, source.git_ref(), refresh)
                    .await?;
                let skill = snapshot
                    .skills
                    .iter()
                    .find(|skill| skill.dir == local)
                    .ok_or_else(|| {
                        AppError::NotFound(format!("'{local}' is no longer in {repository}"))
                    })?;
                Ok(skill_entry(
                    source,
                    skill,
                    &snapshot.files,
                    source
                        .repository()
                        .map(|repository| (repository, source.git_ref())),
                ))
            }
            HubSourceKind::Index => {
                let items = self.index(source, refresh).await?;
                let item = items
                    .iter()
                    .find(|item| item.entry.id == entry_id)
                    .ok_or_else(|| {
                        AppError::NotFound(format!("'{entry_id}' is no longer in this index"))
                    })?
                    .clone();
                match &item.skill {
                    Some(skill) => {
                        let (snapshot, _) = self
                            .snapshot(
                                &index_filter(source, skill),
                                &skill.repository,
                                &skill.git_ref,
                                refresh,
                            )
                            .await?;
                        let found = snapshot
                            .skills
                            .iter()
                            .find(|found| found.dir == skill.path)
                            .ok_or_else(|| {
                                AppError::NotFound(format!(
                                    "'{}' is no longer at {} in {}",
                                    item.entry.name, skill.path, skill.repository
                                ))
                            })?;
                        Ok(skill_entry(
                            source,
                            found,
                            &snapshot.files,
                            Some((skill.repository.as_str(), skill.git_ref.as_str())),
                        ))
                    }
                    None => Ok(Prepared {
                        source_url: item
                            .entry
                            .homepage
                            .clone()
                            .or_else(|| item.entry.repository.clone()),
                        entry: with_identity(item.entry, item.transport.as_ref()),
                        files: Vec::new(),
                        preview: None,
                        transport: item.transport,
                        inputs: item.inputs,
                    }),
                }
            }
        }
    }

    /// The files of a skill entry, ready to be written by an adapter.
    ///
    /// `name` is the entry's own name (the frontend read it from [`HubService::detail`]); the
    /// payload carries no name of its own beyond the `SKILL.md` the agent will read.
    pub async fn skill_install(
        &self,
        catalog: &HubSourceCatalog,
        entry_id: &str,
        name: String,
    ) -> Result<SkillInstall> {
        let (source, local) = split_entry_id(catalog, entry_id)?;
        let (files, directory): (Arc<Vec<TarFile>>, String) = match source.kind {
            HubSourceKind::McpRegistry => {
                return Err(AppError::NotSupported(
                    "this hub entry is an MCP server, not a skill".to_string(),
                ))
            }
            HubSourceKind::GithubSkills => {
                let repository = require_repository(source)?;
                let (snapshot, _) = self
                    .snapshot(source, repository, source.git_ref(), false)
                    .await?;
                (Arc::clone(&snapshot.files), local.to_string())
            }
            HubSourceKind::Index => {
                let items = self.index(source, false).await?;
                let skill = items
                    .iter()
                    .find(|item| item.entry.id == entry_id)
                    .and_then(|item| item.skill.clone())
                    .ok_or_else(|| {
                        AppError::NotSupported(
                            "this hub entry is an MCP server, not a skill".to_string(),
                        )
                    })?;
                let (snapshot, _) = self
                    .snapshot(
                        &index_filter(source, &skill),
                        &skill.repository,
                        &skill.git_ref,
                        false,
                    )
                    .await?;
                (Arc::clone(&snapshot.files), skill.path)
            }
        };

        let files: Vec<SkillInstallFile> = files
            .iter()
            .filter(|file| is_inside(&file.path, &directory))
            .map(|file| SkillInstallFile {
                path: parse::relative_to(&file.path, &directory),
                bytes: file.bytes.clone(),
            })
            .collect();
        if files.is_empty() {
            return Err(AppError::NotFound(format!(
                "the files of '{entry_id}' are no longer published"
            )));
        }
        Ok(SkillInstall { name, files })
    }

    // ---------------------------------------------------------------------------------------
    // One page per source kind
    // ---------------------------------------------------------------------------------------

    async fn page(&self, source: &HubSource, query: &HubQuery) -> Result<Page> {
        match source.kind {
            HubSourceKind::McpRegistry => self.registry_page(source, query).await,
            HubSourceKind::GithubSkills => self.github_page(source, query).await,
            HubSourceKind::Index => self.index_page(source, query).await,
        }
    }

    async fn registry_page(&self, source: &HubSource, query: &HubQuery) -> Result<Page> {
        // A registry record carries no tags of its own, only what its source declares for it, so a
        // filter its vocabulary cannot answer is answered here — without asking the registry and
        // making the screen wait for a page that would come back empty anyway.
        if !tags_match(&source.tag_vocabulary(), &query.tags) {
            return Ok(Page {
                entries: Vec::new(),
                next_cursor: None,
                total: None,
                problems: Vec::new(),
                from_cache: false,
            });
        }

        let base = source_url(source)?;
        let limit = query.page_size();
        let key = format!(
            "{}|{}|{}|{limit}",
            source.id,
            query.query,
            query.cursor.as_deref().unwrap_or_default()
        );

        if !query.refresh {
            if let Some(cached) = self.cached_page(&key) {
                // `from_cache` describes *this* answer, and the stored page carries the `false` it
                // was written with — the flag belongs to the reply, not to the record, which is why
                // it is set here rather than stored. Without this a page served from memory claims
                // it was just fetched, and the screen reports a fetch duration the user never paid.
                return Ok(Page {
                    from_cache: true,
                    ..tagged(cached, &query.tags)
                });
            }
        }

        let url = registry_url(&base, &query.query, query.cursor.as_deref(), limit)?;
        let body = self.get_json(&url).await?;
        let (items, next_cursor) = parse::mcp_registry(&body, source)?;

        let entries: Vec<HubEntry> = items
            .iter()
            .map(|item| with_identity(item.entry.clone(), item.transport.as_ref()))
            .collect();
        let page = Page {
            entries: entries.clone(),
            next_cursor,
            total: None,
            problems: Vec::new(),
            from_cache: false,
        };

        let mut cache = self.cache();
        for item in items {
            cache
                .records
                .insert(item.entry.id.clone(), Cached::new(item));
        }
        // The page is cached *as the registry answered it*: a tag filter is applied to a copy, so
        // two queries with different tags share one request.
        cache.pages.insert(key, Cached::new(page.clone()));
        Ok(tagged(page, &query.tags))
    }

    async fn github_page(&self, source: &HubSource, query: &HubQuery) -> Result<Page> {
        let repository = require_repository(source)?;
        let (snapshot, from_cache) = self
            .snapshot(source, repository, source.git_ref(), query.refresh)
            .await?;
        let mut matching: Vec<&RepoSkill> = snapshot
            .skills
            .iter()
            .filter(|skill| skill_matches(skill, source, query))
            .collect();
        matching.sort_by(|a, b| compare_skills(a, b));
        let mut page = page_of(
            source,
            &snapshot.files,
            &matching,
            query,
            source
                .repository()
                .map(|repository| (repository, source.git_ref())),
        );
        if snapshot.truncated {
            page.problems.push(
                "this collection is larger than Ahabby reads at once, so it is incomplete"
                    .to_string(),
            );
        }
        page.from_cache = from_cache;
        Ok(page)
    }

    async fn index_page(&self, source: &HubSource, query: &HubQuery) -> Result<Page> {
        let (items, problems, from_cache) = self.index_with_state(source, query.refresh).await?;
        let mut matching: Vec<&IndexItem> = items
            .iter()
            .filter(|item| {
                query.kind.is_none_or(|kind| item.entry.kind == kind)
                    && tags_match(&item.entry.tags, &query.tags)
                    && matches_entry(&item.entry, &query.query)
            })
            .collect();
        matching.sort_by(|a, b| {
            a.entry
                .name
                .to_lowercase()
                .cmp(&b.entry.name.to_lowercase())
        });

        let total = matching.len();
        let offset = cursor_offset(query.cursor.as_deref(), total);
        let limit = query.page_size() as usize;
        let end = (offset + limit).min(total);
        let entries: Vec<HubEntry> = matching[offset..end]
            .iter()
            .map(|item| with_identity(item.entry.clone(), item.transport.as_ref()))
            .collect();
        Ok(Page {
            entries,
            next_cursor: (end < total).then(|| end.to_string()),
            total: Some(total as u32),
            problems,
            from_cache,
        })
    }

    // ---------------------------------------------------------------------------------------
    // Source-specific caches
    // ---------------------------------------------------------------------------------------

    /// One registry record, from the cache while it is fresh — else asked for by name.
    ///
    /// The registry is the one source whose list is expensive to page through, so a record is
    /// kept as soon as a page is read; the fallback (a search for the exact name) is what makes a
    /// detail view work after a restart or a cache expiry.
    async fn registry_item(
        &self,
        source: &HubSource,
        local: &str,
        refresh: bool,
    ) -> Result<RegistryItem> {
        let key = format!("{}/{}", source.id, local);
        if !refresh {
            if let Some(cached) = self.cached_record(&key) {
                return Ok(cached);
            }
        }
        let base = source_url(source)?;
        let url = registry_url(&base, local, None, 50)?;
        let body = self.get_json(&url).await?;
        let (items, _) = parse::mcp_registry(&body, source)?;
        let mut found = None;
        for item in items {
            if item.entry.id == key {
                found = Some(item.clone());
            }
            self.cache()
                .records
                .insert(item.entry.id.clone(), Cached::new(item));
        }
        found.ok_or_else(|| AppError::NotFound(format!("the registry does not know '{local}'")))
    }

    /// A repository's files and the skills in them, parsed once per (repository, filter).
    async fn snapshot(
        &self,
        source: &HubSource,
        repository: &str,
        git_ref: &str,
        refresh: bool,
    ) -> Result<(Arc<Snapshot>, bool)> {
        let key = snapshot_key(source, repository, git_ref);
        if !refresh {
            if let Some(cached) = self.cached_snapshot(&key) {
                return Ok((cached, true));
            }
        }
        let (files, truncated) = self.repository(repository, git_ref, refresh).await?;
        let snapshot = Arc::new(Snapshot {
            skills: Arc::new(parse::repo_skills(&files, source)),
            files,
            truncated,
        });
        self.cache()
            .snapshots
            .insert(key, Cached::new(snapshot.clone()));
        Ok((snapshot, false))
    }

    /// The parsed files of a repository, downloaded at most once per ref.
    async fn repository(
        &self,
        repository: &str,
        git_ref: &str,
        refresh: bool,
    ) -> Result<(Arc<Vec<TarFile>>, bool)> {
        let key = format!("{repository}@{git_ref}");
        if !refresh {
            if let Some(cached) = self.cached_repository(&key) {
                return Ok((cached.files, cached.truncated));
            }
        }
        let url = tarball_url(repository, git_ref)?;
        let bytes = self.get_bytes(&url).await?;
        let (files, truncated) = parse::read_tarball(&bytes)?;
        if truncated {
            warn!("{key} exceeds a hub limit and was read only in part");
        }
        let files = Arc::new(files);
        let weight = files
            .iter()
            .map(|file| file.bytes.len() as u64)
            .sum::<u64>();
        let mut cache = self.cache();
        cache.repositories.insert(
            key.clone(),
            Cached {
                at_ms: now_ms(),
                value: Repository {
                    files: Arc::clone(&files),
                    truncated,
                },
            },
        );
        cache.weights.insert(key.clone(), weight);
        cache.evict(&key);
        Ok((files, truncated))
    }

    /// A published index document, read once and reused, with its own notes.
    async fn index_with_state(
        &self,
        source: &HubSource,
        refresh: bool,
    ) -> Result<(Arc<Vec<IndexItem>>, Vec<String>, bool)> {
        if !refresh {
            if let Some(cached) = self.cached_index(&source.id) {
                return Ok((Arc::clone(&cached.items), cached.problems.clone(), true));
            }
        }
        let url = source_url(source)?;
        let body = self.get_json(&url).await?;
        let (items, problems) = parse::index_entries(&body, source)?;
        let document = Arc::new(IndexDocument {
            items: Arc::new(items),
            problems,
        });
        self.cache()
            .indexes
            .insert(source.id.clone(), Cached::new(document.clone()));
        Ok((
            Arc::clone(&document.items),
            document.problems.clone(),
            false,
        ))
    }

    async fn index(&self, source: &HubSource, refresh: bool) -> Result<Arc<Vec<IndexItem>>> {
        Ok(self.index_with_state(source, refresh).await?.0)
    }

    // ---------------------------------------------------------------------------------------
    // Cache access
    // ---------------------------------------------------------------------------------------

    fn cached_page(&self, key: &str) -> Option<Page> {
        let cache = self.cache();
        let cached = cache.pages.get(key)?;
        fresh(cached.at_ms).then(|| cached.value.clone())
    }

    fn cached_record(&self, key: &str) -> Option<RegistryItem> {
        let cache = self.cache();
        let cached = cache.records.get(key)?;
        fresh(cached.at_ms).then(|| cached.value.clone())
    }

    fn cached_snapshot(&self, key: &str) -> Option<Arc<Snapshot>> {
        let cache = self.cache();
        let cached = cache.snapshots.get(key)?;
        fresh(cached.at_ms).then(|| Arc::clone(&cached.value))
    }

    fn cached_repository(&self, key: &str) -> Option<Repository> {
        let cache = self.cache();
        let cached = cache.repositories.get(key)?;
        fresh(cached.at_ms).then(|| cached.value.clone())
    }

    fn cached_index(&self, key: &str) -> Option<Arc<IndexDocument>> {
        let cache = self.cache();
        let cached = cache.indexes.get(key)?;
        fresh(cached.at_ms).then(|| Arc::clone(&cached.value))
    }

    fn cache(&self) -> MutexGuard<'_, Cache> {
        self.cache.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn http(&self) -> reqwest::Client {
        match self.client.read() {
            Ok(client) => client.clone(),
            Err(_) => http::client(&Proxy::none(), REQUEST_TIMEOUT, MAX_REDIRECTS),
        }
    }

    // ---------------------------------------------------------------------------------------
    // Network
    // ---------------------------------------------------------------------------------------

    async fn get_bytes(&self, url: &str) -> Result<Vec<u8>> {
        let mut response = self
            .http()
            .get(url)
            .timeout(REQUEST_TIMEOUT)
            .send()
            .await
            .map_err(|error| http::network_error(url, &error, REQUEST_TIMEOUT))?;
        let status = response.status();
        if !status.is_success() {
            return Err(AppError::Network(format!("{url} answered {status}")));
        }

        // Read with a ceiling instead of `bytes()`: a source is third-party input, and the length
        // it announces is not something to trust with this process's memory.
        let mut body: Vec<u8> = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|error| http::network_error(url, &error, REQUEST_TIMEOUT))?
        {
            if body.len() as u64 + chunk.len() as u64 > MAX_DOWNLOAD_BYTES {
                return Err(AppError::Network(format!(
                    "{url} is larger than the {} MiB a hub source may deliver",
                    MAX_DOWNLOAD_BYTES / (1024 * 1024)
                )));
            }
            body.extend_from_slice(&chunk);
        }
        Ok(body)
    }

    async fn get_json(&self, url: &str) -> Result<serde_json::Value> {
        let body = self.get_bytes(url).await?;
        serde_json::from_slice(&body)
            .map_err(|error| AppError::other(format!("{url} did not answer JSON: {error}")))
    }
}

/// An entry with the comparison key of its payload, set where the payload is known.
///
/// A skill's key is its entry file and is set where the file is (`skill_entry`); a server has no
/// file at all, so its key is the recipe the source declared — the only thing that makes two
/// entries with different names the same server.
fn with_identity(mut entry: HubEntry, transport: Option<&McpTransport>) -> HubEntry {
    if entry.kind == HubResourceKind::Mcp {
        entry.identity = transport.and_then(installed::server_identity);
    }
    entry
}

/// One page of one source.
#[derive(Debug, Clone)]
struct Page {
    entries: Vec<HubEntry>,
    next_cursor: Option<String>,
    total: Option<u32>,
    problems: Vec<String>,
    from_cache: bool,
}

/// An entry resolved to what installing it needs.
#[derive(Debug)]
pub struct Prepared {
    pub entry: HubEntry,
    /// Files the install writes (skills only), as the install dialog shows them.
    pub files: Vec<HubFileInfo>,
    /// The skill's own `SKILL.md`, for reading before installing.
    pub preview: Option<HubPreview>,
    pub transport: Option<McpTransport>,
    pub inputs: Vec<HubInput>,
    pub source_url: Option<String>,
}

/// A repository's payload and the skills in it.
struct Snapshot {
    files: Arc<Vec<TarFile>>,
    skills: Arc<Vec<RepoSkill>>,
    truncated: bool,
}

#[derive(Clone)]
struct Repository {
    files: Arc<Vec<TarFile>>,
    truncated: bool,
}

struct IndexDocument {
    items: Arc<Vec<IndexItem>>,
    problems: Vec<String>,
}

#[derive(Clone)]
struct Cached<T> {
    at_ms: i64,
    value: T,
}

impl<T> Cached<T> {
    fn new(value: T) -> Self {
        Self {
            at_ms: now_ms(),
            value,
        }
    }
}

#[derive(Default)]
struct Cache {
    /// One page of the MCP registry, keyed by source, search, cursor and limit.
    pages: HashMap<String, Cached<Page>>,
    /// Registry records by entry id, so a detail view needs no second request.
    records: HashMap<String, Cached<RegistryItem>>,
    /// Parsed repositories (`owner/repo@ref`).
    repositories: HashMap<String, Cached<Repository>>,
    /// Bytes each repository holds, for the budget.
    weights: HashMap<String, u64>,
    /// Repository skills, parsed per (repository, source filter).
    snapshots: HashMap<String, Cached<Arc<Snapshot>>>,
    /// Index documents by source id.
    indexes: HashMap<String, Cached<Arc<IndexDocument>>>,
}

impl Cache {
    /// Drop the oldest repositories until the budget is met again, snapshots included: a snapshot
    /// is only a view of a repository, so it must never outlive its bytes.
    fn evict(&mut self, just_added: &str) {
        while self.weights.values().sum::<u64>() > CACHE_BUDGET_BYTES {
            let oldest = self
                .weights
                .keys()
                .filter(|key| key.as_str() != just_added)
                .min_by_key(|key| match self.repositories.get(*key) {
                    Some(cached) => cached.at_ms,
                    None => 0,
                })
                .cloned();
            let Some(oldest) = oldest else { return };
            self.repositories.remove(&oldest);
            self.weights.remove(&oldest);
            let prefix = format!("{oldest}|");
            self.snapshots.retain(|key, _| !key.starts_with(&prefix));
        }
    }
}

fn fresh(at_ms: i64) -> bool {
    now_ms() - at_ms < CACHE_TTL_MS
}

/// Order sources for the screen: the GitHub collections by stars (most first), then the rest by
/// name.
///
/// A GitHub source whose count was never known carries none and so keeps the name-ordered place
/// of the second group. Once a count has been cached, a failed refresh must not drop it — that is
/// what [`repo_cache::resolve_repo_facts`] enforces before this runs.
fn sort_by_popularity(sources: &mut [HubSource]) {
    sources.sort_by(|a, b| match (a.stars, b.stars) {
        (Some(a_stars), Some(b_stars)) => b_stars.cmp(&a_stars).then_with(|| by_name(a, b)),
        (Some(_), None) => std::cmp::Ordering::Less,
        (None, Some(_)) => std::cmp::Ordering::Greater,
        (None, None) => by_name(a, b),
    });
}

fn by_name(a: &HubSource, b: &HubSource) -> std::cmp::Ordering {
    a.name.to_lowercase().cmp(&b.name.to_lowercase())
}

/// `entry id` → `(source, what the source calls it)`.
///
/// The local half may contain `/` (a registry name is `com.example/server`), which is why the
/// split is at the *first* one: a source id can never contain it.
fn split_entry_id<'a>(
    catalog: &'a HubSourceCatalog,
    entry_id: &'a str,
) -> Result<(&'a HubSource, &'a str)> {
    let (source_id, local) = entry_id
        .split_once('/')
        .ok_or_else(|| AppError::InvalidInput(format!("'{entry_id}' is not a hub entry id")))?;
    if local.trim().is_empty() {
        return Err(AppError::InvalidInput(format!(
            "'{entry_id}' names no entry"
        )));
    }
    let source = catalog
        .sources
        .iter()
        .find(|source| source.id == source_id)
        .ok_or_else(|| AppError::NotFound(format!("hub source '{source_id}'")))?;
    Ok((source, local))
}

fn require_repository(source: &HubSource) -> Result<&str> {
    source
        .repository()
        .ok_or_else(|| AppError::InvalidInput(format!("'{}' declares no repository", source.name)))
}

fn source_url(source: &HubSource) -> Result<String> {
    source
        .url
        .as_deref()
        .map(|url| url.trim().trim_end_matches('/').to_string())
        .filter(|url| url.starts_with("http"))
        .ok_or_else(|| AppError::InvalidInput(format!("'{}' declares no URL", source.name)))
}

/// `GET <base>/v0/servers?version=latest&limit=&search=&cursor=`, built by the URL parser rather
/// than by hand so a search term with an `&` or a `#` in it can never change the request.
///
/// `version=latest` is what keeps a page full: without it the registry lists every published
/// version of a server, and a page of eight can collapse into one entry once the older ones are
/// dropped.
fn registry_url(base: &str, search: &str, cursor: Option<&str>, limit: u32) -> Result<String> {
    let mut url = reqwest::Url::parse(&format!("{base}/v0/servers"))
        .map_err(|error| AppError::Network(format!("{base} is not a usable URL: {error}")))?;
    {
        let mut pairs = url.query_pairs_mut();
        pairs.append_pair("version", "latest");
        pairs.append_pair("limit", &limit.to_string());
        if !search.trim().is_empty() {
            pairs.append_pair("search", search.trim());
        }
        if let Some(cursor) = cursor.filter(|cursor| !cursor.is_empty()) {
            pairs.append_pair("cursor", cursor);
        }
    }
    Ok(url.to_string())
}

fn tarball_url(repository: &str, git_ref: &str) -> Result<String> {
    if !crate::domain::plain_repository(repository) {
        return Err(AppError::InvalidInput(format!(
            "'{repository}' is not a plain repository"
        )));
    }
    if !crate::domain::plain_git_ref(git_ref) {
        return Err(AppError::InvalidInput(format!(
            "'{git_ref}' is not a plain git ref"
        )));
    }
    Ok(format!("{CODELOAD}/{repository}/tar.gz/{git_ref}"))
}

fn snapshot_key(source: &HubSource, repository: &str, git_ref: &str) -> String {
    format!(
        "{repository}@{git_ref}|{}|{}",
        source.path.as_deref().unwrap_or(""),
        source.exclude.join(",")
    )
}

/// The filter to read one index entry's skill with: exactly the directory it names.
fn index_filter(source: &HubSource, skill: &parse::IndexSkill) -> HubSource {
    let mut filter = source.clone();
    filter.path = Some(skill.path.clone());
    filter.exclude = Vec::new();
    filter
}

fn is_inside(path: &str, directory: &str) -> bool {
    path == directory || path.starts_with(&format!("{directory}/"))
}

/// Every tag a skill entry carries: what the skill declares about itself, what its source declares
/// for it, and the plugin/collection the layout puts it in. Normalized, so the card, the filter
/// and the search all read one list.
fn skill_tags(source: &HubSource, skill: &RepoSkill) -> Vec<String> {
    normalize_tags(
        skill
            .tags
            .iter()
            .cloned()
            .chain(source.declared_tags(&skill.dir))
            .chain(skill.group.iter().cloned()),
    )
}

/// A repository skill as the hub offers it.
///
/// `location` is where in GitHub the skill actually lives (`owner/repo`, ref). It is what makes the
/// two links of an entry real places: its repository, and the skill's own directory in it.
fn skill_entry(
    source: &HubSource,
    skill: &RepoSkill,
    files: &[TarFile],
    location: Option<(&str, &str)>,
) -> Prepared {
    let infos = parse::skill_files(files, &skill.file_indexes, &skill.dir);
    let entry = HubEntry {
        id: format!("{}/{}", source.id, skill.dir),
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        kind: HubResourceKind::Skill,
        name: skill.name.clone(),
        title: None,
        description: skill.description.clone(),
        version: None,
        vendor: source.vendor.clone(),
        homepage: None,
        repository: location.map(|(repository, _)| format!("https://github.com/{repository}")),
        license: source.license.clone(),
        tags: skill_tags(source, skill),
        group: skill.group.clone(),
        file_count: Some(infos.len() as u32),
        size_bytes: Some(skill.size_bytes),
        installable: true,
        install_problem: None,
        input_count: 0,
        has_scripts: skill.has_scripts,
        installed: Vec::new(),
        // The payload is right here (a repository is already read to list its skills), so an
        // installed copy can be told apart from a copy of the same name without a single request.
        identity: parse::entry_bytes(files, &skill.dir).map(installed::skill_identity),
    };
    Prepared {
        source_url: location.map(|(repository, git_ref)| {
            format!(
                "https://github.com/{repository}/tree/{git_ref}/{}",
                skill.dir
            )
        }),
        entry,
        files: infos,
        preview: parse::preview(files, &skill.dir),
        transport: None,
        inputs: Vec::new(),
    }
}

/// A client-side page of an already-read collection (the skills of a repository): filtered,
/// ordered, then sliced by the offset the cursor carries.
fn page_of(
    source: &HubSource,
    files: &[TarFile],
    skills: &[&RepoSkill],
    query: &HubQuery,
    location: Option<(&str, &str)>,
) -> Page {
    let total = skills.len();
    let offset = cursor_offset(query.cursor.as_deref(), total);
    let limit = query.page_size() as usize;
    let end = (offset + limit).min(total);
    let entries: Vec<HubEntry> = skills[offset..end]
        .iter()
        .map(|skill| skill_entry(source, skill, files, location).entry)
        .collect();
    Page {
        entries,
        next_cursor: (end < total).then(|| end.to_string()),
        total: Some(total as u32),
        problems: Vec::new(),
        from_cache: false,
    }
}

/// A page as the tags of the query ask for it.
///
/// Only the MCP registry needs this: it searches and pages server side and gives its entries no
/// tags of their own, so a tag filter can only drop entries *from the page it answered*. Every
/// other kind is filtered where it is read, before the page is cut.
fn tagged(page: Page, tags: &[String]) -> Page {
    if tags.is_empty() {
        return page;
    }
    let entries = page
        .entries
        .into_iter()
        .filter(|entry| tags_match(&entry.tags, tags))
        .collect();
    Page { entries, ..page }
}

fn cursor_offset(cursor: Option<&str>, total: usize) -> usize {
    cursor
        .and_then(|cursor| cursor.parse::<usize>().ok())
        .unwrap_or(0)
        .min(total)
}

fn compare_skills(a: &RepoSkill, b: &RepoSkill) -> std::cmp::Ordering {
    a.name
        .to_lowercase()
        .cmp(&b.name.to_lowercase())
        .then_with(|| a.dir.cmp(&b.dir))
}

/// `true` when a repository skill answers one page's query: its text, and the tags it carries.
fn skill_matches(skill: &RepoSkill, source: &HubSource, query: &HubQuery) -> bool {
    let tags = skill_tags(source, skill);
    tags_match(&tags, &query.tags) && matches_query(skill, &tags, &query.query)
}

/// What a search term matches in a repository skill: its name, its description, its directory
/// (`skills/pdf`), the collection it belongs to and any of its tags.
fn matches_query(skill: &RepoSkill, tags: &[String], query: &str) -> bool {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    let haystack = [
        skill.name.as_str(),
        skill.dir.as_str(),
        skill.group.as_deref().unwrap_or_default(),
        skill.description.as_deref().unwrap_or_default(),
    ];
    haystack
        .iter()
        .copied()
        .chain(tags.iter().map(String::as_str))
        .any(|text| text.to_lowercase().contains(&needle))
}

fn matches_entry(entry: &HubEntry, query: &str) -> bool {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    let haystack = [
        entry.name.as_str(),
        entry.title.as_deref().unwrap_or_default(),
        entry.description.as_deref().unwrap_or_default(),
        entry.vendor.as_deref().unwrap_or_default(),
    ];
    haystack
        .into_iter()
        .chain(entry.tags.iter().map(String::as_str))
        .any(|text| text.to_lowercase().contains(&needle))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn source() -> HubSource {
        catalog_hub::parse_source(
            r#"
id = "unit"
name = "Unit"
kind = "githubSkills"
repository = "owner/repo"
provides = ["skill"]
tags = ["development"]

[[tag_rules]]
prefix = "skills/design"
tags = ["design"]
"#,
            "test",
        )
        .expect("a valid source")
    }

    /// The fixture source with one field swapped, for the ordering tests.
    fn source_with(name: &str, kind: HubSourceKind, stars: Option<u64>) -> HubSource {
        HubSource {
            name: name.to_string(),
            kind,
            stars,
            ..source()
        }
    }

    #[test]
    fn sources_are_ordered_by_stars_then_by_name() {
        let mut sources = vec![
            source_with("Registry", HubSourceKind::McpRegistry, None),
            source_with("Zeta", HubSourceKind::GithubSkills, Some(10)),
            source_with("Beta", HubSourceKind::GithubSkills, Some(900)),
            source_with("Anthropic Reg", HubSourceKind::Index, None),
            source_with("Alpha", HubSourceKind::GithubSkills, Some(900)),
            source_with("Gamma", HubSourceKind::GithubSkills, None),
        ];
        sort_by_popularity(&mut sources);

        // GitHub collections first, most starred first, ties and the rest by name.
        let order: Vec<&str> = sources.iter().map(|source| source.name.as_str()).collect();
        assert_eq!(
            order,
            [
                "Alpha",
                "Beta",
                "Zeta",
                "Anthropic Reg",
                "Gamma",
                "Registry"
            ]
        );
    }

    fn skill(dir: &str, tags: &[&str], group: Option<&str>) -> RepoSkill {
        RepoSkill {
            dir: dir.to_string(),
            name: dir.rsplit('/').next().unwrap_or(dir).to_string(),
            description: None,
            file_indexes: Vec::new(),
            size_bytes: 0,
            has_scripts: false,
            group: group.map(str::to_string),
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
        }
    }

    fn query(tags: &[&str]) -> HubQuery {
        HubQuery {
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            ..HubQuery::default()
        }
    }

    fn entry(id: &str, tags: &[&str]) -> HubEntry {
        HubEntry {
            id: id.to_string(),
            source_id: "unit".to_string(),
            source_name: "Unit".to_string(),
            kind: HubResourceKind::Mcp,
            name: id.to_string(),
            title: None,
            description: None,
            version: None,
            vendor: None,
            homepage: None,
            repository: None,
            license: None,
            tags: tags.iter().map(|tag| tag.to_string()).collect(),
            group: None,
            file_count: None,
            size_bytes: None,
            installable: true,
            install_problem: None,
            input_count: 0,
            has_scripts: false,
            installed: Vec::new(),
            identity: None,
        }
    }

    #[test]
    fn a_skill_carries_its_own_tags_the_sources_and_its_group() {
        let source = source();
        assert_eq!(
            skill_tags(
                &source,
                &skill("skills/design/ui", &["ui"], Some("plugins"))
            ),
            ["ui", "development", "design", "plugins"]
        );
        assert_eq!(
            skill_tags(&source, &skill("skills/pdf", &[], None)),
            ["development"]
        );
    }

    #[test]
    fn a_tag_filter_keeps_what_carries_any_of_the_tags() {
        let source = source();
        let design = skill("skills/design/ui", &[], None);
        let pdf = skill("skills/pdf", &["documents"], None);

        assert!(skill_matches(&design, &source, &query(&["design"])));
        assert!(!skill_matches(&pdf, &source, &query(&["design"])));
        assert!(skill_matches(
            &pdf,
            &source,
            &query(&["design", "Documents"])
        ));
        assert!(skill_matches(&pdf, &source, &query(&[])));
        // A tag is searchable as text as well, like everything else an entry carries.
        assert!(matches_query(
            &design,
            &skill_tags(&source, &design),
            "design"
        ));
        assert!(!matches_query(&pdf, &skill_tags(&source, &pdf), "design"));
    }

    #[test]
    fn a_registry_page_loses_only_the_entries_the_tags_do_not_cover() {
        let page = Page {
            entries: vec![
                entry("com.example/files", &["files"]),
                entry("com.example/other", &["mcp"]),
            ],
            next_cursor: Some("2".to_string()),
            total: None,
            problems: Vec::new(),
            from_cache: false,
        };

        let filtered = tagged(page.clone(), &["FILES".to_string()]);
        assert_eq!(filtered.entries.len(), 1);
        assert_eq!(filtered.entries[0].name, "com.example/files");
        // The cursor is the registry's own, so paging carries on where it left off.
        assert_eq!(filtered.next_cursor.as_deref(), Some("2"));

        let untagged = tagged(page.clone(), &[]);
        assert_eq!(untagged.entries.len(), 2);
        let missing = tagged(page, &["testing".to_string()]);
        assert!(missing.entries.is_empty());
    }

    #[tokio::test]
    async fn a_registry_source_that_cannot_produce_a_tag_is_never_asked() {
        // The URL is a closed port: had the filter not been answered from the source's own
        // vocabulary, this would be a `Network` error instead of an empty page.
        let source = catalog_hub::parse_source(
            r#"
id = "unit-registry"
name = "Unit Registry"
kind = "mcpRegistry"
url = "http://127.0.0.1:9"
provides = ["mcp"]
tags = ["mcp"]
"#,
            "test",
        )
        .expect("a valid source");
        let dir = tempfile::tempdir().unwrap();
        let service = HubService::new(&Proxy::none(), dir.path());

        let page = service
            .registry_page(&source, &query(&["design"]))
            .await
            .expect("an empty page, answered without a request");
        assert!(page.entries.is_empty());
        assert!(page.next_cursor.is_none());

        // A tag the source does declare goes on to the registry as usual.
        assert!(tags_match(&source.tag_vocabulary(), &["mcp".to_string()]));
    }

    // -----------------------------------------------------------------------------------------
    // The network layer, driven by a loopback stub. Every source below points at 127.0.0.1, so
    // these tests prove the request handling, the caching and the limits without any internet.
    // -----------------------------------------------------------------------------------------

    use std::fs;
    use std::io::{BufRead, BufReader, Write};
    use std::net::{SocketAddr, TcpListener, TcpStream};
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::thread::JoinHandle;

    /// One canned answer for one request.
    enum Canned {
        /// A 200 with this body.
        Ok(String),
        /// A body too large to hold: `chunk` written `times` (the per-body cap test).
        Stream { chunk: Vec<u8>, times: usize },
        /// This status with an empty body.
        Status(u16),
    }

    type Route = Arc<dyn Fn(&str) -> Canned + Send + Sync>;

    /// A loopback HTTP/1.1 server answering `route` and counting every request it served.
    ///
    /// Hand-written on purpose: the Hub reads a source with a real HTTP client, so a mocked
    /// transport would not prove the body cap, the status handling or the streaming read.
    struct Stub {
        addr: SocketAddr,
        hits: Arc<AtomicUsize>,
        stop: Arc<AtomicBool>,
        thread: Option<JoinHandle<()>>,
    }

    impl Stub {
        fn start(route: impl Fn(&str) -> Canned + Send + Sync + 'static) -> Self {
            let listener = TcpListener::bind(("127.0.0.1", 0)).expect("a loopback port");
            let addr = listener.local_addr().expect("an address");
            let hits = Arc::new(AtomicUsize::new(0));
            let stop = Arc::new(AtomicBool::new(false));
            let route: Route = Arc::new(route);
            let thread = {
                let hits = Arc::clone(&hits);
                let stop = Arc::clone(&stop);
                std::thread::spawn(move || {
                    for stream in listener.incoming() {
                        if stop.load(Ordering::SeqCst) {
                            break;
                        }
                        let Ok(stream) = stream else { break };
                        let route = Arc::clone(&route);
                        let hits = Arc::clone(&hits);
                        std::thread::spawn(move || {
                            let _ = serve(stream, &*route, &hits);
                        });
                    }
                })
            };
            Self {
                addr,
                hits,
                stop,
                thread: Some(thread),
            }
        }

        /// `http://127.0.0.1:<port>`, as a source's `url` spells it.
        fn base(&self) -> String {
            format!("http://{}", self.addr)
        }

        fn hits(&self) -> usize {
            self.hits.load(Ordering::SeqCst)
        }
    }

    impl Drop for Stub {
        fn drop(&mut self) {
            self.stop.store(true, Ordering::SeqCst);
            // Wake the accept loop so its thread ends instead of holding the port forever.
            let _ = TcpStream::connect(self.addr);
            if let Some(thread) = self.thread.take() {
                let _ = thread.join();
            }
        }
    }

    /// Answer one request: read the request line and headers, then write the canned body.
    fn serve(
        mut stream: TcpStream,
        route: &(dyn Fn(&str) -> Canned + Send + Sync),
        hits: &AtomicUsize,
    ) -> std::io::Result<()> {
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut request_line = String::new();
        reader.read_line(&mut request_line)?;
        if request_line.trim().is_empty() {
            return Ok(()); // the wake-connect of `Drop`, not a request.
        }
        loop {
            let mut header = String::new();
            if reader.read_line(&mut header)? == 0 || header == "\r\n" {
                break;
            }
        }
        let target = request_line.split_whitespace().nth(1).unwrap_or("/");
        hits.fetch_add(1, Ordering::SeqCst);
        match route(target) {
            Canned::Ok(body) => write_body(&mut stream, 200, body.as_bytes()),
            Canned::Status(status) => write_body(&mut stream, status, b""),
            Canned::Stream { chunk, times } => {
                let head = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                    chunk.len() * times
                );
                stream.write_all(head.as_bytes())?;
                for _ in 0..times {
                    // The client stops reading at its own cap and closes; that is the point.
                    if stream.write_all(&chunk).is_err() {
                        break;
                    }
                }
                Ok(())
            }
        }
    }

    fn write_body(stream: &mut TcpStream, status: u16, body: &[u8]) -> std::io::Result<()> {
        let head = format!(
            "HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        );
        stream.write_all(head.as_bytes())?;
        stream.write_all(body)
    }

    /// A temp app-data directory, a service over it, and the user hub directory to drop sources in.
    fn service_and_hub() -> (tempfile::TempDir, HubService, PathBuf) {
        let dir = tempfile::tempdir().expect("a temp dir");
        let hub = dir.path().join("hub");
        fs::create_dir_all(&hub).expect("the hub source directory");
        let service = HubService::new(&Proxy::none(), dir.path());
        (dir, service, hub)
    }

    fn write_source(hub: &Path, file: &str, raw: &str) {
        fs::write(hub.join(file), raw).expect("write a hub source");
    }

    /// A `mcpRegistry` source over `url`, as a user would drop it into the hub directory.
    fn registry_toml(id: &str, url: &str) -> String {
        format!(
            "id = \"{id}\"\nname = \"{id}\"\nkind = \"mcpRegistry\"\nurl = \"{url}\"\nprovides = [\"mcp\"]\n"
        )
    }

    /// One `tar.gz` shaped like GitHub's: every member under a `repo-main/` directory.
    fn tar_gz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut builder = tar::Builder::new(flate2::write::GzEncoder::new(
            Vec::new(),
            flate2::Compression::fast(),
        ));
        for (path, bytes) in files {
            let mut header = tar::Header::new_gnu();
            header.set_size(bytes.len() as u64);
            header.set_mode(0o644);
            header.set_cksum();
            builder
                .append_data(&mut header, format!("repo-main/{path}"), *bytes)
                .expect("append");
        }
        builder
            .into_inner()
            .expect("finish the tar")
            .finish()
            .expect("finish the gzip")
    }

    /// One file of a repository already read, as `parse::read_tarball` would yield it.
    fn tar(path: &str, text: &str) -> TarFile {
        TarFile {
            path: path.to_string(),
            bytes: text.as_bytes().to_vec(),
        }
    }

    const REGISTRY_PAGE_1: &str = r#"{
      "servers": [{
        "server": {
          "name": "com.example/files",
          "description": "Read and write files",
          "version": "1.0.0",
          "packages": [{
            "registryType": "npm",
            "identifier": "@example/files",
            "version": "1.0.0"
          }]
        }
      }],
      "metadata": { "nextCursor": "cursor-2" }
    }"#;

    const REGISTRY_PAGE_2: &str = r#"{
      "servers": [{
        "server": {
          "name": "com.example/other",
          "version": "2.0.0",
          "remotes": [{ "type": "sse", "url": "https://mcp.example/other" }]
        }
      }],
      "metadata": {}
    }"#;

    const INDEX_DOCUMENT: &str = r#"{
      "entries": [
        { "id": "a", "name": "Alpha", "mcp": { "command": "npx", "args": ["alpha"] } },
        { "id": "b", "name": "Bravo", "mcp": { "url": "https://mcp.example/b" } },
        { "id": "c", "name": "Charlie", "mcp": { "command": "uvx", "args": ["c"] } },
        { "id": "d", "name": "Delta", "mcp": { "url": "https://mcp.example/d", "protocol": "sse" } },
        { "id": "e", "name": "Echo", "mcp": { "command": "docker", "args": ["e"] } }
      ]
    }"#;

    #[tokio::test]
    async fn an_identical_search_is_answered_from_the_cache_and_a_new_one_is_not() {
        let stub = Stub::start(|_target| Canned::Ok(REGISTRY_PAGE_1.to_string()));
        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "registry.toml",
            &registry_toml("loop-registry", &stub.base()),
        );
        let catalog = service.sources(&hub);

        let first = service
            .search(&catalog, "loop-registry", &HubQuery::default())
            .await
            .unwrap();
        assert_eq!(first.entries.len(), 1);
        assert_eq!(first.entries[0].name, "com.example/files");
        assert_eq!(first.report.next_cursor.as_deref(), Some("cursor-2"));
        assert_eq!(stub.hits(), 1, "the first page is one request");

        // The same query, cursor and limit answer from memory: browsing costs one request.
        let again = service
            .search(&catalog, "loop-registry", &HubQuery::default())
            .await
            .unwrap();
        assert_eq!(again.entries, first.entries);
        assert_eq!(stub.hits(), 1, "a repeated query costs no second request");
        // …and says so. Not an idle flag: a source that claims a fresh read prints the duration it
        // did not spend (`hub.reading`'s sibling in `HubSourceSection`).
        assert!(!first.report.from_cache, "the first page was fetched");
        assert!(again.report.from_cache, "the second page came from memory");

        // A different search term is a different page: it goes to the registry.
        let searched = HubQuery {
            query: "files".to_string(),
            ..HubQuery::default()
        };
        service
            .search(&catalog, "loop-registry", &searched)
            .await
            .unwrap();
        assert_eq!(stub.hits(), 2);

        // A different cursor is a different page too.
        let next = HubQuery {
            cursor: Some("cursor-2".to_string()),
            ..HubQuery::default()
        };
        service
            .search(&catalog, "loop-registry", &next)
            .await
            .unwrap();
        assert_eq!(stub.hits(), 3);

        // Refresh ignores the cache by design — and must not claim otherwise.
        let refreshed = HubQuery {
            refresh: true,
            ..HubQuery::default()
        };
        let refetched = service
            .search(&catalog, "loop-registry", &refreshed)
            .await
            .unwrap();
        assert_eq!(stub.hits(), 4);
        assert!(
            !refetched.report.from_cache,
            "a refresh is never a cache hit"
        );
    }

    #[tokio::test]
    async fn a_page_carries_the_cursor_the_previous_page_reported() {
        let stub = Stub::start(|target| {
            if target.contains("cursor=cursor-2") {
                Canned::Ok(REGISTRY_PAGE_2.to_string())
            } else {
                Canned::Ok(REGISTRY_PAGE_1.to_string())
            }
        });
        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "registry.toml",
            &registry_toml("loop-registry", &stub.base()),
        );
        let catalog = service.sources(&hub);

        let first = service
            .search(&catalog, "loop-registry", &HubQuery::default())
            .await
            .unwrap();
        assert_eq!(first.entries[0].id, "loop-registry/com.example/files");
        assert_eq!(first.report.next_cursor.as_deref(), Some("cursor-2"));

        // The cursor the first page reported is what the next request carries; the registry
        // answers the following page, and says there is none after it.
        let next = HubQuery {
            cursor: Some("cursor-2".to_string()),
            ..HubQuery::default()
        };
        let page = service
            .search(&catalog, "loop-registry", &next)
            .await
            .unwrap();
        assert_eq!(page.entries.len(), 1);
        assert_eq!(page.entries[0].id, "loop-registry/com.example/other");
        assert!(
            page.report.next_cursor.is_none(),
            "the last page reports no cursor"
        );
    }

    #[tokio::test]
    async fn an_index_document_is_paged_locally_and_read_once() {
        let stub = Stub::start(|_target| Canned::Ok(INDEX_DOCUMENT.to_string()));
        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "index.toml",
            &format!(
                "id = \"loop-index\"\nname = \"Loop Index\"\nkind = \"index\"\nurl = \"{}/doc.json\"\nprovides = [\"mcp\"]\n",
                stub.base()
            ),
        );
        let catalog = service.sources(&hub);

        let first = service
            .search(
                &catalog,
                "loop-index",
                &HubQuery {
                    limit: Some(4),
                    ..HubQuery::default()
                },
            )
            .await
            .unwrap();
        let names: Vec<&str> = first
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["Alpha", "Bravo", "Charlie", "Delta"]);
        assert_eq!(first.report.total, Some(5));
        assert_eq!(first.report.next_cursor.as_deref(), Some("4"));

        // The second page is cut from the same document: an index is one request per refresh.
        let second = service
            .search(
                &catalog,
                "loop-index",
                &HubQuery {
                    limit: Some(4),
                    cursor: Some("4".to_string()),
                    ..HubQuery::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(second.report.total, Some(5));
        assert!(
            second.report.from_cache,
            "the second page is cut from the cached document"
        );
        let names: Vec<&str> = second
            .entries
            .iter()
            .map(|entry| entry.name.as_str())
            .collect();
        assert_eq!(names, ["Echo"]);
        assert!(
            second.report.next_cursor.is_none(),
            "the last page reports no cursor"
        );
        assert_eq!(stub.hits(), 1, "both pages came from one document");
    }

    #[tokio::test]
    async fn a_body_over_the_download_cap_is_reported_not_read() {
        // 65 MiB over the 64 MiB a source may deliver: the read stops at the cap.
        let stub = Stub::start(|_target| Canned::Stream {
            chunk: vec![b'x'; 1024 * 1024],
            times: 65,
        });
        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "index.toml",
            &format!(
                "id = \"loop-index\"\nname = \"Loop Index\"\nkind = \"index\"\nurl = \"{}/huge.json\"\nprovides = [\"mcp\"]\n",
                stub.base()
            ),
        );
        let catalog = service.sources(&hub);

        let page = service
            .search(&catalog, "loop-index", &HubQuery::default())
            .await
            .unwrap();
        assert!(page.entries.is_empty());
        let error = page
            .report
            .error
            .expect("a failed read is reported on the source");
        assert!(error.contains("larger than"), "{error}");
    }

    #[tokio::test]
    async fn one_failing_source_does_not_empty_the_others() {
        let stub = Stub::start(|target| {
            if target.starts_with("/missing/") {
                Canned::Status(404)
            } else if target.starts_with("/boom/") {
                Canned::Status(500)
            } else if target.starts_with("/garbage/") {
                Canned::Ok("this is not a registry page".to_string())
            } else {
                Canned::Ok(REGISTRY_PAGE_1.to_string())
            }
        });
        // A port nothing listens on: the connection itself is refused.
        let refused = {
            let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
            let addr = listener.local_addr().unwrap();
            drop(listener);
            format!("http://{addr}")
        };

        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "a.toml",
            &registry_toml("loop-404", &format!("{}/missing", stub.base())),
        );
        write_source(
            &hub,
            "b.toml",
            &registry_toml("loop-500", &format!("{}/boom", stub.base())),
        );
        write_source(
            &hub,
            "c.toml",
            &registry_toml("loop-garbage", &format!("{}/garbage", stub.base())),
        );
        write_source(&hub, "d.toml", &registry_toml("loop-refused", &refused));
        write_source(
            &hub,
            "e.toml",
            &registry_toml("loop-ok", &format!("{}/ok", stub.base())),
        );
        let catalog = service.sources(&hub);

        // Each failure is the *source's own*: an empty page with this source's problem, never an
        // error that takes the screen down.
        let failures = [
            ("loop-404", "404"),
            ("loop-500", "500"),
            ("loop-garbage", "did not answer JSON"),
            ("loop-refused", "network request failed"),
        ];
        for (id, needle) in failures {
            let page = service
                .search(&catalog, id, &HubQuery::default())
                .await
                .unwrap();
            assert!(page.entries.is_empty(), "{id} answered entries");
            assert_eq!(page.report.id, id);
            let error = page.report.error.unwrap_or_default();
            assert!(error.contains(needle), "{id} reported '{error}'");
        }

        // The healthy source still answers: a failing neighbor is a note, not a broken screen.
        let page = service
            .search(&catalog, "loop-ok", &HubQuery::default())
            .await
            .unwrap();
        assert_eq!(page.report.error, None);
        assert_eq!(page.entries.len(), 1);
    }

    #[test]
    fn the_cache_drops_the_oldest_repository_once_it_is_over_budget() {
        let mut cache = Cache::default();
        // Half the budget each, so three of them cross it and exactly one has to go.
        let one = CACHE_BUDGET_BYTES / 2;
        let repo = |at: i64| Cached {
            at_ms: at,
            value: Repository {
                files: Arc::new(Vec::new()),
                truncated: false,
            },
        };
        let view = |truncated: bool| {
            Cached::new(Arc::new(Snapshot {
                files: Arc::new(Vec::new()),
                skills: Arc::new(Vec::new()),
                truncated,
            }))
        };
        // Three repositories of half the budget each: together they cross it, oldest first.
        let now = now_ms();
        for (key, at) in [("owner/a@main", now - 3), ("owner/b@main", now - 2)] {
            cache.repositories.insert(key.to_string(), repo(at));
            cache.weights.insert(key.to_string(), one);
        }
        // A snapshot is a view of a repository: it must not outlive the bytes it reads.
        cache
            .snapshots
            .insert("owner/a@main||".to_string(), view(false));
        cache
            .snapshots
            .insert("owner/b@main||".to_string(), view(false));
        cache
            .repositories
            .insert("owner/c@main".to_string(), repo(now));
        cache.weights.insert("owner/c@main".to_string(), one);

        cache.evict("owner/c@main");

        assert!(
            !cache.repositories.contains_key("owner/a@main"),
            "the oldest is dropped first"
        );
        assert!(cache.repositories.contains_key("owner/b@main"));
        assert!(
            cache.repositories.contains_key("owner/c@main"),
            "the repository just added is always kept"
        );
        assert!(!cache.weights.contains_key("owner/a@main"));
        assert!(
            !cache.snapshots.contains_key("owner/a@main||"),
            "a view goes with the bytes it was parsed from"
        );
        assert!(cache.snapshots.contains_key("owner/b@main||"));

        // Even alone over the budget, the repository just read cannot evict itself.
        let huge = CACHE_BUDGET_BYTES * 3;
        cache
            .repositories
            .insert("owner/d@main".to_string(), repo(now));
        cache.weights.insert("owner/d@main".to_string(), huge);
        cache.evict("owner/d@main");
        assert!(cache.repositories.contains_key("owner/d@main"));
        assert!(!cache.repositories.contains_key("owner/b@main"));
    }

    #[test]
    fn a_cached_answer_is_fresh_only_inside_the_ttl() {
        assert!(fresh(now_ms()));
        assert!(!fresh(now_ms() - CACHE_TTL_MS - 1));
    }

    #[test]
    fn a_file_over_the_cap_is_dropped_and_its_skill_never_appears() {
        let over = vec![b'x'; (parse::MAX_FILE_BYTES + 1) as usize];
        let (files, truncated) =
            parse::read_tarball(&tar_gz(&[("skills/huge/SKILL.md", &over)])).unwrap();
        assert!(
            truncated,
            "a file over the cap marks the collection incomplete"
        );
        assert!(files.is_empty(), "the oversized file is not kept");

        // The skill whose entry file was dropped is never offered at all.
        let source = catalog_hub::parse_source(
            r#"
id = "unit-repo"
name = "Unit Repo"
kind = "githubSkills"
repository = "owner/collection"
provides = ["skill"]
"#,
            "test",
        )
        .expect("a valid source");
        assert!(parse::repo_skills(&files, &source).is_empty());
    }

    #[tokio::test]
    async fn a_collection_that_hit_a_limit_is_still_shown_but_reported_incomplete() {
        // Files each under the per-file cap, whose total crosses the per-repo cap.
        let filler = vec![b'y'; parse::MAX_FILE_BYTES as usize];
        let filler = filler.as_slice();
        let skill = b"---\nname: PDF\ndescription: Fill forms\n---\n".as_slice();
        let (files, truncated) = parse::read_tarball(&tar_gz(&[
            ("skills/pdf/SKILL.md", skill),
            ("f1.bin", filler),
            ("f2.bin", filler),
            ("f3.bin", filler),
            ("f4.bin", filler),
            ("f5.bin", filler),
            ("f6.bin", filler),
        ]))
        .unwrap();
        assert!(truncated, "the repository stopped at its own cap");
        let files = Arc::new(files);

        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "repo.toml",
            "id = \"loop-repo\"\nname = \"Loop Repo\"\nkind = \"githubSkills\"\nrepository = \"owner/collection\"\nprovides = [\"skill\"]\n",
        );
        let catalog = service.sources(&hub);

        // The repository is already read, as `repository()` caches it: what is under test is that
        // the service still offers the collection *and* says it is incomplete.
        service.cache().repositories.insert(
            "owner/collection@main".to_string(),
            Cached {
                at_ms: now_ms(),
                value: Repository {
                    files: Arc::clone(&files),
                    truncated,
                },
            },
        );

        let page = service
            .search(&catalog, "loop-repo", &HubQuery::default())
            .await
            .unwrap();
        assert_eq!(page.report.error, None);
        assert_eq!(
            page.entries.len(),
            1,
            "the skill that survived is still offered"
        );
        assert!(
            page.report
                .problems
                .iter()
                .any(|problem| problem.contains("incomplete")),
            "{:?}",
            page.report.problems
        );
    }

    #[tokio::test]
    async fn a_hub_skill_writes_only_its_own_directory() {
        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "repo.toml",
            "id = \"loop-repo\"\nname = \"Loop Repo\"\nkind = \"githubSkills\"\nrepository = \"owner/collection\"\nprovides = [\"skill\"]\n",
        );
        let catalog = service.sources(&hub);

        // A repository as a tarball would yield it: the skill's own files, a file elsewhere in
        // the repository, and a member that walked out of it.
        let files = Arc::new(vec![
            tar(
                "skills/pdf/SKILL.md",
                "---\nname: PDF\ndescription: Fill forms\n---\n",
            ),
            tar("skills/pdf/scripts/fill.py", "print(1)\n"),
            tar("other/secret.md", "not this skill's\n"),
            tar("../escape.md", "nope\n"),
        ]);
        service.cache().repositories.insert(
            "owner/collection@main".to_string(),
            Cached {
                at_ms: now_ms(),
                value: Repository {
                    files: Arc::clone(&files),
                    truncated: false,
                },
            },
        );

        let install = service
            .skill_install(&catalog, "loop-repo/skills/pdf", "PDF Toolkit".to_string())
            .await
            .unwrap();
        assert_eq!(install.name, "PDF Toolkit");
        let paths: Vec<&str> = install
            .files
            .iter()
            .map(|file| file.path.as_str())
            .collect();
        assert_eq!(paths, ["SKILL.md", "scripts/fill.py"]);
        assert!(
            install
                .files
                .iter()
                .all(|file| !file.path.contains("..") && !file.path.starts_with("other")),
            "a file outside the skill's directory would have escaped: {paths:?}"
        );

        // Nothing of the skill survives the filter: the install is refused, not half-written.
        let refused = service
            .skill_install(&catalog, "loop-repo/skills/absent", "Absent".to_string())
            .await
            .unwrap_err();
        assert_eq!(refused.code(), "not_found");
    }

    #[tokio::test]
    async fn a_detail_of_a_listed_entry_needs_no_second_request() {
        let stub = Stub::start(|_target| Canned::Ok(REGISTRY_PAGE_1.to_string()));
        let (_dir, service, hub) = service_and_hub();
        write_source(
            &hub,
            "registry.toml",
            &registry_toml("loop-registry", &stub.base()),
        );
        let catalog = service.sources(&hub);

        service
            .search(&catalog, "loop-registry", &HubQuery::default())
            .await
            .unwrap();
        assert_eq!(stub.hits(), 1);

        // The page kept the record: opening or installing one entry is free.
        let detail = service
            .detail(&catalog, "loop-registry/com.example/files", false)
            .await
            .unwrap();
        assert_eq!(stub.hits(), 1, "the detail came from the page's cache");
        assert_eq!(detail.entry.name, "com.example/files");
        assert_eq!(
            detail.transport,
            Some(McpTransport::Stdio {
                command: "npx".to_string(),
                args: vec!["@example/files@1.0.0".to_string()],
            })
        );
    }
}
