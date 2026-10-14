//! What the sync module remembers between runs: the push state and the credentials.
//!
//! Two files, deliberately apart from the settings document:
//!
//! * `<app data>/sync/state.json` — which item was uploaded, under which remote id, at which
//!   content hash. This is what makes an automatic run idempotent and self-healing: a file
//!   edited outside Ahabby hashes differently and is uploaded again, an untouched one is not.
//! * `<app config>/sync/credentials.json` — the token and the key the cloud document is sealed
//!   with. The settings document is read and written whole by the frontend, so a secret in it
//!   would be handed to the webview on every settings read; here neither crosses the boundary, and
//!   the UI only ever sees the token's hint.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::{Deserialize, Serialize};
use tracing::warn;

use crate::domain::SyncProviderId;
use crate::error::{AppError, Result};
use crate::platform;
use crate::services::sync::crypto::{KdfParams, SyncCipher};

/// One recorded upload.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoredItem {
    pub remote_id: String,
    /// Content hash that was uploaded — compared against the current one to decide "changed".
    pub hash: String,
    pub synced_at_ms: i64,
    pub files: usize,
}

/// The state file, as a value.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SyncStoreSnapshot {
    /// Keyed by `<ownerId>|<kind>|<name>` — the machine-independent key, never the local path id,
    /// so moving a file within an owner does not orphan its record and duplicate the gist.
    pub items: HashMap<String, StoredItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_push_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_pull_ms: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

/// The on-disk push state.
pub struct SyncStore {
    path: PathBuf,
    inner: Mutex<SyncStoreSnapshot>,
}

impl SyncStore {
    /// Load the state, or start empty. A corrupted file is never fatal: the worst it costs is
    /// one redundant upload.
    pub fn load(app_data: &Path) -> Self {
        let path = app_data.join("sync").join("state.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<SyncStoreSnapshot>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    fn guard(&self) -> MutexGuard<'_, SyncStoreSnapshot> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn persist(&self, snapshot: &SyncStoreSnapshot) {
        if let Some(parent) = self.path.parent() {
            if let Err(error) = std::fs::create_dir_all(parent) {
                warn!("could not create the sync state directory: {error}");
                return;
            }
        }
        let json = match serde_json::to_string_pretty(snapshot) {
            Ok(json) => json,
            Err(error) => {
                warn!("could not serialize the sync state: {error}");
                return;
            }
        };
        if let Err(error) = platform::write_atomic(&self.path, &json, None) {
            warn!("could not persist the sync state: {error}");
        }
    }

    pub fn snapshot(&self) -> SyncStoreSnapshot {
        self.guard().clone()
    }

    pub fn entry(&self, key: &str) -> Option<StoredItem> {
        self.guard().items.get(key).cloned()
    }

    pub fn record(&self, key: String, entry: StoredItem) {
        let mut snapshot = self.guard();
        snapshot.items.insert(key, entry);
        let clone = snapshot.clone();
        drop(snapshot);
        self.persist(&clone);
    }

    pub fn forget(&self, key: &str) {
        let mut snapshot = self.guard();
        let removed = snapshot.items.remove(key).is_some();
        let clone = snapshot.clone();
        drop(snapshot);
        if removed {
            self.persist(&clone);
        }
    }

    pub fn set_last_push(&self, ms: i64) {
        let mut snapshot = self.guard();
        snapshot.last_push_ms = Some(ms);
        let clone = snapshot.clone();
        drop(snapshot);
        self.persist(&clone);
    }

    pub fn set_last_pull(&self, ms: i64) {
        let mut snapshot = self.guard();
        snapshot.last_pull_ms = Some(ms);
        let clone = snapshot.clone();
        drop(snapshot);
        self.persist(&clone);
    }

    pub fn set_error(&self, error: Option<String>) {
        let mut snapshot = self.guard();
        if snapshot.last_error == error {
            return;
        }
        snapshot.last_error = error;
        let clone = snapshot.clone();
        drop(snapshot);
        self.persist(&clone);
    }
}

/// The credential file, as written.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct CredentialsFile {
    provider: SyncProviderId,
    token: String,
    /// The sync encryption key, present exactly when this machine holds one.
    ///
    /// Held as raw JSON rather than as a typed block on purpose: a key block this build cannot read
    /// — written by a newer one, or damaged — must cost the user their *key* at most. Typing it
    /// would fail the whole file's parse and take the token with it, logging them out of the cloud
    /// over a field they cannot even see.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    encryption: Option<serde_json::Value>,
}

/// The key the cloud document is sealed with, as the file holds it: the key itself, the salt it was
/// derived against, and the Argon2id parameters that produced it.
///
/// The password is deliberately not here, and never is. The key is what every seal and every open
/// needs, so keeping the password as well would only add a second secret at rest — one a user is
/// likely to have reused somewhere else — for no capability this app has.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct StoredCipher {
    salt: String,
    m: u32,
    t: u32,
    p: u32,
    key: String,
}

