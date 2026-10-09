//! Cloud sync: the service that turns the last scan into uploads and restores.
//!
//! The module reads *one* source of truth — the last [`ScanReport`] — for what exists and where a
//! restore may land, and one provider for the remote side. It owns three things and nothing else:
//!
//! * a [`SyncProvider`] behind a trait (only [`gist::GistProvider`] implements it), so a second
//!   cloud is one arm plus one file;
//! * a [`store`] of what was uploaded (for idempotent, self-healing automatic runs) and the
//!   credentials;
//! * a reconciliation loop that uploads a changed item and nothing else.
//!
//! Uploading is manual by default and may be made automatic per kind and owner; *restoring* is
//! always manual and always goes through [`SyncTarget::write_file`] / [`SyncTarget::install_skill`],
//! which are the app's own path-checked writes — a remote payload never names a path that lands
//! outside a surface the manifest declared.

pub mod gist;
pub mod plan;
pub mod store;

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::time::{Duration, Instant};

use async_trait::async_trait;
use serde_json::Value;

use crate::domain::{
    RemoteItem, SkillInstall, SkillInstallFile, SyncAccount, SyncComparison, SyncContent,
    SyncContentSide, SyncFileAction, SyncFileContent, SyncFileStatus, SyncItem, SyncItemList,
    SyncItemRef, SyncItemResult, SyncItemStatus, SyncKind, SyncMode, SyncPayload, SyncPayloadFile,
    SyncPreview, SyncPreviewFile, SyncProviderId, SyncPullTarget, SyncRun, SyncRunKind,
    SyncSettings, SyncStatus, SHARED_OWNER_ID, SYNC_SCHEMA,
};
use crate::error::{AppError, Result};
use crate::platform::now_ms;
use crate::services::http;
use crate::services::ScanReport;

use store::{Credentials, StoredItem, SyncStore};

/// How long a fetched remote listing is reused before it is asked for again.
const REMOTE_CACHE_MS: u128 = 60 * 1000;

/// Largest file the reader reads *in full* — the only way to know whether two binary files are the
/// same. Anything above it is reported by its size and called uncomparable rather than read.
const MAX_READ_FILE_BYTES: u64 = 8 * 1024 * 1024;

/// The cloud, as the service uses it.
#[async_trait]
pub trait SyncProvider: Send + Sync {
    fn id(&self) -> SyncProviderId;
    /// Who the token belongs to, and how much this account holds.
    async fn verify(&self) -> Result<SyncAccount>;
    /// Every copy Ahabby owns in this account.
    async fn list(&self) -> Result<Vec<RemoteItem>>;
    /// Create (`existing = None`) or update (`Some(id)`) one copy.
    async fn upload(&self, payload: &SyncPayload, existing: Option<&str>) -> Result<RemoteItem>;
    /// Read one copy back.
    async fn download(&self, remote_id: &str) -> Result<SyncPayload>;
    /// Remove one copy. A missing copy is not an error.
    async fn delete(&self, remote_id: &str) -> Result<()>;
}

/// Where a run reports. The service never touches Tauri; the sink does.
pub trait SyncSink: Send + Sync {
    fn finished(&self, run: &SyncRun, error: Option<&str>);
}

/// What the service needs from the application to restore anything.
///
/// Both calls are the app's own checked writes: a path is validated against the owner's declared
/// surface, and a skill is written through the adapter that owns its directory. Nothing here
/// knows a filesystem layout of its own.
#[async_trait]
pub trait SyncTarget: Send + Sync {
    /// Write one document of `owner_id`, through the same atomic, backed-up path as an edit.
    async fn write_file(&self, owner_id: &str, path: &str, bytes: &[u8]) -> Result<()>;
    /// Create a skill directory of `owner_id` from a payload. Returns the directory written into.
    async fn install_skill(&self, owner_id: &str, install: SkillInstall) -> Result<String>;
    /// Where a skill of this owner would be created, when the owner declares a skills surface.
    fn skills_root(&self, owner_id: &str) -> Option<String>;
    /// The name shown for an owner, when the scan knows it.
    fn owner_name(&self, owner_id: &str) -> Option<String>;
    /// `false` when the id names neither an agent, the shared surface nor a project.
    fn owner_exists(&self, owner_id: &str) -> bool;
}

/// A cached remote listing.
struct RemoteCache {
    at: Instant,
    items: Vec<RemoteItem>,
}

/// The sync module's whole state.
pub struct SyncService {
    home: PathBuf,
    store: SyncStore,
    credentials: Credentials,
    client: RwLock<reqwest::Client>,
    settings: RwLock<SyncSettings>,
    /// The last scan, kept only so the automatic loop can run without the app in front of it.
    report: RwLock<Option<ScanReport>>,
    cache: Mutex<Option<RemoteCache>>,
    sink: RwLock<Option<Arc<dyn SyncSink>>>,
    /// A provider other than the Gist one — how the tests drive the service without a network,
    /// and where a second cloud would plug in.
    provider: RwLock<Option<Arc<dyn SyncProvider>>>,
    /// The account the last verification found, so a restarted screen can name it.
    account: RwLock<Option<SyncAccount>>,
    running: AtomicBool,
    auto_started: AtomicBool,
}

