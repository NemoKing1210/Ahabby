//! The sync library's cryptography: one password, one key, one sealed document.
//!
//! Ahabby stores the whole cloud library as one document (see [`super::plan::encode_document`]).
//! When a key is held, that document is sealed here before it ever reaches a provider, and nothing
//! else in the app knows how.
//!
//! The rules this module exists to keep:
//!
//! * **One salt per key, and it travels in every document.** The derived key is what the machine
//!   holds, but the salt and the KDF parameters are written into the envelope, so a second machine
//!   given the same password derives the *identical* key and opens the same library. Nothing about
//!   the key has to be synchronized out of band.
//! * **The parameters travel too.** `m`, `t` and `p` are read out of the document rather than
//!   assumed, so strengthening them later cannot orphan a document written today. They are also
//!   bounded before Argon2id runs: a hostile document cannot make the app allocate gigabytes.
//! * **A fresh nonce per seal.** The key is fixed per key, so every seal takes new random bytes;
//!   the nonce, the tag and the ciphertext are one envelope with no second place to keep state.
//! * **The password is never stored, and never verified by comparison.** A wrong key is caught by
//!   the AEAD tag, so there is no verifier to leak and no second source of truth about the key.

use std::sync::LazyLock;

use aes_gcm::aead::rand_core::RngCore as _;
use aes_gcm::aead::{Aead, OsRng, Payload};
use aes_gcm::{Aes256Gcm, KeyInit};
use base64::Engine as _;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::domain::{ENVELOPE_SCHEMA, SYNC_MARKER_FILE};
use crate::error::{AppError, Result};
use crate::platform::file_io::sha256_hex;
use crate::services::sync::plan;

/// Length of the key AES-256-GCM wants.
pub const KEY_LEN: usize = 32;
/// Length of the per-key salt.
pub const SALT_LEN: usize = 16;
/// Length of one AES-GCM nonce.
pub const NONCE_LEN: usize = 12;
/// Version of the envelope's own layout. A newer one is refused rather than guessed at.
pub const ENVELOPE_VERSION: u32 = 1;
/// The only cipher this build writes or accepts.
pub const CIPHER_NAME: &str = "aes-256-gcm";
/// The only key derivation this build writes or accepts.
pub const KDF_NAME: &str = "argon2id";
/// What the sealed bytes are bound to: the app and the document kind, never a secret.
pub const AAD: &[u8] = b"ahabby.sync.v1";

/// The Argon2id parameters, and the bounds a document's own header must stay inside.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KdfParams {
    /// Memory, in KiB.
    pub m: u32,
    /// Passes.
    pub t: u32,
    /// Parallel lanes.
    pub p: u32,
}

impl KdfParams {
    /// 64 MiB, three passes, one lane: a fraction of a second on a desktop, and far past what a
    /// password-guessing farm gets per try.
    pub const DEFAULT: KdfParams = KdfParams {
        m: 65_536,
        t: 3,
        p: 1,
    };
    /// Largest memory a document may ask for, in KiB (1 GiB).
    pub const MAX_M_KIB: u32 = 1_048_576;
    /// Most passes a document may ask for.
    pub const MAX_T: u32 = 16;
    /// Most lanes a document may ask for.
    pub const MAX_P: u32 = 8;

    /// Refuse parameters this build will not run, so a document from anywhere cannot make the app
    /// allocate or spin at its expense.
    pub fn checked(self) -> Result<Self> {
        if self.m > Self::MAX_M_KIB || self.t > Self::MAX_T || self.p > Self::MAX_P {
            return Err(AppError::NotSupported(format!(
                "the document asks for Argon2id m={} t={} p={}, past what this Ahabby runs",
                self.m, self.t, self.p
            )));
        }
        Ok(self)
    }
}

/// What a sealed document says about itself, readable without the key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeHeader {
    pub kid: String,
    pub params: KdfParams,
    pub salt: Vec<u8>,
}