impl StoredCipher {
    fn of(cipher: &SyncCipher) -> Self {
        use base64::Engine as _;
        let params = cipher.params();
        Self {
            salt: base64::engine::general_purpose::STANDARD.encode(cipher.salt()),
            m: params.m,
            t: params.t,
            p: params.p,
            key: base64::engine::general_purpose::STANDARD.encode(cipher.key()),
        }
    }

    fn decode(&self) -> Result<SyncCipher> {
        use base64::Engine as _;
        let standard = base64::engine::general_purpose::STANDARD;
        let salt = standard.decode(&self.salt).map_err(|error| {
            AppError::InvalidInput(format!("the stored salt is not base64: {error}"))
        })?;
        let key = standard.decode(&self.key).map_err(|error| {
            AppError::InvalidInput(format!("the stored key is not base64: {error}"))
        })?;
        SyncCipher::from_parts(
            &key,
            &salt,
            KdfParams {
                m: self.m,
                t: self.t,
                p: self.p,
            },
        )
    }
}

/// The stored credentials: the token, and the key the cloud document is sealed with. The only
/// place either can be read from.
pub struct Credentials {
    path: PathBuf,
    inner: Mutex<CredentialsFile>,
}

impl Credentials {
    pub fn load(app_config: &Path) -> Self {
        let path = app_config.join("sync").join("credentials.json");
        let inner = std::fs::read_to_string(&path)
            .ok()
            .and_then(|raw| serde_json::from_str::<CredentialsFile>(&raw).ok())
            .unwrap_or_default();
        Self {
            path,
            inner: Mutex::new(inner),
        }
    }

    fn guard(&self) -> MutexGuard<'_, CredentialsFile> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// The token, if one is stored.
    pub fn token(&self) -> Option<String> {
        let token = self.guard().token.trim().to_string();
        (!token.is_empty()).then_some(token)
    }

    pub fn provider(&self) -> SyncProviderId {
        self.guard().provider
    }

    /// A short, non-reversible hint the UI may show: first and last four characters.
    pub fn hint(&self) -> Option<String> {
        let token = self.token()?;
        if token.len() <= 8 {
            return Some("…".to_string());
        }
        Some(format!("{}…{}", &token[..4], &token[token.len() - 4..]))
    }

    /// The key this machine holds, if any.
    ///
    /// A block that does not decode reads as absent rather than failing anything: the worst that
    /// costs is asking for the password again, while refusing to start would cost the whole app.
    pub fn encryption(&self) -> Option<SyncCipher> {
        let raw = self.guard().encryption.clone()?;
        let decoded = serde_json::from_value::<StoredCipher>(raw)
            .map_err(AppError::from)
            .and_then(|stored| stored.decode());
        match decoded {
            Ok(cipher) => Some(cipher),
            Err(error) => {
                warn!(
                    "the stored sync key could not be read ({error}); unlock again to replace it"
                );
                None
            }
        }
    }

    /// Remember a key beside the token. Nothing else about the file moves.
    pub fn set_encryption(&self, cipher: &SyncCipher) -> Result<()> {
        let mut snapshot = self.guard();
        snapshot.encryption = Some(serde_json::to_value(StoredCipher::of(cipher))?);
        let file = snapshot.clone();
        drop(snapshot);
        self.write(file)
    }

    /// Forget the key, keeping the token: the file is then what it was before encryption existed.
    pub fn clear_encryption(&self) -> Result<()> {
        let mut snapshot = self.guard();
        if snapshot.encryption.is_none() {
            return Ok(());
        }
        snapshot.encryption = None;
        let file = snapshot.clone();
        drop(snapshot);
        self.write(file)
    }

    pub fn set(&self, provider: SyncProviderId, token: &str) -> Result<()> {
        let token = token.trim().to_string();
        if token.is_empty() {
            return self.clear();
        }
        let mut snapshot = self.guard();
        snapshot.provider = provider;
        snapshot.token = token;
        let file = snapshot.clone();
        drop(snapshot);
        self.write(file)
    }

    /// Forget the connection. The key stays: it belongs to the library in the cloud, not to the
    /// session, and reconnecting the same account should not ask for the password again.
    /// [`Credentials::clear_encryption`] is what forgets the key.
    pub fn clear(&self) -> Result<()> {
        let mut snapshot = self.guard();
        snapshot.provider = SyncProviderId::default();
        snapshot.token = String::new();
        let file = snapshot.clone();
        drop(snapshot);
        self.write(file)
    }