impl SyncService {
    pub fn new(app_data: &Path, app_config: &Path, proxy: &crate::domain::Proxy) -> Self {
        Self {
            home: dirs::home_dir().unwrap_or_default(),
            store: SyncStore::load(app_data),
            credentials: Credentials::load(app_config),
            client: RwLock::new(http::client(proxy, gist::TIMEOUT, gist::MAX_REDIRECTS)),
            settings: RwLock::new(SyncSettings::default()),
            report: RwLock::new(None),
            cache: Mutex::new(None),
            sink: RwLock::new(None),
            provider: RwLock::new(None),
            account: RwLock::new(None),
            running: AtomicBool::new(false),
            auto_started: AtomicBool::new(false),
        }
    }

    /// Settings changed, or the module was just built: adopt the configuration.
    pub fn set_settings(&self, settings: &SyncSettings) {
        if let Ok(mut guard) = self.settings.write() {
            *guard = settings.clone();
        }
    }

    /// Settings changed: the connection is rebuilt, the state is not.
    pub fn set_proxy(&self, proxy: &crate::domain::Proxy) {
        if let Ok(mut client) = self.client.write() {
            *client = http::client(proxy, gist::TIMEOUT, gist::MAX_REDIRECTS);
        }
    }

    pub fn set_sink(&self, sink: Arc<dyn SyncSink>) {
        if let Ok(mut guard) = self.sink.write() {
            *guard = Some(sink);
        }
    }

    /// Substitute the provider. Only tests use it, and only ever before a run.
    pub fn set_provider(&self, provider: Arc<dyn SyncProvider>) {
        if let Ok(mut guard) = self.provider.write() {
            *guard = Some(provider);
        }
    }

    /// Adopt the scan the automatic loop works from. Called for every finished scan.
    pub fn observe(&self, report: &ScanReport) {
        if let Ok(mut guard) = self.report.write() {
            *guard = Some(report.clone());
        }
    }

    fn settings(&self) -> SyncSettings {
        self.settings
            .read()
            .map(|settings| settings.clone())
            .unwrap_or_default()
    }

    fn last_report(&self) -> Option<ScanReport> {
        self.report.read().ok().and_then(|report| report.clone())
    }

    /// The current status of the connection and the last runs.
    pub fn status(&self) -> SyncStatus {
        let settings = self.settings();
        let snapshot = self.store.snapshot();
        SyncStatus {
            provider: settings.provider,
            enabled: settings.enabled,
            mode: settings.mode,
            connected: self.credentials.token().is_some(),
            token_hint: self.credentials.hint(),
            account: self.account.read().ok().and_then(|account| account.clone()),
            last_push_ms: snapshot.last_push_ms,
            last_pull_ms: snapshot.last_pull_ms,
            last_error: snapshot.last_error,
            running: self.running.load(Ordering::SeqCst),
        }
    }

    /// Store (or clear) the token. The settings document never sees it.
    pub fn set_token(&self, provider: SyncProviderId, token: &str) -> Result<SyncStatus> {
        let settings = self.settings();
        if settings.provider != provider {
            // The provider is part of the settings document; a token for another one is a
            // request to switch, which the document is where that is decided.
            return Err(AppError::InvalidInput(
                "save the provider choice before connecting an account".to_string(),
            ));
        }
        self.credentials.set(provider, token)?;
        self.invalidate_cache();
        Ok(self.status())
    }

    /// Build the provider the current token addresses.
    fn provider(&self) -> Result<Arc<dyn SyncProvider>> {
        if let Ok(guard) = self.provider.read() {
            if let Some(provider) = guard.as_ref() {
                return Ok(Arc::clone(provider));
            }
        }
        let token = self.credentials.token().ok_or_else(|| {
            AppError::InvalidInput("connect a GitHub account before using cloud sync".to_string())
        })?;
        let client = self
            .client
            .read()
            .map(|client| client.clone())
            .unwrap_or_default();
        Ok(Arc::new(gist::GistProvider::new(client, token)))
    }

    /// Check the stored token against the provider.
    pub async fn verify(&self) -> Result<SyncAccount> {
        let account = self.provider()?.verify().await?;
        if let Ok(mut guard) = self.account.write() {
            *guard = Some(account.clone());
        }
        self.invalidate_cache();
        Ok(account)
    }

    // --- local side -------------------------------------------------------------------------

    /// Every item of the given report, with what the state store knows about each.
    pub fn local_items(&self, report: &ScanReport, owner: Option<&str>) -> SyncItemList {
        let mut items = plan::items_of(report, Some(&self.home), owner);
        let snapshot = self.store.snapshot();
        let mut list = SyncItemList {
            items: Vec::with_capacity(items.len()),
            unsynced: 0,
            modified: 0,
            missing: 0,
        };
        for item in items.iter_mut() {
            let key = state_key(&item.owner_id, &item.key);
            let Some(stored) = snapshot.items.get(&key) else {
                item.status = SyncItemStatus::Unsynced;
                list.unsynced += 1;
                list.items.push(item.clone());
                continue;
            };
            item.remote_id = Some(stored.remote_id.clone());
            item.synced_at_ms = Some(stored.synced_at_ms);
            if !item.exists {
                item.status = SyncItemStatus::Missing;
                list.missing += 1;
            } else {
                match self.item_hash(item) {
                    Ok(hash) if hash == stored.hash => item.status = SyncItemStatus::Synced,
                    Ok(_) => {
                        item.status = SyncItemStatus::Modified;
                        list.modified += 1;
                    }
                    Err(_) => item.status = SyncItemStatus::Modified,
                }
            }
            list.items.push(item.clone());
        }
        list
    }

