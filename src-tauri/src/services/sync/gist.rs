//! The GitHub Gist provider: one gist holds the whole library.
//!
//! The gist holds exactly one file, [`SYNC_MARKER_FILE`], whose content is opaque here: a plain
//! document when this machine holds no key, an envelope when it does. Its description is the
//! constant marker, so nothing about the library — not an item's name, not its path — can be read
//! off GitHub without the document's own bytes.
//!
//! Gists written when a library was one gist per item are still readable:
//! [`GistProvider::legacy_text`] hands their marker file over for the migration that collects them.
//! That is the only compatibility this module keeps.
//!
//! The network mapping lives in pure functions ([`parse_account`], [`parse_basics`],
//! [`remote_document`], the request bodies) so the request and response shapes are tested without a
//! server.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;

use super::plan;
use super::{RemoteDocument, RemoteRead, SyncProvider};
use crate::domain::{SyncAccount, SyncProviderId, SYNC_DESCRIPTION_MARKER, SYNC_MARKER_FILE};
use crate::error::{AppError, Result};
use crate::platform::sha256_hex;
use crate::services::http;

/// GitHub's REST root.
const API: &str = "https://api.github.com";
/// How long one gist request may take.
pub const TIMEOUT: Duration = Duration::from_secs(25);
/// How many hops a gist request may take.
pub const MAX_REDIRECTS: usize = 5;
const PER_PAGE: usize = 100;
/// Most gists one listing reads. An account with more than a thousand gists is far past what this
/// feature is for; the library stays reachable by its own id.
const MAX_PAGES: usize = 10;

/// A GitHub Gist is the only provider so far.
pub struct GistProvider {
    client: reqwest::Client,
    token: String,
}

impl GistProvider {
    pub fn new(client: reqwest::Client, token: String) -> Self {
        Self { client, token }
    }

    fn request(&self, method: reqwest::Method, url: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, url)
            .header(reqwest::header::ACCEPT, "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .bearer_auth(&self.token)
    }

    async fn json(&self, response: reqwest::Response, url: &str) -> Result<Value> {
        let response = check(response, url).await?;
        response
            .json::<Value>()
            .await
            .map_err(|error| AppError::Network(format!("{url}: invalid JSON: {error}")))
    }

    /// The full text of a marker file that the API truncated, read through its raw URL.
    async fn raw(&self, url: &str) -> Result<String> {
        let response = self.request(reqwest::Method::GET, url).send().await;
        let response = response.map_err(|error| http::network_error(url, &error, TIMEOUT))?;
        check(response, url)
            .await?
            .text()
            .await
            .map_err(|error| AppError::Network(format!("{url}: {error}")))
    }

    /// The marker file of one gist: inline when GitHub returned it whole, through the raw URL when
    /// it was truncated, and `None` when the gist has no such file at all.
    async fn marker_text(&self, basics: &GistBasics) -> Result<Option<String>> {
        if let Some(content) = &basics.content {
            if !basics.truncated {
                return Ok(Some(content.clone()));
            }
        }
        match &basics.raw_url {
            Some(url) => Ok(Some(self.raw(url).await?)),
            None => Ok(None),
        }
    }

    /// Fetch one gist's own facts.
    async fn basics_of(&self, gist_id: &str) -> Result<GistBasics> {
        let url = format!("{API}/gists/{gist_id}");
        let response = self
            .request(reqwest::Method::GET, &url)
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        parse_basics(&self.json(response, &url).await?)
    }
}

#[async_trait]
impl SyncProvider for GistProvider {
    fn id(&self) -> SyncProviderId {
        SyncProviderId::Gist
    }

    async fn verify(&self) -> Result<SyncAccount> {
        let url = format!("{API}/user");
        let response = self
            .request(reqwest::Method::GET, &url)
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        let mut account = parse_account(&self.json(response, &url).await?)?;
        // One pass over the account: what Ahabby holds is the library plus whatever the layout
        // before it left behind. The service replaces this count once it can read the document.
        let read = self.read().await?;
        account.gists = usize::from(read.document.is_some()) + read.legacy.len();
        Ok(account)
    }

