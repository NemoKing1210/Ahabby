//! Cloud sync: the service that turns the last scan into uploads and restores.
//!
//! The module reads *one* source of truth — the last [`ScanReport`] — for what exists and where a
//! restore may land, and one provider for the remote side. It owns three things and nothing else:
//!
//! * a [`SyncProvider`] behind a trait (only [`gist::GistProvider`] implements it), so a second
//!   cloud is one arm plus one file;
//! * a [`store`] of what was uploaded (for idempotent, self-healing automatic runs) and the
//!   credentials — the token, and the key the document is sealed with;
//! * a reconciliation loop that reads the one document once, merges what changed into it and
//!   writes it back once — the number of items a run covers never changes the number of requests.
//!
//! Uploading is manual by default and may be made automatic per kind and owner; *restoring* is
//! always manual and always goes through [`SyncTarget::write_file`] / [`SyncTarget::install_skill`],
//! which are the app's own path-checked writes — a remote payload never names a path that lands
//! outside a surface the manifest declared.

pub mod crypto;
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
    SyncContentSide, SyncDocument, SyncEncryptionStatus, SyncFileAction, SyncFileContent,
    SyncFileStatus, SyncItem, SyncItemList, SyncItemRef, SyncItemResult, SyncItemStatus, SyncKind,
    SyncMigration, SyncMode, SyncPayload, SyncPayloadFile, SyncPreview, SyncPreviewFile,
    SyncProviderId, SyncPullTarget, SyncRun, SyncRunKind, SyncSettings, SyncStatus,
    SHARED_OWNER_ID, SYNC_DESCRIPTION_MARKER, SYNC_DOCUMENT_SCHEMA, SYNC_MARKER_FILE, SYNC_SCHEMA,
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

/// Largest document a run will write, in bytes.
///
/// The library is one file now, so this is the ceiling above the per-item cap: 25 MiB stays inside
/// what a gist accepts through the web interface, and a bigger read already goes through the
/// file's raw URL. A document that would cross it is refused by name, never truncated.
pub const MAX_DOCUMENT_BYTES: u64 = 25 * 1024 * 1024;

/// What reading a sealed library says when this machine holds no key. One sentence in one place,
/// because a listing, a comparison and a restore all say exactly this.
const LOCKED_LIBRARY: &str = "the cloud library is encrypted — enter the sync password";

/// The cloud's copy of the library: one document, and where it lives.
///
/// The provider never looks inside `text` — it is a payload when this machine holds no key, and an
/// envelope when it does. That is the whole reason the seam is text: a second cloud, or a second
/// way of sealing, changes nothing on this side of it.
#[derive(Debug, Clone)]
pub struct RemoteDocument {
    pub remote_id: String,
    pub uri: String,
    pub updated_at_ms: i64,
    pub text: String,
    /// sha256 of `text`: what a write hands back as the check for the next one.
    pub hash: String,
}

/// What one listing of the account found.
///
/// A reading that costs one pass: the library itself, and the ids of the gists written when a
/// library was one gist per item. The legacy *texts* are not fetched here — that would spend a
/// request per old copy on every listing, and only the migration needs them.
#[derive(Debug, Clone, Default)]
pub struct RemoteRead {
    pub document: Option<RemoteDocument>,
    pub legacy: Vec<String>,
}

