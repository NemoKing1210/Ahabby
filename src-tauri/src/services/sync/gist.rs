//! The GitHub Gist provider: where a remote copy actually lives.
//!
//! One gist per item, holding exactly one file ([`SYNC_MARKER_FILE`]) — the item's metadata and
//! its bytes together. The gist's *description* carries the same facts in a compact, parseable
//! form, so a listing costs one request per page instead of one per item; the marker file is what
//! a pull reads, and it is authoritative whenever the two disagree.
//!
//! The network mapping lives in pure functions ([`parse_account`], [`parse_gist`],
//! [`create_body`], …) so the request and response shapes are tested without a server.

use std::time::Duration;

use async_trait::async_trait;
use serde_json::Value;

use super::plan;
use super::SyncProvider;
use crate::domain::{
    RemoteItem, SyncAccount, SyncKind, SyncPayload, SyncProviderId, SYNC_MARKER_FILE,
};
use crate::error::{AppError, Result};
use crate::services::http;

/// GitHub's REST root.
const API: &str = "https://api.github.com";
/// How long one gist request may take.
pub const TIMEOUT: Duration = Duration::from_secs(25);
/// How many hops a gist request may take.
pub const MAX_REDIRECTS: usize = 5;
const PER_PAGE: usize = 100;
/// Most gists one listing reads. A sync account with more than a thousand copies is far past
/// what this feature is for; the rest stay reachable by their own pull.
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

    /// Turn one gist payload into a [`RemoteItem`], fetching the marker file only when the
    /// description cannot be read.
    async fn remote_item(&self, gist: &Value) -> Result<Option<RemoteItem>> {
        let basics = parse_basics(gist)?;
        if !plan::is_our_description(&basics.description) {
            return Ok(None);
        }
        if let Some(described) = plan::parse_gist_description(&basics.description) {
            return Ok(Some(remote_item_of(&basics, &described)));
        }
        // Ours, but the description was cut or hand-edited: the marker file is the authority.
        let Some(payload) = self.payload_of(&basics).await? else {
            return Ok(None);
        };
        Ok(Some(remote_item_of_payload(&basics, &payload)))
    }

    /// The marker document of a gist, inline when GitHub returned it and through the raw URL
    /// when it was truncated.
    async fn payload_of(&self, basics: &GistBasics) -> Result<Option<SyncPayload>> {
        let content = match &basics.content {
            Some(content) if !basics.truncated => content.clone(),
            _ => match &basics.raw_url {
                Some(url) => self.raw(url).await?,
                None => return Ok(None),
            },
        };
        let value: Value =
            serde_json::from_str(&content).map_err(|error| AppError::InvalidFormat {
                format: "sync payload",
                path: basics.remote_id.clone(),
                message: error.to_string(),
            })?;
        Ok(Some(plan::decode_marker(&value)?))
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
        let gists = self.list().await?;
        account.gists = gists.len();
        Ok(account)
    }

    async fn list(&self) -> Result<Vec<RemoteItem>> {
        let mut items = Vec::new();
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
                if let Some(item) = self.remote_item(gist).await? {
                    items.push(item);
                }
            }
            if count < PER_PAGE {
                break;
            }
        }
        items.sort_by_key(|item| std::cmp::Reverse(item.updated_at_ms));
        Ok(items)
    }

    async fn upload(&self, payload: &SyncPayload, existing: Option<&str>) -> Result<RemoteItem> {
        let description = plan::gist_description(payload);
        let (method, url, body) = match existing {
            Some(id) => (
                reqwest::Method::PATCH,
                format!("{API}/gists/{id}"),
                update_body(payload, &description),
            ),
            None => (
                reqwest::Method::POST,
                format!("{API}/gists"),
                create_body(payload, &description),
            ),
        };
        let response = self
            .request(method, &url)
            .json(&body)
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        let value = self.json(response, &url).await?;
        let basics = parse_basics(&value)?;
        Ok(remote_item_of_payload(&basics, payload))
    }

    async fn download(&self, remote_id: &str) -> Result<SyncPayload> {
        let url = format!("{API}/gists/{remote_id}");
        let response = self
            .request(reqwest::Method::GET, &url)
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        let value = self.json(response, &url).await?;
        let basics = parse_basics(&value)?;
        self.payload_of(&basics)
            .await?
            .ok_or_else(|| AppError::InvalidFormat {
                format: "sync payload",
                path: remote_id.to_string(),
                message: format!("the gist holds no {SYNC_MARKER_FILE}"),
            })
    }

    async fn delete(&self, remote_id: &str) -> Result<()> {
        let url = format!("{API}/gists/{remote_id}");
        let response = self
            .request(reqwest::Method::DELETE, &url)
            .send()
            .await
            .map_err(|error| http::network_error(&url, &error, TIMEOUT))?;
        if response.status().as_u16() == 404 {
            // Already gone: deleting a copy the user removed by hand is not a failure.
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

/// Build a remote record out of a parsed description.
pub fn remote_item_of(basics: &GistBasics, described: &plan::DescribedItem) -> RemoteItem {
    RemoteItem {
        remote_id: basics.remote_id.clone(),
        key: described.key.clone(),
        owner_id: described.owner_id.clone(),
        owner_name: described.owner_id.clone(),
        owner_kind: plan::owner_kind(&described.owner_id),
        kind: described.kind,
        name: plan::key_name(&described.key).to_string(),
        label: plan::key_name(&described.key).to_string(),
        relative_path: described.relative_path.clone(),
        is_directory: described.kind == SyncKind::Skill,
        files: described.files,
        size_bytes: described.size_bytes,
        hash: String::new(),
        description: basics.description.clone(),
        uri: basics.uri.clone(),
        updated_at_ms: basics.updated_at_ms,
        has_secrets: false,
    }
}

/// Build a remote record out of the marker document itself (the authority).
pub fn remote_item_of_payload(basics: &GistBasics, payload: &SyncPayload) -> RemoteItem {
    RemoteItem {
        remote_id: basics.remote_id.clone(),
        key: payload.key.clone(),
        owner_id: payload.owner_id.clone(),
        owner_name: payload.owner_name.clone(),
        owner_kind: payload.owner_kind,
        kind: payload.kind,
        name: payload.name.clone(),
        label: payload.label.clone(),
        relative_path: payload.relative_path.clone(),
        is_directory: payload.is_directory,
        files: payload.files.len(),
        size_bytes: plan::payload_size(&payload.files),
        hash: payload.hash.clone(),
        description: plan::gist_description(payload),
        uri: basics.uri.clone(),
        updated_at_ms: if basics.updated_at_ms > 0 {
            basics.updated_at_ms
        } else {
            payload.pushed_at_ms
        },
        has_secrets: payload.has_secrets,
    }
}

/// The body of a create request.
pub fn create_body(payload: &SyncPayload, description: &str) -> Value {
    serde_json::json!({
        "description": description,
        "public": false,
        "files": { SYNC_MARKER_FILE: { "content": marker_text(payload) } },
    })
}

/// The body of an update request. Only our own file is touched: anything the user added to the
/// gist by hand is left where it is.
pub fn update_body(payload: &SyncPayload, description: &str) -> Value {
    serde_json::json!({
        "description": description,
        "files": { SYNC_MARKER_FILE: { "content": marker_text(payload) } },
    })
}

fn marker_text(payload: &SyncPayload) -> String {
    serde_json::to_string_pretty(payload).unwrap_or_else(|_| "{}".to_string())
}

/// `true` for a payload the provider may store: the owner kind must agree with the owner id, so
/// a hand-built document cannot claim a surface it is not.
pub fn payload_is_consistent(payload: &SyncPayload) -> bool {
    plan::owner_kind(&payload.owner_id) == payload.owner_kind
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{SyncOwnerKind, SYNC_SCHEMA};

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
        let basics = parse_basics(&gist_json("abc", "[Ahabby] x")).unwrap();
        assert_eq!(basics.remote_id, "abc");
        assert_eq!(basics.description, "[Ahabby] x");
        assert_eq!(basics.uri, "https://gist.github.com/abc");
        assert_eq!(basics.updated_at_ms, 1_791_540_000_000);
        assert_eq!(basics.size_bytes, 120);
        assert!(!basics.truncated);
        assert_eq!(basics.content.as_deref(), Some("{}"));
    }

    #[test]
    fn a_truncated_marker_keeps_its_raw_url() {
        let mut gist = gist_json("abc", "[Ahabby] x");
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
    fn description_bodies_carry_one_file_and_the_prefix() {
        let payload = sample_payload();
        let description = plan::gist_description(&payload);
        let create = create_body(&payload, &description);
        assert_eq!(create["public"], serde_json::json!(false));
        assert_eq!(create["description"], serde_json::json!(description));
        assert!(create["files"][SYNC_MARKER_FILE]["content"]
            .as_str()
            .unwrap()
            .contains("\"app\": \"ahabby\""));
        let update = update_body(&payload, &description);
        assert!(update.get("public").is_none());
        assert!(update["files"][SYNC_MARKER_FILE]["content"].is_string());
    }

    #[test]
    fn a_remote_item_from_a_description_needs_no_fetch() {
        let payload = sample_payload();
        let description = plan::gist_description(&payload);
        let basics = parse_basics(&gist_json("abc", &description)).unwrap();
        let described = plan::parse_gist_description(&description).unwrap();
        let item = remote_item_of(&basics, &described);
        assert_eq!(item.remote_id, "abc");
        assert_eq!(item.key, payload.key);
        assert_eq!(item.owner_id, "claude-code");
        assert_eq!(item.files, 1);
        assert_eq!(item.size_bytes, plan::payload_size(&payload.files));
        assert_eq!(item.uri, "https://gist.github.com/abc");
        assert_eq!(item.updated_at_ms, 1_791_540_000_000);
    }

    #[test]
    fn a_remote_item_from_the_marker_prefers_the_document() {
        let payload = sample_payload();
        let mut basics = parse_basics(&gist_json("abc", "")).unwrap();
        basics.updated_at_ms = 0;
        let item = remote_item_of_payload(&basics, &payload);
        assert_eq!(item.hash, payload.hash);
        assert_eq!(item.label, payload.label);
        assert_eq!(item.updated_at_ms, payload.pushed_at_ms);
    }

    #[test]
    fn a_foreign_document_is_still_a_consistent_payload_only_for_its_own_owner() {
        let mut payload = sample_payload();
        assert!(payload_is_consistent(&payload));
        payload.owner_id = "project:ab12".to_string();
        payload.owner_kind = SyncOwnerKind::Project;
        assert!(payload_is_consistent(&payload));
    }

    fn sample_payload() -> SyncPayload {
        let files = vec![plan::payload_file("settings.json", b"{\"model\":\"opus\"}")];
        SyncPayload {
            schema: SYNC_SCHEMA,
            app: "ahabby".to_string(),
            kind: SyncKind::Config,
            key: plan::item_key(SyncKind::Config, "settings.json"),
            owner_kind: SyncOwnerKind::Agent,
            owner_id: "claude-code".to_string(),
            owner_name: "Claude Code".to_string(),
            name: "settings.json".to_string(),
            label: "Settings".to_string(),
            relative_path: "~/.claude/settings.json".to_string(),
            is_directory: false,
            hash: plan::payload_hash(&files),
            files,
            pushed_at_ms: 1_760_000_000_000,
            source_path: "/home/u/.claude/settings.json".to_string(),
            app_version: "0.50.0".to_string(),
            os: "linux".to_string(),
            has_secrets: false,
        }
    }
}