    async fn read(&self) -> Result<RemoteRead> {
        let mut read = RemoteRead::default();
        for page in 1..=MAX_PAGES {
            let url = format!("{API}/gists?per_page={PER_PAGE}&page={page}");
            let response = self
                .request(reqwest::Method::GET, &url)
                .send()
                .await
                .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
            let value = self.json(response, &url).await?;
            let page_items = value
                .as_array()
                .ok_or_else(|| AppError::Network(format!("{url}: expected a list")))?;
            let count = page_items.len();
            for gist in page_items {
                let basics = parse_basics(gist)?;
                if plan::is_document_description(&basics.description) {
                    // The first one wins: a second gist wearing the marker is either a copy the
                    // user made or a leftover, and neither is one this machine should merge.
                    if read.document.is_none() {
                        let text = self.marker_text(&basics).await?.unwrap_or_default();
                        read.document = Some(remote_document(&basics, text));
                    }
                } else if plan::is_our_gist(&basics.description) {
                    read.legacy.push(basics.remote_id.clone());
                }
            }
            if count < PER_PAGE {
                break;
            }
        }
        Ok(read)
    }

    async fn write(&self, text: &str, current: Option<&RemoteDocument>) -> Result<RemoteDocument> {
        match current {
            Some(document) => {
                // The check the whole conflict rule rests on: the cloud is asked what it holds
                // *now*, and a document that moved on since it was read is refused rather than
                // overwritten. The service re-reads, re-applies its changes and tries once more.
                let basics = self.basics_of(&document.remote_id).await?;
                let stored = self.marker_text(&basics).await?.unwrap_or_default();
                if sha256_hex(stored.as_bytes()) != document.hash {
                    // A distinguishable code on purpose: the service catches exactly this one,
                    // re-reads, re-applies its changes and writes once more.
                    return Err(AppError::Stale {
                        path: document.remote_id.clone(),
                    });
                }
                let url = format!("{API}/gists/{}", document.remote_id);
                let body = update_body(text);
                let response = self
                    .request(reqwest::Method::PATCH, &url)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
                let basics = parse_basics(&self.json(response, &url).await?)?;
                Ok(remote_document(&basics, text.to_string()))
            }
            None => {
                let url = format!("{API}/gists");
                let body = create_body(text);
                let response = self
                    .request(reqwest::Method::POST, &url)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
                let basics = parse_basics(&self.json(response, &url).await?)?;
                Ok(remote_document(&basics, text.to_string()))
            }
        }
    }

    async fn replace(&self, text: &str, previous: Option<&str>) -> Result<RemoteDocument> {
        let url = format!("{API}/gists");
        let response = self
            .request(reqwest::Method::POST, &url)
            .json(&create_body(text))
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        let basics = parse_basics(&self.json(response, &url).await?)?;
        let document = remote_document(&basics, text.to_string());
        // Create first, delete second: a cleanup the network swallowed costs a leftover gist, never
        // the library. The old revisions leave with the old gist, which is the point of replacing.
        if let Some(previous) = previous {
            if previous != document.remote_id {
                self.delete(previous).await?;
            }
        }
        Ok(document)
    }

    async fn legacy_text(&self, gist_id: &str) -> Result<Option<String>> {
        let basics = self.basics_of(gist_id).await?;
        self.marker_text(&basics).await
    }

    async fn delete(&self, gist_id: &str) -> Result<()> {
        let url = format!("{API}/gists/{gist_id}");
        let response = self
            .request(reqwest::Method::DELETE, &url)
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        if response.status().as_u16() == 404 {
            // Already gone: deleting a gist the user removed by hand is not a failure.
            return Ok(());
        }
        let _ = check(response, &url).await?;
        Ok(())
    }
}

/// Turn a non-success response into the error the UI shows.
async fn check(response: reqwest::Response, url: &str) -> Result<reqwest::Response> {
    let status = response.status();
    if status.is_success() {
        return Ok(response);
    }
    let body = response.text().await.unwrap_or_default();
    Err(match status.as_u16() {
        401 => AppError::InvalidInput(
            "GitHub rejected the token (401). Check that it is still valid and has the `gist` scope."
                .to_string(),
        ),
        403 => AppError::InvalidInput(format!(
            "GitHub refused the request (403): {}",
            snippet(&body)
        )),
        404 => AppError::NotFound(format!("{url} (404)")),
        422 => AppError::InvalidInput(format!(
            "GitHub rejected the document (422): {}",
            snippet(&body)
        )),
        _ => AppError::Network(format!("{url}: HTTP {status} {}", snippet(&body))),
    })
}

