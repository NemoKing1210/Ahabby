//! Outbound proxy configuration, shared by the version checker and install jobs.
//!
//! Ahabby reaches the network in exactly two ways: `reqwest` for "a newer version exists"
//! checks, and package-manager processes for installs and updates. Both read the same
//! [`Proxy`], so a user behind a corporate proxy does not have to configure npm, pip and
//! cargo separately.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{AppError, Result};

/// How Ahabby reaches the network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
#[derive(Default)]
pub enum ProxyMode {
    /// Connect directly and ignore every proxy variable (the default).
    #[default]
    None,
    /// Whatever the environment already provides.
    System,
    /// One proxy URL for everything.
    Manual,
}

/// Environment variables a package manager may honour. All of them are set on install and
/// update jobs, because npm, pip, cargo, curl and brew disagree on both casing and name.
const PROXY_ENV: &[&str] = &[
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
];

/// Variables that would let a request silently bypass a manual proxy.
const BYPASS_ENV: &[&str] = &["NO_PROXY", "no_proxy"];

/// A validated proxy configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Proxy {
    mode: ProxyMode,
    url: Option<String>,
}

impl Default for Proxy {
    fn default() -> Self {
        Self::none()
    }
}

impl Proxy {
    /// Connect directly: proxy variables from the environment are ignored and stripped from
    /// install commands.
    pub fn none() -> Self {
        Self {
            mode: ProxyMode::None,
            url: None,
        }
    }

    /// Leave the environment (and therefore the OS/shell proxy settings) untouched.
    pub fn system() -> Self {
        Self {
            mode: ProxyMode::System,
            url: None,
        }
    }

    /// Route everything through one proxy. The URL is validated here, so a bad value is
    /// rejected while the user is still in Settings.
    pub fn manual(url: &str) -> Result<Self> {
        Ok(Self {
            mode: ProxyMode::Manual,
            url: Some(normalize(url)?),
        })
    }

    pub fn mode(&self) -> ProxyMode {
        self.mode
    }

    /// The manual proxy URL, if any.
    pub fn url(&self) -> Option<&str> {
        self.url.as_deref()
    }

    /// `(name, value)` pairs to inject into a child process. Only manual mode sets any.
    pub fn env_pairs(&self) -> Vec<(&'static str, String)> {
        match &self.url {
            Some(url) => PROXY_ENV.iter().map(|key| (*key, url.clone())).collect(),
            None => Vec::new(),
        }
    }

    /// Variables to drop from a child process so the chosen mode is not overridden by the
    /// inherited environment: the proxy variables in [`ProxyMode::None`], `NO_PROXY` in
    /// [`ProxyMode::Manual`] (otherwise an inherited bypass would win over the manual URL).
    pub fn removed_env(&self) -> &'static [&'static str] {
        match self.mode {
            ProxyMode::None => PROXY_ENV,
            ProxyMode::Manual => BYPASS_ENV,
            ProxyMode::System => &[],
        }
    }
}

/// Trim and validate a proxy URL.
///
/// Only HTTP proxies are accepted: they are what npm, pip, cargo, curl and `reqwest`
/// understand without extra configuration.
fn normalize(raw: &str) -> Result<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::InvalidInput("proxy URL is empty".to_string()));
    }
    let parsed = url::Url::parse(trimmed).map_err(|error| {
        AppError::InvalidInput(format!("'{trimmed}' is not a valid URL: {error}"))
    })?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => {
            return Err(AppError::InvalidInput(format!(
                "proxy scheme '{scheme}' is not supported; use http:// or https://"
            )))
        }
    }
    if parsed.host_str().is_none() {
        return Err(AppError::InvalidInput(format!(
            "proxy URL '{trimmed}' has no host"
        )));
    }
    Ok(parsed.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn no_proxy_is_the_default_and_strips_inherited_proxies() {
        assert_eq!(Proxy::default(), Proxy::none());
        let proxy = Proxy::default();
        assert_eq!(proxy.mode(), ProxyMode::None);
        assert!(proxy.url().is_none());
        assert!(proxy.env_pairs().is_empty());
        assert_eq!(proxy.removed_env(), PROXY_ENV);
    }

    #[test]
    fn system_mode_touches_nothing() {
        let proxy = Proxy::system();
        assert_eq!(proxy.mode(), ProxyMode::System);
        assert!(proxy.url().is_none());
        assert!(proxy.env_pairs().is_empty());
        assert!(proxy.removed_env().is_empty());
    }

    #[test]
    fn manual_mode_sets_every_variant_and_drops_no_proxy() {
        let proxy = Proxy::manual("  http://user:pw@127.0.0.1:7890 ").unwrap();
        assert_eq!(proxy.mode(), ProxyMode::Manual);
        assert_eq!(proxy.url(), Some("http://user:pw@127.0.0.1:7890/"));

        let pairs = proxy.env_pairs();
        assert_eq!(pairs.len(), 6);
        for key in [
            "HTTP_PROXY",
            "HTTPS_PROXY",
            "ALL_PROXY",
            "http_proxy",
            "https_proxy",
            "all_proxy",
        ] {
            let (_, value) = pairs.iter().find(|(name, _)| *name == key).expect(key);
            assert_eq!(value, "http://user:pw@127.0.0.1:7890/");
        }
        assert_eq!(proxy.removed_env(), &["NO_PROXY", "no_proxy"]);
    }

    #[test]
    fn rejects_urls_that_cannot_work() {
        for raw in [
            "",
            "   ",
            "127.0.0.1:7890",
            "socks5://127.0.0.1:1080",
            "ftp://proxy:21",
        ] {
            let error = Proxy::manual(raw).unwrap_err();
            assert_eq!(error.code(), "invalid_input", "accepted '{raw}'");
        }
    }

    #[test]
    fn accepts_https_without_a_port() {
        assert_eq!(
            Proxy::manual("https://proxy.example.com").unwrap().url(),
            Some("https://proxy.example.com/")
        );
    }
}