/// The cloud, as the service uses it.
#[async_trait]
pub trait SyncProvider: Send + Sync {
    fn id(&self) -> SyncProviderId;
    /// Who the token belongs to, and how much this account holds.
    async fn verify(&self) -> Result<SyncAccount>;
    /// The library this account holds, or an empty reading when it holds none.
    async fn read(&self) -> Result<RemoteRead>;
    /// Create the library, or update it when `current` still matches what is there.
    async fn write(&self, text: &str, current: Option<&RemoteDocument>) -> Result<RemoteDocument>;
    /// Write the library as a fresh document, then delete `previous`, so the revisions of the old
    /// one go with it. What a key change uses: the earlier plaintext must not stay in GitHub's
    /// history.
    async fn replace(&self, text: &str, previous: Option<&str>) -> Result<RemoteDocument>;
    /// The marker file of one gist written in the old layout, as it is on the wire.
    async fn legacy_text(&self, gist_id: &str) -> Result<Option<String>>;
    /// Remove one gist. A missing one is not an error.
    async fn delete(&self, gist_id: &str) -> Result<()>;
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

/// A cached remote listing: the rows one read found, and whether the library behind them is
/// sealed with a key this machine does not hold.
struct RemoteCache {
    at: Instant,
    items: Vec<RemoteItem>,
    locked: bool,
}

/// One reading of the cloud library: the stored document, and the entries it holds.
///
/// `library` is `None` in exactly one case — the text is an envelope and this machine holds no key
/// — which is what "locked" means everywhere above this: an answer, not an error.
struct RemoteLibrary {
    document: RemoteDocument,
    library: Option<SyncDocument>,
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
    /// What the last listing found in the layout this version replaced, so a screen can offer to
    /// collect it without a request of its own.
    legacy: Mutex<Option<SyncMigration>>,
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
            legacy: Mutex::new(None),
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

    /// What the last listing found in the old layout, if anything.
    fn legacy(&self) -> Option<SyncMigration> {
        self.legacy.lock().ok().and_then(|legacy| *legacy)
    }

    /// The key this machine holds, if any.
    ///
    /// One rule, one source of truth: a key held is encryption on, so every write path and the
    /// status screen ask this rather than keeping a flag of their own.
    fn cipher(&self) -> Option<crypto::SyncCipher> {
        self.credentials.encryption()
    }

    /// Whether this machine holds a key — the one state every write path and the screen ask about.
    fn sealed(&self) -> bool {
        self.cipher().is_some()
    }