    /// The content hash of an item as it is on disk right now — what "changed" is measured by.
    fn item_hash(&self, item: &SyncItem) -> Result<String> {
        let files = self.read_item_files(item)?;
        Ok(plan::payload_hash(&files))
    }

    /// Read an item's bytes into payload files.
    fn read_item_files(&self, item: &SyncItem) -> Result<Vec<SyncPayloadFile>> {
        let path = Path::new(&item.path);
        if item.is_directory {
            return plan::read_directory(path);
        }
        let bytes = std::fs::read(path).map_err(|error| AppError::io(path, error))?;
        Ok(vec![plan::payload_file(&item.name, &bytes)])
    }

    // --- reading ----------------------------------------------------------------------------

    /// One item of this machine, as a reader shows it — resolved from the scan, never from a path
    /// the frontend sent.
    pub fn local_content(
        &self,
        report: &ScanReport,
        owner_id: &str,
        item_id: &str,
    ) -> Result<SyncContent> {
        let item = plan::items_of(report, Some(&self.home), None)
            .into_iter()
            .find(|item| item.owner_id == owner_id && item.id == item_id)
            .ok_or_else(|| AppError::NotFound(format!("sync item {item_id} of {owner_id}")))?;
        let readable = item.exists;
        Ok(SyncContent {
            side: SyncContentSide::Local,
            key: item.key.clone(),
            name: item.name.clone(),
            label: item.label.clone(),
            owner_id: item.owner_id.clone(),
            owner_name: item.owner_name.clone(),
            kind: item.kind,
            is_directory: item.is_directory,
            exists: item.exists,
            hash: if readable {
                Some(self.item_hash(&item)?)
            } else {
                None
            },
            remote_id: item.remote_id.clone(),
            uri: item.remote_uri.clone(),
            modified_ms: readable
                .then(|| crate::platform::modified_ms(Path::new(&item.path)))
                .flatten(),
            files: if readable {
                self.read_view_files(&item)?
            } else {
                Vec::new()
            },
        })
    }

    /// One cloud copy, as a reader shows it.
    pub async fn remote_content(&self, remote_id: &str) -> Result<SyncContent> {
        let payload = self.provider()?.download(remote_id).await?;
        Ok(self.payload_content(remote_id, &payload))
    }

    /// One item against its cloud copy: both sides, read the same way, and how they stand.
    pub async fn compare(
        &self,
        report: &ScanReport,
        remote_id: &str,
        owner_id: &str,
    ) -> Result<SyncComparison> {
        let payload = self.provider()?.download(remote_id).await?;
        let local_items = plan::items_of(report, Some(&self.home), Some(owner_id));
        let local_item = match_local(&local_items, &payload);

        let cloud = self.payload_content(remote_id, &payload);
        let local = match local_item.filter(|item| item.exists) {
            Some(item) => SyncContent {
                side: SyncContentSide::Local,
                key: item.key.clone(),
                name: item.name.clone(),
                label: item.label.clone(),
                owner_id: item.owner_id.clone(),
                owner_name: item.owner_name.clone(),
                kind: item.kind,
                is_directory: item.is_directory,
                exists: true,
                hash: Some(self.item_hash(item)?),
                remote_id: item.remote_id.clone(),
                uri: item.remote_uri.clone(),
                modified_ms: crate::platform::modified_ms(Path::new(&item.path)),
                files: self.read_view_files(item)?,
            },
            // Nothing of that name is here: the comparison is then "the cloud has a copy this
            // machine has nowhere to put", which is a real answer, not an error.
            None => SyncContent {
                side: SyncContentSide::Local,
                key: payload.key.clone(),
                name: payload.name.clone(),
                label: payload.label.clone(),
                owner_id: owner_id.to_string(),
                owner_name: payload.owner_name.clone(),
                kind: payload.kind,
                is_directory: payload.is_directory,
                exists: false,
                files: Vec::new(),
                ..SyncContent::default()
            },
        };

        let files = plan::compare_files(&local.files, &cloud.files);
        let changed = files
            .iter()
            .filter(|file| file.status != SyncFileStatus::Same)
            .count();
        Ok(SyncComparison {
            key: payload.key.clone(),
            name: payload.name.clone(),
            label: payload.label.clone(),
            kind: payload.kind,
            owner_id: owner_id.to_string(),
            owner_name: local.owner_name.clone(),
            identical: changed == 0,
            changed,
            files,
            local,
            cloud,
        })
    }

    /// The reader's view of a stored document — the same shape a local item is read into, so the
    /// two sides can be compared field by field.
    fn payload_content(&self, remote_id: &str, payload: &SyncPayload) -> SyncContent {
        SyncContent {
            side: SyncContentSide::Remote,
            key: payload.key.clone(),
            name: payload.name.clone(),
            label: payload.label.clone(),
            owner_id: payload.owner_id.clone(),
            owner_name: payload.owner_name.clone(),
            kind: payload.kind,
            is_directory: payload.is_directory,
            exists: true,
            files: payload.files.iter().map(view_of_payload_file).collect(),
            hash: Some(payload.hash.clone()),
            remote_id: Some(remote_id.to_string()),
            uri: self.cached_uri(remote_id),
            modified_ms: Some(payload.pushed_at_ms),
        }
    }

