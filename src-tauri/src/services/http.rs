//! The HTTP client the services share.
//!
//! The Hub, the version checker and Ahabby's own browser all leave the machine the same way:
//! through the proxy the user picked in Settings. Keeping that in one place means a proxy change
//! rebuilds one identical client per service, and no service can quietly ignore the setting.
//!
//! Each service still owns its own client *instance*, because the timeout is part of it: a
//! version check that hangs for 25 s would stall the list it feeds, while a repository that
//! answers in 8 s is not necessarily unreachable.

use std::time::Duration;

use tracing::warn;

use crate::domain::{Proxy, ProxyMode};
use crate::error::AppError;

/// A client that times out after `timeout`, follows at most `redirects` hops, and is routed
/// through `proxy`.
pub fn client(proxy: &Proxy, timeout: Duration, redirects: usize) -> reqwest::Client {
    let mut builder = reqwest::Client::builder()
        .user_agent(concat!("Ahabby/", env!("CARGO_PKG_VERSION")))
        .redirect(reqwest::redirect::Policy::limited(redirects))
        .timeout(timeout);
    match proxy.mode() {
        // `reqwest` picks the environment up on its own, so "no proxy" has to be said out loud.
        ProxyMode::None => builder = builder.no_proxy(),
        ProxyMode::System => {}
        ProxyMode::Manual => {
            if let Some(url) = proxy.url() {
                match reqwest::Proxy::all(url) {
                    Ok(configured) => builder = builder.proxy(configured),
                    // Settings validation already rejects bad URLs; a hand-edited file lands here.
                    Err(error) => warn!("ignoring proxy '{url}': {error}"),
                }
            }
        }
    }
    builder.build().unwrap_or_default()
}

/// A failed request as the error the UI shows: a timeout is its own code, not "network".
pub fn network_error(url: &str, error: &reqwest::Error, timeout: Duration) -> AppError {
    if error.is_timeout() {
        AppError::Timeout(timeout.as_secs())
    } else {
        AppError::Network(format!("{url}: {error}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Whatever the proxy setting, a client is built — a broken one would take the whole
    /// feature down with it, and the settings file is user input.
    #[test]
    fn every_proxy_mode_builds_a_client() {
        let manual = Proxy::manual("http://127.0.0.1:8080").expect("a valid proxy URL");
        for proxy in [Proxy::none(), Proxy::system(), manual] {
            let _ = client(&proxy, Duration::from_secs(1), 5);
        }
    }
}