/// The key this machine holds, with the inputs that produced it.
///
/// Built by [`SyncCipher::derive`] when the password is set, or by [`SyncCipher::from_parts`] out
/// of the credentials file, or by [`open_with_password`] when a document's own salt is what the
/// password is derived against.
pub struct SyncCipher {
    key: Zeroizing<[u8; KEY_LEN]>,
    salt: [u8; SALT_LEN],
    params: KdfParams,
}

impl SyncCipher {
    /// Shortest password this app accepts. The rule lives here, and the UI mirrors it.
    pub const MIN_PASSWORD: usize = 8;

    /// Derive a fresh key: a new random salt, the default parameters, one Argon2id run.
    pub fn derive(password: &str) -> Result<Self> {
        let mut salt = [0u8; SALT_LEN];
        OsRng.fill_bytes(&mut salt);
        Self::derive_with(password, &salt, KdfParams::DEFAULT)
    }

    /// Rebuild the key the credentials file remembers.
    pub fn from_parts(key: &[u8], salt: &[u8], params: KdfParams) -> Result<Self> {
        if key.len() != KEY_LEN {
            return Err(AppError::InvalidInput(format!(
                "a stored key must be {KEY_LEN} bytes, not {}",
                key.len()
            )));
        }
        if salt.len() < 8 {
            return Err(AppError::InvalidInput(
                "a stored salt must be at least 8 bytes".to_string(),
            ));
        }
        let mut keyring = Zeroizing::new([0u8; KEY_LEN]);
        keyring.copy_from_slice(key);
        let mut own_salt = [0u8; SALT_LEN];
        let len = salt.len().min(SALT_LEN);
        own_salt[..len].copy_from_slice(&salt[..len]);
        Ok(Self {
            key: keyring,
            salt: own_salt,
            params: params.checked()?,
        })
    }

    /// The key itself, for the credentials file and nothing else.
    pub fn key(&self) -> &[u8] {
        self.key.as_slice()
    }

    pub fn salt(&self) -> &[u8] {
        &self.salt
    }

    pub fn params(&self) -> KdfParams {
        self.params
    }

    /// The key's public name: eight hex characters of its salt's hash. It identifies the key for
    /// humans and for "is this document already mine", and gives away nothing about the key.
    pub fn kid(&self) -> String {
        kid_of(&self.salt)
    }

    /// Seal a document's text into an envelope, as JSON.
    pub fn seal(&self, plaintext: &[u8]) -> Result<String> {
        let mut nonce = [0u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce);
        let cipher = self.engine()?;
        let encrypted = cipher
            .encrypt(
                (&nonce).into(),
                Payload {
                    msg: plaintext,
                    aad: AAD,
                },
            )
            .map_err(|_| AppError::InvalidInput("the document could not be sealed".to_string()))?;
        let envelope = serde_json::json!({
            "schema": ENVELOPE_SCHEMA,
            "app": "ahabby",
            "encrypted": true,
            "enc": {
                "v": ENVELOPE_VERSION,
                "kdf": KDF_NAME,
                "m": self.params.m,
                "t": self.params.t,
                "p": self.params.p,
                "salt": BASE64.encode(self.salt),
                "cipher": CIPHER_NAME,
                "nonce": BASE64.encode(nonce),
                "kid": self.kid(),
            },
            "data": BASE64.encode(encrypted),
        });
        // Readable on purpose: whoever opens the gist sees a document that says what it is, how it
        // was sealed and with which key, instead of one long line they cannot even recognize.
        Ok(serde_json::to_string_pretty(&envelope)?)
    }