    /// Where a copy lives, when the last listing knew.
    fn cached_uri(&self, remote_id: &str) -> Option<String> {
        let cache = self.cache.lock().ok()?;
        cache
            .as_ref()?
            .items
            .iter()
            .find(|item| item.remote_id == remote_id)
            .map(|item| item.uri.clone())
            .filter(|uri| !uri.is_empty())
    }

    /// Every file of one item, read for a reader.
    ///
    /// A directory is walked with the same rules the push uses (hidden entries skipped, the same
    /// file cap), but each file is only *read in full* while it is small enough to be worth
    /// hashing: a large asset is reported by its size alone, which the comparison then calls
    /// uncomparable instead of guessing.
    fn read_view_files(&self, item: &SyncItem) -> Result<Vec<SyncFileContent>> {
        let root = Path::new(&item.path);
        if !item.is_directory {
            let bytes = std::fs::read(root).map_err(|error| AppError::io(root, error))?;
            return Ok(vec![plan::file_content(&item.name, &bytes)]);
        }

        let mut files = Vec::new();
        for entry in walkdir::WalkDir::new(root).sort_by_file_name() {
            let entry =
                entry.map_err(|error| AppError::other(format!("cannot read {root:?}: {error}")))?;
            if !entry.file_type().is_file() {
                continue;
            }
            let relative = entry
                .path()
                .strip_prefix(root)
                .map_err(|error| AppError::other(error.to_string()))?
                .to_string_lossy()
                .replace('\\', "/");
            if relative.starts_with('.') || relative.contains("/.") {
                continue;
            }
            if files.len() >= plan::MAX_ITEM_FILES {
                break;
            }
            let size = entry.metadata().map(|meta| meta.len()).unwrap_or(0);
            if size > MAX_READ_FILE_BYTES {
                files.push(SyncFileContent {
                    path: relative,
                    text: None,
                    size_bytes: size,
                    binary: true,
                    truncated: true,
                    hash: None,
                });
                continue;
            }
            let bytes =
                std::fs::read(entry.path()).map_err(|error| AppError::io(entry.path(), error))?;
            files.push(plan::file_content(&relative, &bytes));
        }
        Ok(files)
    }

    // --- remote side ------------------------------------------------------------------------

    /// The copies this account holds, cached for a minute unless a refresh is asked for.
    pub async fn remote_items(&self, refresh: bool) -> Result<crate::domain::RemoteList> {
        if !refresh {
            if let Ok(cache) = self.cache.lock() {
                if let Some(cache) = cache.as_ref() {
                    if cache.at.elapsed().as_millis() < REMOTE_CACHE_MS {
                        return Ok(crate::domain::RemoteList {
                            items: cache.items.clone(),
                            fetched_at_ms: now_ms(),
                            from_cache: true,
                        });
                    }
                }
            }
        }
        let items = self.fetch_remote().await?;
        Ok(crate::domain::RemoteList {
            items,
            fetched_at_ms: now_ms(),
            from_cache: false,
        })
    }

    /// Ask the provider, and update the cache.
    async fn fetch_remote(&self) -> Result<Vec<RemoteItem>> {
        let provider = self.provider()?;
        let items = match provider.list().await {
            Ok(items) => items,
            Err(error) => {
                self.store.set_error(Some(error.to_string()));
                return Err(error);
            }
        };
        self.store.set_error(None);
        if let Ok(mut cache) = self.cache.lock() {
            *cache = Some(RemoteCache {
                at: Instant::now(),
                items: items.clone(),
            });
        }
        Ok(items)
    }

    fn invalidate_cache(&self) {
        if let Ok(mut cache) = self.cache.lock() {
            *cache = None;
        }
    }

    // --- push -------------------------------------------------------------------------------

    /// Upload the items the user selected.
    pub async fn push(&self, report: &ScanReport, refs: &[SyncItemRef]) -> Result<SyncRun> {
        let settings = self.require_enabled()?;
        let local = plan::items_of(report, Some(&self.home), None);
        let mut selected = Vec::new();
        for reference in refs {
            let item = local
                .iter()
                .find(|item| item.owner_id == reference.owner_id && item.id == reference.item_id)
                .ok_or_else(|| {
                    AppError::NotFound(format!(
                        "sync item {} of {}",
                        reference.item_id, reference.owner_id
                    ))
                })?;
            selected.push(item.clone());
        }
        self.upload(report, selected, &settings, SyncRunKind::Push, false)
            .await
    }

    /// Upload everything the automatic set covers — the "save everything now" button.
    pub async fn push_all(&self, report: &ScanReport) -> Result<SyncRun> {
        let settings = self.require_enabled()?;
        let items = self.automatic_items(report, &settings);
        self.upload(report, items, &settings, SyncRunKind::Push, false)
            .await
    }

    /// The items an automatic run covers, in the order they are reported.
    fn automatic_items(&self, report: &ScanReport, settings: &SyncSettings) -> Vec<SyncItem> {
        plan::items_of(report, Some(&self.home), None)
            .into_iter()
            .filter(|item| settings.auto_kinds.contains(&item.kind))
            .filter(|item| {
                settings.auto_owners.is_empty() || settings.auto_owners.contains(&item.owner_id)
            })
            .filter(|item| owner_is_live(report, &item.owner_id))
            .collect()
    }

