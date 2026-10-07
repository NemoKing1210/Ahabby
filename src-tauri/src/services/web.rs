//! The reader behind Ahabby's own browser.
//!
//! Every external link the app opens lands here instead of in the webview. That is the whole
//! point of the module: Ahabby's window never loads a remote origin, so a documentation link
//! cannot navigate the app away, and no third-party page ever runs next to the IPC bridge.
//!
//! What crosses the boundary is *content*, not a page: the HTML is read here (bounded), decoded
//! with the charset it declares, and handed to the frontend, which sanitizes it and renders it
//! with Ahabby's own typography. Images are proxied for the same reason the CSP keeps
//! `img-src 'self' data:` — the reader shows the pictures a page declares without the window
//! ever talking to the site that serves them.
//!
//! Nothing here is trusted input: a URL is user-typed or comes from a third-party file, so the
//! scheme is checked, the length is capped and a body Ahabby cannot display is refused with a
//! code the UI turns into "open it in your browser instead".

use std::sync::RwLock;
use std::time::Duration;

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine as _;
use url::Url;

use crate::domain::{Proxy, WebImage, WebPage, WebPageKind};
use crate::error::{AppError, Result};

use super::http;

/// How long one page may take before the reader says so and offers the browser.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(20);
/// Largest document Ahabby renders. A page that is bigger than this is cut, not refused.
const MAX_PAGE_BYTES: u64 = 3 * 1024 * 1024;
/// Largest image Ahabby will proxy into a `data:` URL.
const MAX_IMAGE_BYTES: u64 = 2 * 1024 * 1024;
/// How many redirects a page may take (a link shortener is fine, a loop is not).
const MAX_REDIRECTS: usize = 5;
/// Bytes of the head that are searched for `<meta charset>`.
const SNIFF_BYTES: usize = 4096;

/// Content types the reader can present as a document.
const PAGE_TYPES: &[&str] = &[
    "text/html",
    "application/xhtml+xml",
    "text/plain",
    "text/markdown",
];

/// The image types the proxy will carry. An allow-list, not `image/*`: a `data:` URL of an
/// unexpected type is a payload the reader would then hand to the renderer.
const IMAGE_TYPES: &[&str] = &[
    "image/png",
    "image/jpeg",
    "image/gif",
    "image/webp",
    "image/avif",
    "image/svg+xml",
    "image/bmp",
    "image/x-icon",
    "image/vnd.microsoft.icon",
];

pub struct WebService {
    client: RwLock<reqwest::Client>,
}

impl WebService {
    /// `proxy` decides how requests leave the machine, exactly as it does for the Hub.
    pub fn new(proxy: &Proxy) -> Self {
        Self {
            client: RwLock::new(http::client(proxy, REQUEST_TIMEOUT, MAX_REDIRECTS)),
        }
    }

    /// Settings changed: a new client, nothing cached to invalidate.
    pub fn set_proxy(&self, proxy: &Proxy) {
        match self.client.write() {
            Ok(mut client) => *client = http::client(proxy, REQUEST_TIMEOUT, MAX_REDIRECTS),
            Err(error) => tracing::warn!("could not rebuild the reader client: {error}"),
        }
    }

    /// Read one page for the reader.
    pub async fn fetch_page(&self, url: &str) -> Result<WebPage> {
        let url = http_url(url)?;
        let response = self
            .http()
            .get(url.as_str())
            .send()
            .await
            .map_err(|error| http::network_error(url.as_str(), &error, REQUEST_TIMEOUT))?;

        // Where the page actually is: a redirect is normal, and every relative link on the page
        // has to be resolved against the address it was read from.
        let final_url = response.url().to_string();
        let status = response.status();
        if !status.is_success() {
            return Err(AppError::Network(format!("{final_url} answered {status}")));
        }
        let content_type = header(&response, reqwest::header::CONTENT_TYPE);
        let media_type = media_type_of(&content_type)
            .ok_or_else(|| AppError::NotSupported(format!("{final_url} is not a web page")))?;
        if !PAGE_TYPES.contains(&media_type.as_str()) {
            return Err(AppError::NotSupported(format!(
                "{final_url} answered {media_type}, which the reader cannot show"
            )));
        }

        let (bytes, truncated) = read_capped(response, MAX_PAGE_BYTES).await?;
        let kind = if media_type == "text/html" || media_type == "application/xhtml+xml" {
            WebPageKind::Html
        } else {
            WebPageKind::Text
        };
        let body = decode(&bytes, &content_type);

        Ok(WebPage {
            url: final_url,
            kind,
            body,
            truncated,
        })
    }