    /// Open an envelope this key sealed, or one sealed by the same key on another machine.
    ///
    /// Distinct errors on purpose: an input that is not an envelope, one this build cannot read,
    /// and one whose key does not fit are three different situations for whoever sees them.
    pub fn open(&self, text: &str) -> Result<Vec<u8>> {
        let value: serde_json::Value =
            serde_json::from_str(text).map_err(|error| envelope_error(&error.to_string()))?;
        if !plan::is_envelope(&value) {
            return Err(envelope_error("not an encrypted document"));
        }
        let header = header_from(&value)?;
        if header.kid != self.kid() {
            return Err(AppError::InvalidInput(
                "this document is sealed with a different password or key".to_string(),
            ));
        }
        let nonce = decode_b64(&enc_field(&value, "nonce")?, "nonce")?;
        if nonce.len() != NONCE_LEN {
            return Err(envelope_error("the nonce is not 12 bytes"));
        }
        let data = decode_b64(field(&value, "data")?, "data")?;
        let cipher = self.engine()?;
        cipher
            .decrypt(
                nonce.as_slice().into(),
                Payload {
                    msg: &data,
                    aad: AAD,
                },
            )
            .map_err(|_| {
                AppError::InvalidInput(
                    "this document could not be opened: a different password or key, or damage"
                        .to_string(),
                )
            })
    }

    fn engine(&self) -> Result<Aes256Gcm> {
        Aes256Gcm::new_from_slice(self.key.as_slice())
            .map_err(|_| AppError::InvalidInput("the stored key is not usable".to_string()))
    }

    fn derive_with(password: &str, salt: &[u8], params: KdfParams) -> Result<Self> {
        if password.chars().count() < Self::MIN_PASSWORD {
            return Err(AppError::InvalidInput(format!(
                "the sync password must be at least {} characters",
                Self::MIN_PASSWORD
            )));
        }
        let params = params.checked()?;
        let argon = argon2::Argon2::new(
            argon2::Algorithm::Argon2id,
            argon2::Version::V0x13,
            argon2::Params::new(params.m, params.t, params.p, Some(KEY_LEN)).map_err(|error| {
                AppError::InvalidInput(format!("unusable KDF parameters: {error}"))
            })?,
        );
        let mut key = Zeroizing::new([0u8; KEY_LEN]);
        argon
            .hash_password_into(password.as_bytes(), salt, key.as_mut())
            .map_err(|error| {
                AppError::InvalidInput(format!("the key could not be derived: {error}"))
            })?;
        let mut own_salt = [0u8; SALT_LEN];
        let len = salt.len().min(SALT_LEN);
        own_salt[..len].copy_from_slice(&salt[..len]);
        Ok(Self {
            key,
            salt: own_salt,
            params,
        })
    }
}

impl std::fmt::Debug for SyncCipher {
    /// Never the key, never the salt's bytes: a debug print of a cipher has no business carrying
    /// anything but which key it is.
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SyncCipher")
            .field("kid", &self.kid())
            .field("params", &self.params)
            .finish()
    }
}

/// The base64 alphabet an envelope's three binary fields use.
static BASE64: LazyLock<base64::engine::general_purpose::GeneralPurpose> =
    LazyLock::new(|| base64::engine::general_purpose::STANDARD);

/// Read a document's header without holding its key.
pub fn header_of(text: &str) -> Result<EnvelopeHeader> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|error| envelope_error(&error.to_string()))?;
    if !plan::is_envelope(&value) {
        return Err(envelope_error("not an encrypted document"));
    }
    header_from(&value)
}

/// Derive the key a document was sealed with, from its own salt and parameters, and open it.
///
/// This is the second machine's way in: the document says how it was sealed, the user supplies the
/// password, and the key that comes out is byte-for-byte the sealing machine's.
pub fn open_with_password(password: &str, text: &str) -> Result<(Vec<u8>, SyncCipher)> {
    let header = header_of(text)?;
    let cipher = SyncCipher::derive_with(password, &header.salt, header.params)?;
    let bytes = cipher.open(text)?;
    Ok((bytes, cipher))
}

/// The public name of a key, from its salt alone.
pub fn kid_of(salt: &[u8]) -> String {
    sha256_hex(salt).chars().take(8).collect()
}