    /// The upload path both a manual push and an automatic run go through.
    ///
    /// `automatic` changes two rules: only items whose content differs from the state store are
    /// touched at all, and a secret-bearing item is never considered — the user opted into
    /// automatic saving, not into publishing credentials.
    async fn upload(
        &self,
        _report: &ScanReport,
        items: Vec<SyncItem>,
        settings: &SyncSettings,
        kind: SyncRunKind,
        automatic: bool,
    ) -> Result<SyncRun> {
        if !self.begin_run() {
            return Err(AppError::InvalidInput(
                "another sync run is already in progress".to_string(),
            ));
        }
        let outcome = self.upload_inner(items, settings, kind, automatic).await;
        self.finish_run(Some(&outcome));
        outcome
    }

    async fn upload_inner(
        &self,
        items: Vec<SyncItem>,
        settings: &SyncSettings,
        kind: SyncRunKind,
        automatic: bool,
    ) -> Result<SyncRun> {
        let provider = self.provider()?;
        let remote = self.fetch_remote().await.unwrap_or_default();
        let snapshot = self.store.snapshot();
        let mut run = Run::new(kind);

        for item in items {
            let message = |run: &mut Run, ok: bool, skipped: bool, text: &str| {
                run.result(SyncItemResult {
                    name: item.name.clone(),
                    owner_id: item.owner_id.clone(),
                    kind: item.kind,
                    ok,
                    skipped,
                    message: Some(text.to_string()),
                    remote_id: None,
                });
            };

            if plan::excluded(&item.relative_path, &settings.exclude_patterns) {
                if automatic {
                    continue;
                }
                run.skipped += 1;
                message(&mut run, true, true, "excluded by a pattern");
                continue;
            }
            if item.has_secrets && !settings.include_secrets {
                if automatic {
                    continue;
                }
                run.skipped += 1;
                message(
                    &mut run,
                    true,
                    true,
                    "contains secrets — enable 'include secrets'",
                );
                continue;
            }
            if !item.exists {
                if automatic {
                    continue;
                }
                run.skipped += 1;
                message(&mut run, true, true, "not on disk");
                continue;
            }

            let payload = match self.payload_for(&item, settings) {
                Ok(payload) => payload,
                Err(error) => {
                    if automatic {
                        continue;
                    }
                    run.failed += 1;
                    message(&mut run, false, false, &error.to_string());
                    continue;
                }
            };

            let key = state_key(&item.owner_id, &item.key);
            if automatic {
                match snapshot.items.get(&key) {
                    Some(stored) if stored.hash == payload.hash => continue,
                    _ => {}
                }
            } else if let Some(stored) = snapshot.items.get(&key) {
                if stored.hash == payload.hash {
                    let exists_remote = remote
                        .iter()
                        .any(|entry| entry.remote_id == stored.remote_id);
                    if exists_remote {
                        message(&mut run, true, false, "already up to date");
                        continue;
                    }
                }
            }

            let existing = remote
                .iter()
                .find(|entry| entry.owner_id == item.owner_id && entry.key == payload.key)
                .map(|entry| entry.remote_id.clone())
                .or_else(|| {
                    snapshot
                        .items
                        .get(&key)
                        .map(|stored| stored.remote_id.clone())
                });

            match provider.upload(&payload, existing.as_deref()).await {
                Ok(uploaded) => {
                    self.store.record(
                        key,
                        StoredItem {
                            remote_id: uploaded.remote_id.clone(),
                            hash: payload.hash.clone(),
                            synced_at_ms: now_ms(),
                            files: payload.files.len(),
                        },
                    );
                    run.uploaded += 1;
                    run.result(SyncItemResult {
                        name: item.name.clone(),
                        owner_id: item.owner_id.clone(),
                        kind: item.kind,
                        ok: true,
                        skipped: false,
                        message: None,
                        remote_id: Some(uploaded.remote_id),
                    });
                }
                Err(error) => {
                    run.failed += 1;
                    message(&mut run, false, false, &error.to_string());
                }
            }
        }

        if run.uploaded > 0 {
            self.store.set_last_push(now_ms());
            self.invalidate_cache();
        }
        Ok(run.build())
    }

    /// The whole document for one item, size cap included.
    fn payload_for(&self, item: &SyncItem, settings: &SyncSettings) -> Result<SyncPayload> {
        let files = self.read_item_files(item)?;
        if files.is_empty() {
            return Err(AppError::InvalidInput(format!(
                "'{}' holds no files",
                item.label
            )));
        }
        let size = plan::payload_size(&files);
        if size > settings.max_file_bytes {
            return Err(AppError::InvalidInput(format!(
                "'{}' is {size} bytes, above the {}-byte limit",
                item.label, settings.max_file_bytes
            )));
        }
        Ok(SyncPayload {
            schema: SYNC_SCHEMA,
            app: "ahabby".to_string(),
            kind: item.kind,
            key: item.key.clone(),
            owner_kind: item.owner_kind,
            owner_id: item.owner_id.clone(),
            owner_name: item.owner_name.clone(),
            name: item.name.clone(),
            label: item.label.clone(),
            relative_path: item.relative_path.clone(),
            is_directory: item.is_directory,
            hash: plan::payload_hash(&files),
            files,
            pushed_at_ms: now_ms(),
            source_path: item.path.clone(),
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            os: std::env::consts::OS.to_string(),
            has_secrets: item.has_secrets,
        })
    }