fn snippet(body: &str) -> String {
    let trimmed = body.trim();
    trimmed.chars().take(200).collect()
}

/// The parts of a gist every operation needs.
#[derive(Debug, Clone)]
pub struct GistBasics {
    pub remote_id: String,
    pub description: String,
    pub uri: String,
    pub updated_at_ms: i64,
    /// Inline marker content, when GitHub returned the whole file.
    pub content: Option<String>,
    pub truncated: bool,
    pub raw_url: Option<String>,
    pub size_bytes: u64,
}

/// Read the account out of `GET /user`.
pub fn parse_account(value: &Value) -> Result<SyncAccount> {
    let login = value
        .get("login")
        .and_then(Value::as_str)
        .filter(|login| !login.is_empty())
        .ok_or_else(|| AppError::Network("GitHub answered no account".to_string()))?;
    Ok(SyncAccount {
        provider: SyncProviderId::Gist,
        login: login.to_string(),
        name: value
            .get("name")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .map(str::to_string),
        avatar: value
            .get("avatar_url")
            .and_then(Value::as_str)
            .map(str::to_string),
        gists: 0,
    })
}

/// Read one gist's own facts, marker content included.
pub fn parse_basics(value: &Value) -> Result<GistBasics> {
    let remote_id = value
        .get("id")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::Network("a gist without an id".to_string()))?
        .to_string();
    let marker = value
        .get("files")
        .and_then(|files| files.get(SYNC_MARKER_FILE));
    let content = marker
        .and_then(|file| file.get("content"))
        .and_then(Value::as_str)
        .map(str::to_string);
    let size_bytes = value
        .get("files")
        .and_then(Value::as_object)
        .map(|files| {
            files
                .values()
                .filter_map(|file| file.get("size").and_then(Value::as_u64))
                .sum()
        })
        .unwrap_or(0);
    Ok(GistBasics {
        remote_id,
        description: value
            .get("description")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        uri: value
            .get("html_url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .to_string(),
        updated_at_ms: value
            .get("updated_at")
            .and_then(Value::as_str)
            .map(parse_timestamp)
            .unwrap_or(0),
        truncated: marker
            .and_then(|file| file.get("truncated"))
            .and_then(Value::as_bool)
            .unwrap_or(false),
        raw_url: marker
            .and_then(|file| file.get("raw_url"))
            .and_then(Value::as_str)
            .map(str::to_string),
        content,
        size_bytes,
    })
}

/// RFC 3339 (what the API answers) into epoch milliseconds.
pub fn parse_timestamp(value: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(value)
        .map(|time| time.timestamp_millis())
        .unwrap_or(0)
}

/// The library as the provider sees it: where it lives, when it moved, its text and the hash of
/// that text — which is what the next write hands back as its check.
pub fn remote_document(basics: &GistBasics, text: String) -> RemoteDocument {
    let hash = sha256_hex(text.as_bytes());
    RemoteDocument {
        remote_id: basics.remote_id.clone(),
        uri: basics.uri.clone(),
        updated_at_ms: basics.updated_at_ms,
        text,
        hash,
    }
}

/// The body of a request that creates the library.
pub fn create_body(text: &str) -> Value {
    serde_json::json!({
        "description": SYNC_DESCRIPTION_MARKER,
        "public": false,
        "files": { SYNC_MARKER_FILE: { "content": text } },
    })
}

