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

mod parse;

use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError, RwLock};
use std::time::{Duration, Instant};

use tracing::warn;

use crate::catalog::hub as catalog_hub;
use crate::domain::skill::{SkillInstall, SkillInstallFile};
use crate::domain::{
    HubEntry, HubEntryDetail, HubFileInfo, HubInput, HubPage, HubPreview, HubQuery,
    HubResourceKind, HubSource, HubSourceCatalog, HubSourceKind, HubSourceReport, McpTransport,
    Proxy, ProxyMode,
};
use crate::error::{AppError, Result};
use crate::platform::now_ms;

use parse::{IndexItem, RegistryItem, RepoSkill, TarFile};

/// Repository payloads kept in memory before the oldest one is dropped.
const CACHE_BUDGET_BYTES: u64 = 96 * 1024 * 1024;
/// How long a fetched page, document or repository is reused.
const CACHE_TTL_MS: i64 = 10 * 60 * 1000;
/// A source that does not answer within this is reported as unreachable.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(25);
/// Largest body Ahabby will read from one source (a repository tarball is the big one).
const MAX_DOWNLOAD_BYTES: u64 = parse::MAX_ARCHIVE_BYTES;

/// Where GitHub serves the tarball of a repository at a ref.
const CODELOAD: &str = "https://codeload.github.com";

/// The Hub: where its sources are, and what they answered.
pub struct HubService {
    client: RwLock<reqwest::Client>,
    cache: Mutex<Cache>,
}

impl HubService {
    /// `proxy` decides how requests leave the machine, exactly as it does for version checks.
    pub fn new(proxy: &Proxy) -> Self {
        Self {
            client: RwLock::new(http_client(proxy)),
            cache: Mutex::new(Cache::default()),
        }
    }

    /// Settings changed: the cache is still valid, the connection is not.
    pub fn set_proxy(&self, proxy: &Proxy) {
        match self.client.write() {
            Ok(mut client) => *client = http_client(proxy),
            Err(error) => warn!("could not rebuild the hub client: {error}"),
        }
    }

    /// The hub's sources: the builtin ones plus the user's own from `user_dir`.
    pub fn sources(&self, user_dir: &Path) -> HubSourceCatalog {
        catalog_hub::load(Some(user_dir))
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
                    entry: item.entry,
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
                        entry: item.entry,
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
                return Ok(cached);
            }
        }

        let url = registry_url(&base, &query.query, query.cursor.as_deref(), limit)?;
        let body = self.get_json(&url).await?;
        let (items, next_cursor) = parse::mcp_registry(&body, source)?;

        let entries: Vec<HubEntry> = items.iter().map(|item| item.entry.clone()).collect();
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
        cache.pages.insert(key, Cached::new(page.clone()));
        Ok(page)
    }

    async fn github_page(&self, source: &HubSource, query: &HubQuery) -> Result<Page> {
        let repository = require_repository(source)?;
        let (snapshot, from_cache) = self
            .snapshot(source, repository, source.git_ref(), query.refresh)
            .await?;
        let mut matching: Vec<&RepoSkill> = snapshot
            .skills
            .iter()
            .filter(|skill| matches_query(skill, &query.query))
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
            .map(|item| item.entry.clone())
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
            Err(_) => http_client(&Proxy::none()),
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
            .map_err(|error| network_error(url, &error))?;
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
            .map_err(|error| network_error(url, &error))?
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

fn network_error(url: &str, error: &reqwest::Error) -> AppError {
    if error.is_timeout() {
        AppError::Timeout(REQUEST_TIMEOUT.as_secs())
    } else {
        AppError::Network(format!("{url}: {error}"))
    }
}

fn http_client(proxy: &Proxy) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent(concat!("Ahabby/", env!("CARGO_PKG_VERSION")))
        .timeout(REQUEST_TIMEOUT);
    match proxy.mode() {
        // `reqwest` picks the environment up on its own, so "no proxy" has to be said out loud.
        ProxyMode::None => builder = builder.no_proxy(),
        ProxyMode::System => {}
        ProxyMode::Manual => {
            if let Some(url) = proxy.url() {
                match reqwest::Proxy::all(url) {
                    Ok(configured) => builder = builder.proxy(configured),
                    Err(error) => warn!("ignoring proxy '{url}' for the hub: {error}"),
                }
            }
        }
    }
    builder.build().unwrap_or_default()
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
        tags: skill.group.clone().into_iter().collect(),
        file_count: Some(infos.len() as u32),
        size_bytes: Some(skill.size_bytes),
        installable: true,
        install_problem: None,
        input_count: 0,
        has_scripts: skill.has_scripts,
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

/// What a search term matches in a repository skill: its name, its description, its directory
/// (`skills/pdf`) and the collection it belongs to.
fn matches_query(skill: &RepoSkill, query: &str) -> bool {
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