    // --- pull -------------------------------------------------------------------------------

    /// What restoring one copy would do — resolved against the *current* scan, so a path the
    /// owner does not declare can never be a destination.
    pub async fn preview(
        &self,
        report: &ScanReport,
        target: &dyn SyncTarget,
        remote_id: &str,
        owner_id: &str,
    ) -> Result<SyncPreview> {
        let payload = self.provider()?.download(remote_id).await?;
        if !target.owner_exists(owner_id) {
            return Err(AppError::NotFound(format!("owner '{owner_id}'")));
        }
        let local = plan::items_of(report, Some(&self.home), Some(owner_id));
        let owner_name = target
            .owner_name(owner_id)
            .unwrap_or_else(|| owner_id.to_string());
        Ok(build_preview(
            &payload,
            remote_id,
            owner_id,
            &owner_name,
            &local,
            target,
        ))
    }

    /// Restore the selected copies. Always manual, and refused without an explicit confirmation.
    pub async fn pull(
        &self,
        report: &ScanReport,
        target: &dyn SyncTarget,
        targets: &[SyncPullTarget],
        confirm: bool,
    ) -> Result<SyncRun> {
        if !confirm {
            return Err(AppError::InvalidInput(
                "restoring must be confirmed".to_string(),
            ));
        }
        self.require_enabled()?;
        if !self.begin_run() {
            return Err(AppError::InvalidInput(
                "another sync run is already in progress".to_string(),
            ));
        }
        let outcome = self.pull_inner(report, target, targets).await;
        self.finish_run(Some(&outcome));
        outcome
    }

    async fn pull_inner(
        &self,
        report: &ScanReport,
        target: &dyn SyncTarget,
        targets: &[SyncPullTarget],
    ) -> Result<SyncRun> {
        let provider = self.provider()?;
        let mut run = Run::new(SyncRunKind::Pull);

        for requested in targets {
            let payload = match provider.download(&requested.remote_id).await {
                Ok(payload) => payload,
                Err(error) => {
                    run.failed += 1;
                    run.result(SyncItemResult {
                        name: requested.remote_id.clone(),
                        owner_id: requested.owner_id.clone(),
                        kind: SyncKind::Other,
                        ok: false,
                        skipped: false,
                        message: Some(error.to_string()),
                        remote_id: Some(requested.remote_id.clone()),
                    });
                    continue;
                }
            };
            let local = plan::items_of(report, Some(&self.home), Some(&requested.owner_id));
            let outcome = self
                .apply(&payload, &requested.owner_id, &local, target)
                .await;
            match outcome {
                Ok(destination) => {
                    run.downloaded += 1;
                    run.result(SyncItemResult {
                        name: payload.name.clone(),
                        owner_id: requested.owner_id.clone(),
                        kind: payload.kind,
                        ok: true,
                        skipped: false,
                        message: Some(destination),
                        remote_id: Some(requested.remote_id.clone()),
                    });
                }
                Err(error) => {
                    match &error {
                        AppError::NotSupported(_) | AppError::NotFound(_) => run.skipped += 1,
                        _ => run.failed += 1,
                    }
                    run.result(SyncItemResult {
                        name: payload.name.clone(),
                        owner_id: requested.owner_id.clone(),
                        kind: payload.kind,
                        ok: false,
                        skipped: matches!(error, AppError::NotSupported(_) | AppError::NotFound(_)),
                        message: Some(error.to_string()),
                        remote_id: Some(requested.remote_id.clone()),
                    });
                }
            }
        }

        if run.downloaded > 0 {
            self.store.set_last_pull(now_ms());
        }
        Ok(run.build())
    }

    /// Write one payload where it belongs, or say why it cannot be.
    async fn apply(
        &self,
        payload: &SyncPayload,
        owner_id: &str,
        local: &[SyncItem],
        target: &dyn SyncTarget,
    ) -> Result<String> {
        if !target.owner_exists(owner_id) {
            return Err(AppError::NotFound(format!("owner '{owner_id}'")));
        }

        if payload.kind == SyncKind::Skill || payload.is_directory {
            let install = SkillInstall {
                name: payload.name.clone(),
                files: payload
                    .files
                    .iter()
                    .map(|file| {
                        Ok(SkillInstallFile {
                            path: file.path.clone(),
                            bytes: plan::decode_file(file)?,
                        })
                    })
                    .collect::<Result<Vec<_>>>()?,
            };
            let destination = target.install_skill(owner_id, install).await?;
            return Ok(destination);
        }

        let item = match_local(local, payload).ok_or_else(|| {
            AppError::NotSupported(format!(
                "{} does not declare a file for '{}'",
                owner_id, payload.name
            ))
        })?;
        if !item.editable {
            return Err(AppError::NotSupported(format!(
                "'{}' is read-only",
                item.label
            )));
        }
        let bytes = match payload.files.as_slice() {
            [file] => plan::decode_file(file)?,
            _ => {
                return Err(AppError::InvalidInput(format!(
                    "'{}' is a single file but the cloud copy holds {}",
                    item.label,
                    payload.files.len()
                )))
            }
        };
        target.write_file(owner_id, &item.path, &bytes).await?;
        Ok(item.path.clone())
    }