    fn write(&self, file: CredentialsFile) -> Result<()> {
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AppError::InvalidInput("credentials path has no parent".to_string()))?;
        std::fs::create_dir_all(parent).map_err(|error| AppError::io(parent, error))?;
        platform::write_atomic(&self.path, &serde_json::to_string_pretty(&file)?, None)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let _ = std::fs::set_permissions(&self.path, std::fs::Permissions::from_mode(0o600));
        }
        *self.guard() = file;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_round_trips_and_survives_a_corrupted_file() {
        let dir = tempfile::tempdir().unwrap();
        let store = SyncStore::load(dir.path());
        store.record(
            "claude-code|config|settings.json".to_string(),
            StoredItem {
                remote_id: "abc".to_string(),
                hash: "sha256:1".to_string(),
                synced_at_ms: 10,
                files: 1,
            },
        );
        store.set_last_push(42);
        store.set_error(Some("boom".to_string()));

        let reloaded = SyncStore::load(dir.path());
        let entry = reloaded.entry("claude-code|config|settings.json").unwrap();
        assert_eq!(entry.remote_id, "abc");
        assert_eq!(reloaded.snapshot().last_push_ms, Some(42));
        assert_eq!(reloaded.snapshot().last_error.as_deref(), Some("boom"));

        std::fs::write(dir.path().join("sync").join("state.json"), "{not json").unwrap();
        assert!(SyncStore::load(dir.path()).snapshot().items.is_empty());
    }

    #[test]
    fn forgetting_an_item_removes_only_that_record() {
        let dir = tempfile::tempdir().unwrap();
        let store = SyncStore::load(dir.path());
        for key in ["a|config|x", "a|config|y"] {
            store.record(
                key.to_string(),
                StoredItem {
                    remote_id: key.to_string(),
                    hash: "h".to_string(),
                    synced_at_ms: 1,
                    files: 1,
                },
            );
        }
        store.forget("a|config|x");
        assert!(store.entry("a|config|x").is_none());
        assert!(store.entry("a|config|y").is_some());
    }

    #[test]
    fn credentials_mask_themselves_and_clear() {
        let dir = tempfile::tempdir().unwrap();
        let credentials = Credentials::load(dir.path());
        assert!(credentials.token().is_none());
        assert!(credentials.hint().is_none());

        credentials
            .set(SyncProviderId::Gist, "ghp_1234567890abcd")
            .unwrap();
        assert_eq!(credentials.token().as_deref(), Some("ghp_1234567890abcd"));
        assert_eq!(credentials.hint().as_deref(), Some("ghp_…abcd"));

        let reloaded = Credentials::load(dir.path());
        assert_eq!(reloaded.token().as_deref(), Some("ghp_1234567890abcd"));

        reloaded.set(SyncProviderId::Gist, "   ").unwrap();
        assert!(reloaded.token().is_none());
    }

    #[test]
    fn an_encryption_key_round_trips_through_the_credentials_file() {
        use crate::services::sync::crypto::SyncCipher;

        let dir = tempfile::tempdir().unwrap();
        let credentials = Credentials::load(dir.path());
        assert!(credentials.encryption().is_none());

        credentials
            .set(SyncProviderId::Gist, "ghp_1234567890abcd")
            .unwrap();
        let cipher = SyncCipher::derive("a long enough password").unwrap();
        credentials.set_encryption(&cipher).unwrap();

        let reloaded = Credentials::load(dir.path());
        assert_eq!(
            reloaded.token().as_deref(),
            Some("ghp_1234567890abcd"),
            "the token survives a key being written beside it"
        );
        let stored = reloaded.encryption().expect("the key is there");
        assert_eq!(stored.kid(), cipher.kid());
        assert_eq!(stored.key(), cipher.key());

        let raw =
            std::fs::read_to_string(dir.path().join("sync").join("credentials.json")).unwrap();
        assert!(
            !raw.contains("a long enough password"),
            "the password is never written"
        );

        reloaded.clear_encryption().unwrap();
        assert!(Credentials::load(dir.path()).encryption().is_none());
        assert_eq!(
            Credentials::load(dir.path()).token().as_deref(),
            Some("ghp_1234567890abcd")
        );
    }

    #[test]
    fn a_damaged_encryption_block_reads_as_absent() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("sync");
        std::fs::create_dir_all(&path).unwrap();
        for body in [
            r#"{"provider":"gist","token":"t","encryption":{"salt":"zz","m":1,"t":1,"p":1,"key":"zz"}}"#,
            r#"{"provider":"gist","token":"t","encryption":{"salt":"AAAA","m":65536,"t":3,"p":1,"key":"AAAA"}}"#,
            r#"{"provider":"gist","token":"t","encryption":7}"#,
        ] {
            std::fs::write(path.join("credentials.json"), body).unwrap();
            assert!(
                Credentials::load(dir.path()).encryption().is_none(),
                "{body}"
            );
            assert_eq!(
                Credentials::load(dir.path()).token().as_deref(),
                Some("t"),
                "{body}"
            );
        }
    }
}