fn header_from(value: &serde_json::Value) -> Result<EnvelopeHeader> {
    let enc = value
        .get("enc")
        .and_then(serde_json::Value::as_object)
        .ok_or_else(|| envelope_error("the envelope carries no header"))?;
    let version = enc
        .get("v")
        .and_then(serde_json::Value::as_u64)
        .unwrap_or(0);
    if version != u64::from(ENVELOPE_VERSION) {
        return Err(AppError::NotSupported(format!(
            "envelope version {version} is not one this Ahabby understands ({ENVELOPE_VERSION})"
        )));
    }
    if enc.get("kdf").and_then(serde_json::Value::as_str) != Some(KDF_NAME) {
        return Err(AppError::NotSupported(
            "the document asks for a key derivation this Ahabby does not have".to_string(),
        ));
    }
    if enc.get("cipher").and_then(serde_json::Value::as_str) != Some(CIPHER_NAME) {
        return Err(AppError::NotSupported(
            "the document asks for a cipher this Ahabby does not have".to_string(),
        ));
    }
    let params = KdfParams {
        m: enc
            .get("m")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as u32,
        t: enc
            .get("t")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as u32,
        p: enc
            .get("p")
            .and_then(serde_json::Value::as_u64)
            .unwrap_or(0) as u32,
    }
    .checked()?;
    let salt = decode_b64(
        enc.get("salt")
            .and_then(serde_json::Value::as_str)
            .unwrap_or(""),
        "salt",
    )?;
    if salt.len() < 8 {
        return Err(envelope_error("the salt is too short to be one"));
    }
    let kid = enc
        .get("kid")
        .and_then(serde_json::Value::as_str)
        .unwrap_or("")
        .to_string();
    Ok(EnvelopeHeader { kid, params, salt })
}

fn field<'a>(value: &'a serde_json::Value, name: &str) -> Result<&'a str> {
    value
        .get(name)
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| envelope_error(&format!("the envelope carries no '{name}'")))
}

/// The same, one level in: everything about *how* the document was sealed lives under `enc`.
fn enc_field(value: &serde_json::Value, name: &str) -> Result<String> {
    value
        .get("enc")
        .and_then(|enc| enc.get(name))
        .and_then(serde_json::Value::as_str)
        .map(str::to_string)
        .ok_or_else(|| envelope_error(&format!("the envelope carries no '{name}'")))
}

fn decode_b64(text: &str, what: &str) -> Result<Vec<u8>> {
    BASE64
        .decode(text)
        .map_err(|error| envelope_error(&format!("the {what} is not base64: {error}")))
}