    /// Remove one cloud copy. The local files are left exactly as they are.
    pub async fn delete_remote(&self, remote_id: &str, confirm: bool) -> Result<SyncRun> {
        if !confirm {
            return Err(AppError::InvalidInput(
                "deleting a cloud copy must be confirmed".to_string(),
            ));
        }
        self.require_enabled()?;
        let provider = self.provider()?;
        let mut run = Run::new(SyncRunKind::Delete);
        match provider.delete(remote_id).await {
            Ok(()) => {
                run.deleted += 1;
                self.store.forget_remote(remote_id);
                self.invalidate_cache();
                run.result(SyncItemResult {
                    name: remote_id.to_string(),
                    owner_id: String::new(),
                    kind: SyncKind::Other,
                    ok: true,
                    skipped: false,
                    message: None,
                    remote_id: Some(remote_id.to_string()),
                });
            }
            Err(error) => {
                run.failed += 1;
                run.result(SyncItemResult {
                    name: remote_id.to_string(),
                    owner_id: String::new(),
                    kind: SyncKind::Other,
                    ok: false,
                    skipped: false,
                    message: Some(error.to_string()),
                    remote_id: Some(remote_id.to_string()),
                });
            }
        }
        Ok(run.build())
    }

    // --- automatic --------------------------------------------------------------------------

    /// Run the automatic set right now, if the module is on and connected.
    ///
    /// Returns `None` when nothing was done (off, manual, no token, or a run already in flight);
    /// an automatic run that fails records its error and is never a failed command.
    pub async fn run_auto(self: &Arc<Self>) -> Option<SyncRun> {
        let settings = self.settings();
        if !settings.enabled || settings.mode != SyncMode::Automatic {
            return None;
        }
        // Nothing leaves the machine without a token; no token, no automatic run.
        self.credentials.token()?;
        let report = self.last_report()?;
        let items = self.automatic_items(&report, &settings);
        if items.is_empty() {
            return None;
        }
        if !self.begin_run() {
            return None;
        }
        let outcome = self
            .upload_inner(items, &settings, SyncRunKind::Automatic, true)
            .await;
        self.finish_run(Some(&outcome));
        outcome.ok()
    }

    /// Start the timer that drives automatic saving. One task per process, started once.
    pub fn spawn_auto(self: &Arc<Self>) {
        if self.auto_started.swap(true, Ordering::SeqCst) {
            return;
        }
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            loop {
                let minutes = service
                    .settings()
                    .auto_interval_minutes
                    .clamp(SyncSettings::MIN_INTERVAL, SyncSettings::MAX_INTERVAL);
                tokio::time::sleep(Duration::from_secs(u64::from(minutes) * 60)).await;
                let _ = service.run_auto().await;
            }
        });
    }

    /// Ask for one automatic run in the background — what a finished scan triggers.
    pub fn request_auto(self: &Arc<Self>) {
        let service = Arc::clone(self);
        tauri::async_runtime::spawn(async move {
            let _ = service.run_auto().await;
        });
    }

    // --- plumbing ---------------------------------------------------------------------------

    fn require_enabled(&self) -> Result<SyncSettings> {
        let settings = self.settings();
        if !settings.enabled {
            return Err(AppError::InvalidInput(
                "cloud sync is switched off".to_string(),
            ));
        }
        Ok(settings)
    }

    fn begin_run(&self) -> bool {
        self.running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }

    fn finish_run(&self, outcome: Option<&Result<SyncRun>>) {
        self.running.store(false, Ordering::SeqCst);
        let (run, error) = match outcome {
            Some(Ok(run)) => {
                self.store.set_error(None);
                (Some(run.clone()), None)
            }
            Some(Err(error)) => {
                self.store.set_error(Some(error.to_string()));
                (None, Some(error.to_string()))
            }
            None => (None, None),
        };
        if let Ok(sink) = self.sink.read() {
            if let Some(sink) = sink.as_ref() {
                if let Some(run) = &run {
                    sink.finished(run, error.as_deref());
                } else if let Some(error) = &error {
                    sink.finished(
                        &Run::new(SyncRunKind::Automatic).build(),
                        Some(error.as_str()),
                    );
                }
            }
        }
    }
}

/// A stored file, read back the way a reader shows it — the same shape, caps and hashing a local
/// file is read with, which is what makes the two sides comparable at all.
fn view_of_payload_file(file: &SyncPayloadFile) -> SyncFileContent {
    let bytes = plan::decode_file(file).unwrap_or_default();
    plan::file_content(&file.path, &bytes)
}

/// Key the state store and the remote matching use: machine-independent, per owner.
fn state_key(owner_id: &str, key: &str) -> String {
    format!("{owner_id}|{key}")
}

/// `true` when an owner is something this machine still has: an installed agent, the shared
/// surface, or a known project. An agent that is not installed has nothing to upload.
fn owner_is_live(report: &ScanReport, owner_id: &str) -> bool {
    if owner_id == SHARED_OWNER_ID {
        return true;
    }
    if crate::domain::is_project_owner(owner_id) {
        return report.projects.project(owner_id).is_some();
    }
    report
        .agent(owner_id)
        .map(|agent| agent.is_installed())
        .unwrap_or(false)
}

