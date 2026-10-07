//! What Ahabby's own browser reads.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// How the reader presents a fetched document.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum WebPageKind {
    /// A document to be sanitized and rendered as markup.
    Html,
    /// `text/plain` and friends: shown as the text it is, never parsed as markup.
    Text,
}

/// One document read for the reader, after redirects.
///
/// The body is the document as the server sent it (decoded, not rewritten): the frontend
/// sanitizes it before it reaches the DOM, so nothing here has to guess what is safe.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct WebPage {
    /// The address the page was actually read from, which is what its relative links resolve to.
    pub url: String,
    pub kind: WebPageKind,
    pub body: String,
    /// True when the document was longer than the reader's ceiling and was cut.
    pub truncated: bool,
}

/// An image carried through the backend, so the window never loads a remote origin.
#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct WebImage {
    pub mime: String,
    pub base64: String,
}