    /// Read one image into a `data:` URL payload.
    pub async fn fetch_image(&self, url: &str) -> Result<WebImage> {
        let url = http_url(url)?;
        let response = self
            .http()
            .get(url.as_str())
            .send()
            .await
            .map_err(|error| http::network_error(url.as_str(), &error, REQUEST_TIMEOUT))?;

        let status = response.status();
        if !status.is_success() {
            return Err(AppError::Network(format!("{url} answered {status}")));
        }
        let content_type = header(&response, reqwest::header::CONTENT_TYPE);
        let media_type = media_type_of(&content_type)
            .ok_or_else(|| AppError::NotSupported(format!("{url} did not say what it sent")))?;
        if !IMAGE_TYPES.contains(&media_type.as_str()) {
            return Err(AppError::NotSupported(format!(
                "{url} is {media_type}, not an image Ahabby shows"
            )));
        }

        let (bytes, _) = read_capped(response, MAX_IMAGE_BYTES).await?;
        Ok(WebImage {
            mime: media_type,
            base64: BASE64.encode(bytes),
        })
    }

    fn http(&self) -> reqwest::Client {
        match self.client.read() {
            Ok(client) => client.clone(),
            Err(error) => {
                tracing::warn!("reader client lock poisoned: {error}");
                http::client(&Proxy::none(), REQUEST_TIMEOUT, MAX_REDIRECTS)
            }
        }
    }
}

/// The URL a reader request is allowed to be: absolute, `http(s)`, with a host.
///
/// Ahabby's window never navigates, so this is the only thing standing between a link in a
/// third-party file and a request from this process: no `file:`, no `javascript:`, no bare
/// path, and credentials in the URL are dropped rather than replayed.
fn http_url(url: &str) -> Result<Url> {
    let trimmed = url.trim();
    let mut parsed = Url::parse(trimmed)
        .map_err(|_| AppError::InvalidInput(format!("'{trimmed}' is not an absolute URL")))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(AppError::InvalidInput(format!(
            "'{}:' links cannot be opened in the reader",
            parsed.scheme()
        )));
    }
    if parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(format!("'{trimmed}' has no host")));
    }
    if !parsed.username().is_empty() || parsed.password().is_some() {
        let _ = parsed.set_username("");
        let _ = parsed.set_password(None);
    }
    Ok(parsed)
}

/// The lowercased media type of a `Content-Type` header, without its parameters.
fn media_type_of(content_type: &str) -> Option<String> {
    let media_type = content_type
        .split(';')
        .next()
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    (!media_type.is_empty()).then_some(media_type)
}

fn header(response: &reqwest::Response, name: reqwest::header::HeaderName) -> String {
    response
        .headers()
        .get(name)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_string()
}

/// Read a body with a ceiling, reporting whether anything was left behind.
///
/// The announced `Content-Length` is third-party input, so the cap is enforced while reading
/// rather than trusted beforehand.
async fn read_capped(mut response: reqwest::Response, limit: u64) -> Result<(Vec<u8>, bool)> {
    let url = response.url().to_string();
    let mut body: Vec<u8> = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|error| http::network_error(&url, &error, REQUEST_TIMEOUT))?
    {
        let room = limit.saturating_sub(body.len() as u64);
        if (chunk.len() as u64) > room {
            body.extend_from_slice(&chunk[..room as usize]);
            return Ok((body, true));
        }
        body.extend_from_slice(&chunk);
    }
    Ok((body, false))
}