    /// Whether the library is sealed, and with which key — what the screen shows.
    fn encryption_status(&self) -> SyncEncryptionStatus {
        SyncEncryptionStatus {
            enabled: self.sealed(),
            kid: self.cipher().map(|cipher| cipher.kid()),
        }
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
            encryption: self.encryption_status(),
            // Filled by the listing that finds gists in the old layout; until one has run, there is
            // nothing this machine knows how to collect.
            migration: self.legacy(),
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
    ///
    /// Once the library can be read, the count the account line shows is the number of entries it
    /// holds: "N copies in the cloud" is then about the library, not about the document that
    /// carries it. A locked library, or a read that failed, leaves the provider's own count alone.
    pub async fn verify(&self) -> Result<SyncAccount> {
        let mut account = self.provider()?.verify().await?;
        if let Ok(Some(reading)) = self.read_document().await {
            if let Some(library) = reading.library {
                account.gists = library.items.len();
            }
        }
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
        let (document, payload) = self.entry_of(remote_id).await?;
        Ok(self.payload_content(remote_id, &payload, &document))
    }

    /// One item against its cloud copy: both sides, read the same way, and how they stand.
    pub async fn compare(
        &self,
        report: &ScanReport,
        remote_id: &str,
        owner_id: &str,
    ) -> Result<SyncComparison> {
        let (document, payload) = self.entry_of(remote_id).await?;
        let local_items = plan::items_of(report, Some(&self.home), Some(owner_id));
        let local_item = match_local(&local_items, &payload);

        let cloud = self.payload_content(remote_id, &payload, &document);
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

    /// The reader's view of a stored entry — the same shape a local item is read into, so the two
    /// sides can be compared field by field.
    fn payload_content(
        &self,
        remote_id: &str,
        payload: &SyncPayload,
        document: &RemoteDocument,
    ) -> SyncContent {
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
            // Where the copy is reachable: the one document every entry of it lives in.
            uri: (!document.uri.is_empty()).then(|| document.uri.clone()),
            modified_ms: Some(payload.pushed_at_ms),
        }
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

    // --- the document -------------------------------------------------------------------------

    /// The document as the provider stores it: sealed when this machine holds a key, plain JSON
    /// otherwise. Sealing happens here and nowhere else — a provider only ever sees text.
    fn document_text(&self, document: &SyncDocument) -> Result<String> {
        let text = plan::encode_document(document)?;
        match self.cipher() {
            Some(cipher) => cipher.seal(text.as_bytes()),
            None => Ok(text),
        }
    }

    /// The document a stored text holds. A sealed one this machine holds no key for is refused
    /// with the sentence every locked screen shows.
    fn open_document(&self, text: &str) -> Result<SyncDocument> {
        self.open_text(text)?
            .ok_or_else(|| AppError::InvalidInput(LOCKED_LIBRARY.to_string()))
    }

    /// The same reading, with the locked case as an answer rather than an error: `None` when the
    /// text is an envelope and no key is held. That is the only situation a screen shows a lock
    /// for — a key that does not fit is an error, not a lock.
    fn open_text(&self, text: &str) -> Result<Option<SyncDocument>> {
        let value: Value = serde_json::from_str(text).map_err(|error| AppError::InvalidFormat {
            format: "sync document",
            path: SYNC_MARKER_FILE.to_string(),
            message: error.to_string(),
        })?;
        if !plan::is_envelope(&value) {
            return self.checked_document(text).map(Some);
        }
        let Some(cipher) = self.cipher() else {
            return Ok(None);
        };
        let bytes = cipher.open(text)?;
        let opened = std::str::from_utf8(&bytes).map_err(|error| AppError::InvalidFormat {
            format: "sync document",
            path: SYNC_MARKER_FILE.to_string(),
            message: error.to_string(),
        })?;
        self.checked_document(opened).map(Some)
    }

    /// Read a document and refuse one whose entries are not entries.
    ///
    /// The same consistency a payload is built under, applied to what arrives: every entry has to
    /// agree with its own owner id, so a hand-written document cannot claim a surface it does not
    /// belong to.
    fn checked_document(&self, text: &str) -> Result<SyncDocument> {
        let document = plan::decode_document(text)?;
        for entry in &document.items {
            if !plan::payload_is_consistent(entry) {
                return Err(AppError::InvalidFormat {
                    format: "sync document",
                    path: SYNC_MARKER_FILE.to_string(),
                    message: format!(
                        "the entry '{}' claims an owner kind it does not belong to",
                        entry.key
                    ),
                });
            }
        }
        Ok(document)
    }

    /// Read the cloud's library once and open it when this machine can.
    ///
    /// Never cached: a write pass has to hand back the hash of the text it just read, and a
    /// listing's own 60 seconds live one level up. What the reading found in the layout this
    /// version replaced is remembered here, because every reading of the account counts it.
    async fn read_document(&self) -> Result<Option<RemoteLibrary>> {
        let read = self.provider()?.read().await?;
        self.remember_legacy(&read.legacy);
        let Some(document) = read.document else {
            return Ok(None);
        };
        let library = self.open_text(&document.text)?;
        Ok(Some(RemoteLibrary { document, library }))
    }

    /// The document and the one entry a `remote_id` names.
    ///
    /// A `remote_id` is `<documentId>|<key>` — what a listing row and the state store both carry —
    /// and its key part is what addresses an entry now, because every entry lives in the one
    /// document.
    async fn entry_of(&self, remote_id: &str) -> Result<(RemoteDocument, SyncPayload)> {
        let reading = self
            .read_document()
            .await?
            .ok_or_else(|| AppError::NotFound("the cloud holds no library yet".to_string()))?;
        let library = match reading.library {
            Some(library) => library,
            // The text is an envelope and this machine holds no key: the very case `open_document`
            // refuses, with the sentence every locked screen shows.
            None => self.open_document(&reading.document.text)?,
        };
        let key = entry_key_of(&reading.document.remote_id, remote_id);
        let entry = library
            .items
            .into_iter()
            .find(|entry| entry.key == key)
            .ok_or_else(|| AppError::NotFound(format!("the cloud holds no copy of {remote_id}")))?;
        Ok((reading.document, entry))
    }

    /// An empty library, stamped with who writes it — the document a first write creates.
    fn empty_document(&self) -> SyncDocument {
        let mut document = SyncDocument {
            schema: SYNC_DOCUMENT_SCHEMA,
            app: "ahabby".to_string(),
            ..SyncDocument::default()
        };
        self.stamp(&mut document);
        document
    }

    /// The document-level fields every write refreshes: who wrote this library, and when.
    fn stamp(&self, document: &mut SyncDocument) {
        document.updated_at_ms = now_ms();
        document.app_version = env!("CARGO_PKG_VERSION").to_string();
        document.os = std::env::consts::OS.to_string();
    }

    /// Write a document, and once more if the cloud moved under this run.
    async fn write_document(
        &self,
        document: &SyncDocument,
        current: Option<&RemoteDocument>,
    ) -> Result<RemoteDocument> {
        let text = self.document_text(document)?;
        let entries: Vec<&SyncPayload> = document.items.iter().collect();
        self.write_text(&text, &entries, current).await
    }

    /// Write the text a document became, with the one merge retry.
    ///
    /// The provider refuses a write whose `current` no longer matches what the cloud holds — that
    /// is what the hash in a [`RemoteDocument`] is for. A refusal costs nothing here: the library
    /// is read again, this run's `entries` are laid over the fresh document (a foreign entry this
    /// run does not carry survives; an entry both carry is this run's, which is the newer intent),
    /// and the write is attempted exactly once more. A second refusal is the caller's to report.
    async fn write_text(
        &self,
        text: &str,
        entries: &[&SyncPayload],
        current: Option<&RemoteDocument>,
    ) -> Result<RemoteDocument> {
        let provider = self.provider()?;
        match provider.write(text, current).await {
            Ok(written) => Ok(written),
            Err(AppError::Stale { path }) => {
                let reading = self
                    .read_document()
                    .await?
                    .ok_or(AppError::Stale { path })?;
                let mut merged = reading
                    .library
                    .ok_or_else(|| AppError::InvalidInput(LOCKED_LIBRARY.to_string()))?;
                merge_entries(&mut merged.items, entries);
                self.stamp(&mut merged);
                let text = self.document_text(&merged)?;
                provider.write(&text, Some(&reading.document)).await
            }
            Err(error) => Err(error),
        }
    }

    /// Remember what a reading found in the layout this version replaced, so a screen can offer to
    /// collect it without a request of its own. The item count is the migration's to fill in.
    fn remember_legacy(&self, legacy: &[String]) {
        if let Ok(mut guard) = self.legacy.lock() {
            *guard = (!legacy.is_empty()).then_some(SyncMigration {
                gists: legacy.len(),
                items: 0,
            });
        }
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
                            locked: cache.locked,
                        });
                    }
                }
            }
        }
        let (items, locked) = self.fetch_remote().await?;
        Ok(crate::domain::RemoteList {
            items,
            fetched_at_ms: now_ms(),
            from_cache: false,
            locked,
        })
    }

    /// Read the library once and turn it into the rows the screen shows.
    ///
    /// One read answers the whole list: every field a row shows comes out of its own entry, which
    /// is what one document buys. A sealed library this machine holds no key for is not an error
    /// here — it is `locked` with no rows, and the screen answers that with a lock.
    async fn fetch_remote(&self) -> Result<(Vec<RemoteItem>, bool)> {
        let reading = match self.read_document().await {
            Ok(reading) => reading,
            Err(error) => {
                self.store.set_error(Some(error.to_string()));
                return Err(error);
            }
        };
        let (items, locked) = match reading {
            Some(RemoteLibrary {
                document,
                library: Some(library),
            }) => (rows_of(&document, &library), false),
            Some(RemoteLibrary { library: None, .. }) => (Vec::new(), true),
            None => (Vec::new(), false),
        };
        self.store.set_error(None);
        if let Ok(mut cache) = self.cache.lock() {
            *cache = Some(RemoteCache {
                at: Instant::now(),
                items: items.clone(),
                locked,
            });
        }
        Ok((items, locked))
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
        let mut run = Run::new(kind);
        // One read for the whole run, and the hash it hands back is the one the single write at the
        // end expects: that is what makes a run one read and one write, however many items it
        // covers.
        let reading = self.read_document().await?;
        let current = reading.as_ref().map(|reading| reading.document.clone());
        let mut library = match reading {
            Some(RemoteLibrary {
                library: Some(library),
                ..
            }) => library,
            // Sealed, and no key here: nothing this run decided could be applied without
            // destroying what the document holds, so the run fails rather than writing over it.
            Some(RemoteLibrary { library: None, .. }) => {
                return Err(AppError::InvalidInput(LOCKED_LIBRARY.to_string()))
            }
            None => self.empty_document(),
        };
        let snapshot = self.store.snapshot();
        let mut planned: Vec<(SyncItem, SyncPayload)> = Vec::new();

        for item in items {
            if plan::excluded(&item.relative_path, &settings.exclude_patterns) {
                if automatic {
                    continue;
                }
                run.skipped += 1;
                run.result(result_of(&item, true, true, Some("excluded by a pattern")));
                continue;
            }
            if item.has_secrets && !settings.include_secrets {
                if automatic {
                    continue;
                }
                run.skipped += 1;
                run.result(result_of(
                    &item,
                    true,
                    true,
                    Some("contains secrets — enable 'include secrets'"),
                ));
                continue;
            }
            if !item.exists {
                if automatic {
                    continue;
                }
                run.skipped += 1;
                run.result(result_of(&item, true, true, Some("not on disk")));
                continue;
            }

            let payload = match self.payload_for(&item, settings) {
                Ok(payload) => payload,
                Err(error) => {
                    if automatic {
                        continue;
                    }
                    run.failed += 1;
                    run.result(result_of(&item, false, false, Some(&error.to_string())));
                    continue;
                }
            };

            // "Already up to date" is asked of the library itself now: the same content, recorded
            // as uploaded, and still an entry of the document, is nothing for this run to write.
            let key = state_key(&item.owner_id, &item.key);
            let held = library
                .items
                .iter()
                .any(|entry| entry.owner_id == item.owner_id && entry.key == payload.key);
            if let Some(stored) = snapshot.items.get(&key) {
                if stored.hash == payload.hash && held {
                    if automatic {
                        continue;
                    }
                    run.result(result_of(&item, true, false, Some("already up to date")));
                    continue;
                }
            }

            planned.push((item, payload));
        }

        if planned.is_empty() {
            // Nothing to write at all: an unchanged tree costs its one read and no request.
            return Ok(run.build());
        }

        // Merged by `(owner_id, key)`: an item of this run replaces the entry it is and a new one
        // is appended, so nothing the cloud holds that this run did not touch can be lost.
        for (_, payload) in &planned {
            merge_entry(&mut library.items, payload);
        }
        self.stamp(&mut library);

        // One library, one file: an item too many costs the whole run, so the ceiling is refused
        // before a byte is written and every item this run decided on is reported as the failure
        // it was. Truncating the document instead would lose part of the library silently.
        let text = self.document_text(&library)?;
        if text.len() as u64 > MAX_DOCUMENT_BYTES {
            let message = format!(
                "the library would be {} bytes, above the {MAX_DOCUMENT_BYTES}-byte limit",
                text.len()
            );
            for (item, _) in &planned {
                run.failed += 1;
                run.result(result_of(item, false, false, Some(&message)));
            }
            return Ok(run.build());
        }

        let entries: Vec<&SyncPayload> = planned.iter().map(|(_, payload)| payload).collect();
        match self.write_text(&text, &entries, current.as_ref()).await {
            Ok(written) => {
                for (item, payload) in &planned {
                    let remote_id = entry_id(&written.remote_id, &payload.key);
                    self.store.record(
                        state_key(&item.owner_id, &item.key),
                        StoredItem {
                            remote_id: remote_id.clone(),
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
                        remote_id: Some(remote_id),
                    });
                }
                self.store.set_last_push(now_ms());
                self.invalidate_cache();
            }
            // The write is the whole run's: one failure is every item's, because none of them was
            // saved and the run has no per-item answer to give.
            Err(error) => {
                let message = error.to_string();
                for (item, _) in &planned {
                    run.failed += 1;
                    run.result(result_of(item, false, false, Some(&message)));
                }
            }
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
        let payload = SyncPayload {
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
        };
        // The rule every read of the library applies, applied on the way in too: an entry has to
        // agree with its own owner id, so nothing this machine writes claims a surface it does not
        // belong to.
        if !plan::payload_is_consistent(&payload) {
            return Err(AppError::InvalidInput(format!(
                "'{}' cannot be saved: its owner kind does not match '{}'",
                payload.label, payload.owner_id
            )));
        }
        Ok(payload)
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
        let (_, payload) = self.entry_of(remote_id).await?;
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
        let mut run = Run::new(SyncRunKind::Pull);

        for requested in targets {
            // The copy comes out of the document, one read per restore: a copy the cloud no longer
            // holds is reported as the failure it has always been.
            let payload = match self.entry_of(&requested.remote_id).await {
                Ok((_, payload)) => payload,
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

    /// Remove one cloud entry, and forget it here.
    ///
    /// The library is one document, so this is an edit of it: the entry comes out and the document
    /// is written back. A document left holding nothing is removed whole. The local files are left
    /// exactly as they are.
    pub async fn delete_remote(&self, remote_id: &str, confirm: bool) -> Result<SyncRun> {
        if !confirm {
            return Err(AppError::InvalidInput(
                "deleting a cloud copy must be confirmed".to_string(),
            ));
        }
        self.require_enabled()?;
        let mut run = Run::new(SyncRunKind::Delete);
        let reading = self
            .read_document()
            .await?
            .ok_or_else(|| AppError::NotFound("the cloud holds no library yet".to_string()))?;
        let document = reading.document;
        let mut library = reading
            .library
            .ok_or_else(|| AppError::InvalidInput(LOCKED_LIBRARY.to_string()))?;
        let key = entry_key_of(&document.remote_id, remote_id);
        let index = library
            .items
            .iter()
            .position(|entry| entry.key == key)
            .ok_or_else(|| AppError::NotFound(format!("the cloud holds no copy of {remote_id}")))?;
        let removed = library.items.remove(index);
        self.store
            .forget(&state_key(&removed.owner_id, &removed.key));

        let outcome = if library.items.is_empty() {
            self.provider()?.delete(&document.remote_id).await
        } else {
            self.write_document(&library, Some(&document))
                .await
                .map(|_| ())
        };
        match outcome {
            Ok(()) => {
                run.deleted += 1;
                self.invalidate_cache();
                run.result(SyncItemResult {
                    name: removed.name.clone(),
                    owner_id: removed.owner_id.clone(),
                    kind: removed.kind,
                    ok: true,
                    skipped: false,
                    message: None,
                    remote_id: Some(remote_id.to_string()),
                });
            }
            Err(error) => {
                run.failed += 1;
                run.result(SyncItemResult {
                    name: removed.name.clone(),
                    owner_id: removed.owner_id.clone(),
                    kind: removed.kind,
                    ok: false,
                    skipped: false,
                    message: Some(error.to_string()),
                    remote_id: Some(remote_id.to_string()),
                });
            }
        }
        Ok(run.build())
    }

    /// Delete the whole cloud library and forget every item this machine had recorded.
    ///
    /// This is the forgotten-password path: the document's bytes go with its gist, and the next run
    /// treats every item as new. Refused without an explicit confirmation, like every other
    /// destructive operation.
    pub async fn delete_library(&self, confirm: bool) -> Result<SyncRun> {
        if !confirm {
            return Err(AppError::InvalidInput(
                "deleting the cloud library must be confirmed".to_string(),
            ));
        }
        self.require_enabled()?;
        let provider = self.provider()?;
        let mut run = Run::new(SyncRunKind::Delete);
        if let Some(document) = provider.read().await?.document {
            match provider.delete(&document.remote_id).await {
                Ok(()) => {
                    run.deleted += 1;
                    run.result(SyncItemResult {
                        name: document.remote_id.clone(),
                        owner_id: String::new(),
                        kind: SyncKind::Other,
                        ok: true,
                        skipped: false,
                        message: None,
                        remote_id: Some(document.remote_id),
                    });
                }
                Err(error) => {
                    run.failed += 1;
                    run.result(SyncItemResult {
                        name: document.remote_id.clone(),
                        owner_id: String::new(),
                        kind: SyncKind::Other,
                        ok: false,
                        skipped: false,
                        message: Some(error.to_string()),
                        remote_id: Some(document.remote_id),
                    });
                }
            }
        }
        // The state store only tells the truth while the cloud holds a library: with none left,
        // every record of one is forgotten. A delete that failed keeps them, so the next run can
        // still tell what was uploaded.
        if run.failed == 0 {
            let keys: Vec<String> = self.store.snapshot().items.keys().cloned().collect();
            for key in keys {
                self.store.forget(&key);
            }
            self.invalidate_cache();
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

/// How one entry of the library is addressed: the document it lives in, and the entry's own key.
///
/// The state store and the UI both carry this id, which is what lets a copy be resolved without
/// asking the cloud a second question.
fn entry_id(document_id: &str, key: &str) -> String {
    format!("{document_id}{}{key}", plan::KEY_SEPARATOR)
}

/// The entry key inside a `remote_id` (`<documentId>|<key>`).
///
/// A document's own id carries no separator, so its prefix is what tells the two apart; an id that
/// does not carry it is read as a bare key, which is what a record written before the library was
/// one document holds.
fn entry_key_of<'a>(document_id: &str, remote_id: &'a str) -> &'a str {
    let prefix = format!("{document_id}{}", plan::KEY_SEPARATOR);
    remote_id.strip_prefix(&prefix).unwrap_or(remote_id)
}

/// Lay one entry over a library by `(owner_id, key)`: the same key is replaced by it, and a key the
/// library does not hold is appended to it.
fn merge_entry(target: &mut Vec<SyncPayload>, entry: &SyncPayload) {
    match target
        .iter_mut()
        .find(|held| held.owner_id == entry.owner_id && held.key == entry.key)
    {
        Some(held) => *held = entry.clone(),
        None => target.push(entry.clone()),
    }
}

/// Lay several entries over a library, one by one — the merge a run and a conflict both use.
fn merge_entries(target: &mut Vec<SyncPayload>, entries: &[&SyncPayload]) {
    for entry in entries {
        merge_entry(target, entry);
    }
}

/// One item's line in a run.
fn result_of(item: &SyncItem, ok: bool, skipped: bool, message: Option<&str>) -> SyncItemResult {
    SyncItemResult {
        name: item.name.clone(),
        owner_id: item.owner_id.clone(),
        kind: item.kind,
        ok,
        skipped,
        message: message.map(str::to_string),
        remote_id: None,
    }
}

/// One reading of the library, as the cloud list shows it.
///
/// Every field a row renders comes out of the entry itself — an entry carries the item's whole
/// account — which is what one document buys: a listing costs one request, not one per item.
fn rows_of(document: &RemoteDocument, library: &SyncDocument) -> Vec<RemoteItem> {
    library
        .items
        .iter()
        .map(|entry| remote_item_of(document, entry))
        .collect()
}

/// One entry of the library, as a row of the cloud list.
fn remote_item_of(document: &RemoteDocument, entry: &SyncPayload) -> RemoteItem {
    RemoteItem {
        remote_id: entry_id(&document.remote_id, &entry.key),
        key: entry.key.clone(),
        owner_id: entry.owner_id.clone(),
        owner_name: entry.owner_name.clone(),
        owner_kind: entry.owner_kind,
        kind: entry.kind,
        name: entry.name.clone(),
        label: entry.label.clone(),
        relative_path: entry.relative_path.clone(),
        is_directory: entry.is_directory,
        files: entry.files.len(),
        size_bytes: plan::payload_size(&entry.files),
        hash: entry.hash.clone(),
        // The cloud object's description is the constant marker now, and deliberately so: nothing
        // about this entry can be read off the gist's description any more.
        description: SYNC_DESCRIPTION_MARKER.to_string(),
        uri: document.uri.clone(),
        updated_at_ms: entry.pushed_at_ms,
        has_secrets: entry.has_secrets,
    }
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
///
/// A **plain** marker only: a sealed library is opened by [`SyncService::open_document`], which is
/// the only place that knows which key this machine holds.
pub fn payload_from_text(text: &str) -> Result<SyncPayload> {
    let value: Value = serde_json::from_str(text).map_err(|error| AppError::InvalidFormat {
        format: "sync payload",
        path: crate::domain::SYNC_MARKER_FILE.to_string(),
        message: error.to_string(),
    })?;
    plan::decode_marker(&value)
}