/// Every "this is not a document I can read" failure reads the same way, and none of them is a
/// reason to give up on the rest of the library.
fn envelope_error(message: &str) -> AppError {
    AppError::InvalidFormat {
        format: "sync document",
        path: SYNC_MARKER_FILE.to_string(),
        message: message.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PASSWORD: &str = "correct horse battery";

    fn payload() -> Vec<u8> {
        br#"{"schema":1,"app":"ahabby","items":[{"key":"config|settings.json"}]}"#.to_vec()
    }

    #[test]
    fn a_sealed_document_comes_back_exactly() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        let sealed = cipher.seal(&payload()).unwrap();
        assert!(sealed.contains("\"encrypted\": true"));
        assert!(
            !sealed.contains("settings.json"),
            "the plaintext must not survive"
        );
        assert_eq!(cipher.open(&sealed).unwrap(), payload());
    }

    #[test]
    fn the_same_salt_and_password_derive_the_same_key() {
        let first = SyncCipher::derive(PASSWORD).unwrap();
        let second = SyncCipher::from_parts(first.key(), first.salt(), first.params()).unwrap();
        assert_eq!(first.kid(), second.kid());
        // The second-machine guarantee: what one seals, the other opens.
        assert_eq!(
            second.open(&first.seal(&payload()).unwrap()).unwrap(),
            payload()
        );
    }

    #[test]
    fn a_different_password_is_refused_by_name() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        let sealed = cipher.seal(&payload()).unwrap();
        let other = SyncCipher::derive("a different password").unwrap();
        assert_eq!(other.open(&sealed).unwrap_err().code(), "invalid_input");
    }

    #[test]
    fn a_flipped_byte_is_refused_by_the_tag() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        let mut value: serde_json::Value =
            serde_json::from_str(&cipher.seal(&payload()).unwrap()).unwrap();
        let data = value["data"].as_str().unwrap().to_string();
        let mut bytes = BASE64.decode(&data).unwrap();
        let last = bytes.len() - 1;
        bytes[last] ^= 0x01;
        value["data"] = serde_json::Value::String(BASE64.encode(&bytes));
        let error = cipher
            .open(&serde_json::to_string(&value).unwrap())
            .unwrap_err();
        assert_eq!(error.code(), "invalid_input");
    }

    #[test]
    fn a_document_that_is_not_an_envelope_is_refused() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        let error = cipher
            .open("{\"app\":\"ahabby\",\"schema\":1}")
            .unwrap_err();
        assert_eq!(error.code(), "invalid_format");
    }

    #[test]
    fn a_version_and_a_cipher_we_do_not_know_are_refused() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        for (field, value) in [
            ("v", serde_json::json!(99)),
            ("cipher", serde_json::json!("rot13")),
            ("kdf", serde_json::json!("pbkdf2")),
        ] {
            let mut envelope: serde_json::Value =
                serde_json::from_str(&cipher.seal(&payload()).unwrap()).unwrap();
            envelope["enc"][field] = value;
            let error = cipher
                .open(&serde_json::to_string(&envelope).unwrap())
                .unwrap_err();
            assert_eq!(error.code(), "not_supported", "{field}");
        }
    }

    #[test]
    fn hostile_kdf_parameters_are_refused_before_deriving() {
        let too_much_memory = KdfParams {
            m: 8_000_000,
            t: 3,
            p: 1,
        };
        let too_many_passes = KdfParams {
            m: 65_536,
            t: 1000,
            p: 1,
        };
        assert_eq!(
            too_much_memory.checked().unwrap_err().code(),
            "not_supported"
        );
        assert_eq!(
            too_many_passes.checked().unwrap_err().code(),
            "not_supported"
        );
        assert!(KdfParams::DEFAULT.checked().is_ok());
    }

    #[test]
    fn a_header_is_readable_without_the_key() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        let header = header_of(&cipher.seal(&payload()).unwrap()).unwrap();
        assert_eq!(header.kid, cipher.kid());
        assert_eq!(header.salt, cipher.salt());
        assert_eq!(header.params, KdfParams::DEFAULT);
        assert_eq!(
            header_of("{\"app\":\"ahabby\"}").unwrap_err().code(),
            "invalid_format"
        );
    }

    #[test]
    fn a_password_unlocks_what_another_machine_sealed() {
        let machine_a = SyncCipher::derive(PASSWORD).unwrap();
        let sealed = machine_a.seal(&payload()).unwrap();
        let (bytes, machine_b) = open_with_password(PASSWORD, &sealed).unwrap();
        assert_eq!(bytes, payload());
        assert_eq!(machine_b.kid(), machine_a.kid());
        assert_eq!(machine_b.key(), machine_a.key());
        assert_eq!(
            open_with_password("wrong password", &sealed)
                .unwrap_err()
                .code(),
            "invalid_input"
        );
    }

    #[test]
    fn a_short_or_empty_password_is_refused() {
        for password in ["", "a", "1234567"] {
            assert_eq!(
                SyncCipher::derive(password).unwrap_err().code(),
                "invalid_input",
                "{password:?}"
            );
        }
        assert!(
            SyncCipher::derive(&"x".repeat(100 * 1024)).is_ok(),
            "a long password is allowed"
        );
    }

    #[test]
    fn a_large_document_round_trips() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        let big = vec![b'x'; 4 * 1024 * 1024];
        assert_eq!(cipher.open(&cipher.seal(&big).unwrap()).unwrap(), big);
    }

    #[test]
    fn a_kid_is_eight_hex_characters_and_stable() {
        let cipher = SyncCipher::derive(PASSWORD).unwrap();
        assert_eq!(cipher.kid().len(), 8);
        assert!(cipher.kid().chars().all(|c| c.is_ascii_hexdigit()));
        assert_eq!(cipher.kid(), kid_of(cipher.salt()));
    }
}