/// The local item a payload restores into: the exact key first, then the same base key (the
/// remote record may carry a duplicate suffix this machine gave another file), then the name.
fn match_local<'a>(local: &'a [SyncItem], payload: &SyncPayload) -> Option<&'a SyncItem> {
    local
        .iter()
        .find(|item| item.key == payload.key)
        .or_else(|| {
            let base = plan::base_key_of(&payload.key);
            local
                .iter()
                .find(|item| plan::base_key_of(&item.key) == base)
        })
        .or_else(|| {
            local
                .iter()
                .find(|item| item.name.eq_ignore_ascii_case(&payload.name))
        })
}

/// What a restore would do, per file, with no side effect.
fn build_preview(
    payload: &SyncPayload,
    remote_id: &str,
    owner_id: &str,
    owner_name: &str,
    local: &[SyncItem],
    target: &dyn SyncTarget,
) -> SyncPreview {
    let is_skill = payload.kind == SyncKind::Skill || payload.is_directory;
    let mut files = Vec::with_capacity(payload.files.len());
    let mut blocked: Option<String> = None;
    let mut destination = String::new();

    if is_skill {
        // A skill is refused only when one of that name is *really* there: the report may still
        // list a directory the user removed a moment ago, and `install_skill` would refuse that
        // stale entry for nothing.
        let existing = local
            .iter()
            .find(|item| {
                item.kind == SyncKind::Skill
                    && plan::base_key_of(&item.key) == plan::base_key_of(&payload.key)
            })
            .filter(|item| Path::new(&item.path).is_dir());
        match existing {
            Some(item) => {
                blocked = Some(format!(
                    "a skill named '{}' is already there — remove it first",
                    payload.name
                ));
                destination = item.path.clone();
                for file in &payload.files {
                    let current = std::fs::read(Path::new(&item.path).join(&file.path)).ok();
                    let bytes = plan::decode_file(file).unwrap_or_default();
                    files.push(preview_file(file, current.as_deref(), &bytes));
                }
            }
            None => {
                destination = match target.skills_root(owner_id) {
                    Some(root) => format!("{}/{}", root.trim_end_matches('/'), payload.name),
                    None => payload.name.clone(),
                };
                for file in &payload.files {
                    let bytes = plan::decode_file(file).unwrap_or_default();
                    files.push(preview_file(file, None, &bytes));
                }
            }
        }
    } else {
        match match_local(local, payload) {
            Some(item) => {
                destination = item.path.clone();
                if !item.editable {
                    blocked = Some(format!("'{}' is read-only", item.label));
                }
                let current = std::fs::read(&item.path).ok();
                for file in &payload.files {
                    let bytes = plan::decode_file(file).unwrap_or_default();
                    files.push(preview_file(file, current.as_deref(), &bytes));
                }
                if blocked.is_some() {
                    for file in files.iter_mut() {
                        file.action = SyncFileAction::Blocked;
                    }
                }
            }
            None => {
                blocked = Some(format!(
                    "{owner_id} does not declare a file for '{}'",
                    payload.name
                ));
                for file in &payload.files {
                    let bytes = plan::decode_file(file).unwrap_or_default();
                    files.push(preview_file(file, None, &bytes));
                    if let Some(last) = files.last_mut() {
                        last.action = SyncFileAction::Blocked;
                    }
                }
            }
        }
    }

    SyncPreview {
        remote_id: remote_id.to_string(),
        owner_id: owner_id.to_string(),
        owner_name: owner_name.to_string(),
        kind: payload.kind,
        name: payload.name.clone(),
        label: payload.label.clone(),
        destination,
        is_directory: payload.is_directory,
        can_apply: blocked.is_none(),
        blocked_reason: blocked,
        files,
        remote_hash: payload.hash.clone(),
    }
}

fn preview_file(file: &SyncPayloadFile, current: Option<&[u8]>, bytes: &[u8]) -> SyncPreviewFile {
    let action = plan::file_action(current, bytes);
    let binary = !matches!(file.encoding.as_str(), "utf8");
    let unified = if binary || action == SyncFileAction::Same {
        None
    } else {
        plan::unified_for(current, bytes)
    };
    SyncPreviewFile {
        path: file.path.clone(),
        action,
        size_bytes: bytes.len() as u64,
        binary,
        unified,
    }
}

/// Accumulates one run's counters and per-item results.
struct Run {
    kind: SyncRunKind,
    uploaded: usize,
    downloaded: usize,
    deleted: usize,
    skipped: usize,
    failed: usize,
    results: Vec<SyncItemResult>,
}

impl Run {
    fn new(kind: SyncRunKind) -> Self {
        Self {
            kind,
            uploaded: 0,
            downloaded: 0,
            deleted: 0,
            skipped: 0,
            failed: 0,
            results: Vec::new(),
        }
    }

    fn result(&mut self, result: SyncItemResult) {
        self.results.push(result);
    }

    fn build(self) -> SyncRun {
        SyncRun {
            kind: self.kind,
            uploaded: self.uploaded,
            downloaded: self.downloaded,
            deleted: self.deleted,
            skipped: self.skipped,
            failed: self.failed,
            results: self.results,
            at_ms: now_ms(),
        }
    }
}

/// Read the marker the provider stores, for tests and diagnostics: the document is JSON we own,
/// so a caller that already has the text needs no network.
pub fn payload_from_text(text: &str) -> Result<SyncPayload> {
    let value: Value = serde_json::from_str(text).map_err(|error| AppError::InvalidFormat {
        format: "sync payload",
        path: crate::domain::SYNC_MARKER_FILE.to_string(),
        message: error.to_string(),
    })?;
    plan::decode_marker(&value)
}