/// Decode a body with the charset it declares — in the header, or in a `<meta>` in its head.
///
/// A page that declares nothing Ahabby knows is read as UTF-8 lossily: showing replacement
/// characters for one word is better than refusing a readable document.
fn decode(bytes: &[u8], content_type: &str) -> String {
    let label = charset_in(content_type)
        .or_else(|| sniffed_charset(bytes))
        .unwrap_or_else(|| "utf-8".to_string());
    let encoding = encoding_rs::Encoding::for_label(label.as_bytes()).unwrap_or(encoding_rs::UTF_8);
    let (text, _, _) = encoding.decode(bytes);
    // A BOM that survived the charset is not something the reader should show.
    text.trim_start_matches('\u{feff}').to_string()
}

fn charset_in(content_type: &str) -> Option<String> {
    content_type
        .split(';')
        .skip(1)
        .find_map(|part| part.trim().strip_prefix("charset="))
        .map(|value| value.trim_matches(['"', '\''].as_slice()).to_string())
}

/// `<meta charset="…">` or `<meta http-equiv="content-type" content="…charset=…">`, as written
/// in the first few KB of the document.
fn sniffed_charset(bytes: &[u8]) -> Option<String> {
    let head = String::from_utf8_lossy(&bytes[..bytes.len().min(SNIFF_BYTES)]);
    let lower = head.to_ascii_lowercase();
    let mut rest = lower.as_str();
    while let Some(index) = rest.find("charset=") {
        let after = &rest[index + "charset=".len()..];
        // `charset=utf-8"` in a meta tag, or `charset="utf-8"`.
        let value: String = after
            .trim_start_matches(['"', '\''])
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
            .collect();
        if !value.is_empty() {
            return Some(value);
        }
        rest = after;
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_absolute_http_urls_are_read() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "data:text/html,<script>alert(1)</script>",
            "tauri://localhost/index.html",
            "/relative/path",
            "docs.example.com/page",
            "http://",
        ] {
            assert!(http_url(url).is_err(), "url: {url}");
        }
        assert_eq!(
            http_url("  https://docs.example.com/a?b=1#c  ")
                .unwrap()
                .as_str(),
            "https://docs.example.com/a?b=1#c"
        );
    }

    /// A URL a third-party file put in a link must not carry credentials into the request.
    #[test]
    fn credentials_in_a_url_are_dropped() {
        let url = http_url("https://user:secret@example.com/page").unwrap();
        assert_eq!(url.as_str(), "https://example.com/page");
        assert!(url.password().is_none());
    }

    #[test]
    fn a_media_type_is_read_without_its_parameters() {
        assert_eq!(
            media_type_of("text/html; charset=utf-8").unwrap(),
            "text/html"
        );
        assert_eq!(media_type_of("TEXT/HTML").unwrap(), "text/html");
        assert!(media_type_of("").is_none());
    }

    /// The header is the most authoritative declaration, so it is the one that decodes.
    #[test]
    fn the_declared_charset_wins() {
        let (bytes, _, _) =
            encoding_rs::WINDOWS_1251.encode("<meta charset=\"utf-8\"><p>Привет</p>");
        assert_eq!(
            decode(&bytes, "text/html; charset=windows-1251"),
            "<meta charset=\"utf-8\"><p>Привет</p>"
        );
    }

    /// A Russian page that only declares itself in a `<meta>` tag must not come out as mojibake.
    #[test]
    fn a_charset_in_the_head_is_honoured() {
        let (bytes, _, _) = encoding_rs::WINDOWS_1251
            .encode("<html><head><meta charset=windows-1251></head><body>Привет</body></html>");
        let decoded = decode(&bytes, "text/html");
        assert!(decoded.contains("<body>Привет</body>"), "{decoded}");
    }

    /// Nothing declared: UTF-8 is the only sane guess, and a broken byte must not be fatal.
    #[test]
    fn an_undeclared_charset_falls_back_to_utf8() {
        assert_eq!(
            decode(b"plain\n<body>\xff</body>", "text/html"),
            "plain\n<body>\u{fffd}</body>"
        );
    }

    #[test]
    fn a_bom_is_not_shown() {
        assert_eq!(
            decode("\u{feff}hello".as_bytes(), "text/plain; charset=utf-8"),
            "hello"
        );
    }
}