/// The body of a request that updates it. Only our own file is touched, and only its content: the
/// description is the same constant it has always been, so an update cannot be told from a create
/// by anyone reading the gist.
pub fn update_body(text: &str) -> Value {
    serde_json::json!({
        "description": SYNC_DESCRIPTION_MARKER,
        "files": { SYNC_MARKER_FILE: { "content": text } },
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn account_json() -> Value {
        serde_json::json!({
            "login": "nemo",
            "name": "Nemo King",
            "avatar_url": "https://avatars.example/u/1",
        })
    }

    fn gist_json(id: &str, description: &str) -> Value {
        serde_json::json!({
            "id": id,
            "description": description,
            "html_url": format!("https://gist.github.com/{id}"),
            "updated_at": "2026-10-09T10:00:00Z",
            "files": {
                SYNC_MARKER_FILE: { "size": 120, "content": "{}", "truncated": false }
            }
        })
    }

    #[test]
    fn account_is_read_and_a_missing_login_is_an_error() {
        let account = parse_account(&account_json()).unwrap();
        assert_eq!(account.login, "nemo");
        assert_eq!(account.name.as_deref(), Some("Nemo King"));
        assert!(parse_account(&serde_json::json!({})).is_err());
    }

    #[test]
    fn basics_carry_the_marker_and_the_timestamp() {
        let basics = parse_basics(&gist_json("abc", SYNC_DESCRIPTION_MARKER)).unwrap();
        assert_eq!(basics.remote_id, "abc");
        assert_eq!(basics.description, SYNC_DESCRIPTION_MARKER);
        assert_eq!(basics.uri, "https://gist.github.com/abc");
        assert_eq!(basics.updated_at_ms, 1_791_540_000_000);
        assert_eq!(basics.size_bytes, 120);
        assert!(!basics.truncated);
        assert_eq!(basics.content.as_deref(), Some("{}"));
    }

    #[test]
    fn a_truncated_marker_keeps_its_raw_url() {
        let mut gist = gist_json("abc", SYNC_DESCRIPTION_MARKER);
        gist["files"][SYNC_MARKER_FILE]["truncated"] = serde_json::json!(true);
        gist["files"][SYNC_MARKER_FILE]["content"] = serde_json::json!(null);
        gist["files"][SYNC_MARKER_FILE]["raw_url"] =
            serde_json::json!("https://gist.githubusercontent.com/raw/abc/ahabby.json");
        let basics = parse_basics(&gist).unwrap();
        assert!(basics.truncated);
        assert!(basics.content.is_none());
        assert!(basics.raw_url.is_some());
    }

    #[test]
    fn a_timestamp_without_a_zone_is_not_guessed() {
        assert_eq!(parse_timestamp("2026-10-09T10:00:00Z"), 1_791_540_000_000);
        assert_eq!(parse_timestamp("nonsense"), 0);
    }

    #[test]
    fn the_document_carries_the_hash_of_its_own_text() {
        let basics = parse_basics(&gist_json("abc", SYNC_DESCRIPTION_MARKER)).unwrap();
        let document = remote_document(&basics, "{\"items\":[]}".to_string());
        assert_eq!(document.remote_id, "abc");
        assert_eq!(document.uri, "https://gist.github.com/abc");
        assert_eq!(document.updated_at_ms, 1_791_540_000_000);
        assert_eq!(document.hash, sha256_hex(b"{\"items\":[]}"));
        // The hash is what the next write compares against, so it has to move with the text alone.
        let other = remote_document(&basics, "{\"items\":[1]}".to_string());
        assert_ne!(other.hash, document.hash);
    }

    #[test]
    fn the_bodies_name_one_file_and_the_marker() {
        let create = create_body("{\"schema\":1}");
        assert_eq!(create["public"], serde_json::json!(false));
        assert_eq!(
            create["description"],
            serde_json::json!(SYNC_DESCRIPTION_MARKER)
        );
        assert_eq!(
            create["files"][SYNC_MARKER_FILE]["content"],
            serde_json::json!("{\"schema\":1}")
        );

        let update = update_body("{\"schema\":1}");
        assert!(update.get("public").is_none());
        assert_eq!(
            update["description"],
            serde_json::json!(SYNC_DESCRIPTION_MARKER)
        );
        assert_eq!(
            update["files"][SYNC_MARKER_FILE]["content"],
            serde_json::json!("{\"schema\":1}")
        );
    }

    #[test]
    fn a_gist_is_the_document_only_when_its_description_says_so() {
        assert!(plan::is_document_description(SYNC_DESCRIPTION_MARKER));
        // An old per-item description is ours, and is not the document.
        let old = "[Ahabby] claude-code :: config :: config|settings.json :: 1 :: 512 :: ~/.x";
        assert!(!plan::is_document_description(old));
        assert!(plan::is_our_gist(old));
        assert!(!plan::is_our_gist("just a gist"));
    }
}
