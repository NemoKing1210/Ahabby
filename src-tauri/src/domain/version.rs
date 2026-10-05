use std::cmp::Ordering;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use super::manifest::VersionExtract;

/// A version string produced by an agent's CLI, together with the numeric parts
/// we managed to recover from it.
///
/// `raw` is kept verbatim (that is what the UI shows); the numeric parts are only
/// used for "is there an update" comparisons and are allowed to be zero when the
/// CLI prints something exotic — in that case [`Version::comparable`] is `false`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct Version {
    pub raw: String,
    #[ts(type = "number")]
    pub major: u64,
    #[ts(type = "number")]
    pub minor: u64,
    #[ts(type = "number")]
    pub patch: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prerelease: Option<String>,
    /// Whether the numeric parts were recovered from `raw` (and are therefore trustworthy).
    pub comparable: bool,
}

impl Version {
    /// Scan free-form CLI output for the first semver-ish token, e.g.
    /// `"2.0.14 (Claude Code)"` → `2.0.14`, `"codex-cli 0.98.0"` → `0.98.0`, `"v1.2.3"` → `1.2.3`.
    pub fn parse(text: &str) -> Option<Version> {
        let bytes = text.as_bytes();
        let mut index = 0;
        while index < bytes.len() {
            if !bytes[index].is_ascii_digit() {
                index += 1;
                continue;
            }
            if index > 0 {
                let previous = bytes[index - 1];
                // Reject digits glued to an identifier (`abc123`), but allow a `v` prefix.
                if previous.is_ascii_alphanumeric() && previous != b'v' && previous != b'V' {
                    index += 1;
                    continue;
                }
            }
            if let Some(version) = Self::parse_at(text, index) {
                return Some(version);
            }
            index += 1;
        }
        None
    }

    fn parse_at(text: &str, start: usize) -> Option<Version> {
        let bytes = text.as_bytes();
        let mut position = start;
        let mut numbers: Vec<u64> = Vec::new();

        loop {
            let digits_start = position;
            while position < bytes.len() && bytes[position].is_ascii_digit() {
                position += 1;
            }
            let digits = std::str::from_utf8(&bytes[digits_start..position]).ok()?;
            let number: u64 = digits.parse().ok()?;
            numbers.push(number);

            if position + 1 < bytes.len()
                && bytes[position] == b'.'
                && bytes[position + 1].is_ascii_digit()
            {
                position += 1;
                continue;
            }
            break;
        }

        // `major.minor` is the minimum we accept; treat it as `major.minor.0`.
        if numbers.len() < 2 {
            return None;
        }
        let mut prerelease = None;
        let mut cursor = position;

        if cursor < bytes.len() && bytes[cursor] == b'-' {
            let mut scan = cursor + 1;
            while scan < bytes.len()
                && (bytes[scan].is_ascii_alphanumeric()
                    || bytes[scan] == b'.'
                    || bytes[scan] == b'-')
            {
                scan += 1;
            }
            if scan > cursor + 1 {
                prerelease = std::str::from_utf8(&bytes[cursor + 1..scan])
                    .ok()
                    .map(str::to_string);
                cursor = scan;
            }
        }
        // Build metadata is part of `raw` but never part of the ordering.
        if cursor < bytes.len() && bytes[cursor] == b'+' {
            let mut scan = cursor + 1;
            while scan < bytes.len()
                && (bytes[scan].is_ascii_alphanumeric()
                    || bytes[scan] == b'.'
                    || bytes[scan] == b'-')
            {
                scan += 1;
            }
            if scan > cursor + 1 {
                cursor = scan;
            }
        }
        let end = cursor;

        // The token must not run into another identifier (`1.2.3abc` is not a version).
        if end < bytes.len() && (bytes[end].is_ascii_alphanumeric() || bytes[end] == b'.') {
            return None;
        }

        let major = numbers[0];
        let minor = numbers[1];
        let patch = numbers.get(2).copied().unwrap_or(0);

        Some(Version {
            raw: text[start..end].to_string(),
            major,
            minor,
            patch,
            prerelease,
            comparable: true,
        })
    }

    /// Non-comparable version: we show `raw` but cannot order it.
    pub fn opaque(raw: impl Into<String>) -> Version {
        Version {
            raw: raw.into(),
            major: 0,
            minor: 0,
            patch: 0,
            prerelease: None,
            comparable: false,
        }
    }

    /// Apply a manifest's extraction strategy to a CLI's output.
    pub fn from_output(output: &str, extract: VersionExtract) -> Option<Version> {
        let trimmed = output.trim();
        if trimmed.is_empty() {
            return None;
        }
        match extract {
            VersionExtract::Semver => Version::parse(trimmed),
            VersionExtract::Line => {
                let line = trimmed.lines().find(|line| !line.trim().is_empty())?.trim();
                Version::parse(line).or_else(|| Some(Version::opaque(line)))
            }
            VersionExtract::Json => {
                let value: serde_json::Value = serde_json::from_str(trimmed).ok()?;
                let candidate = ["version", "Version", "ver", "latest"]
                    .iter()
                    .find_map(|key| value.get(*key))
                    .or_else(|| value.get("data").and_then(|data| data.get("version")))?;
                match candidate {
                    serde_json::Value::String(text) => {
                        Version::parse(text).or_else(|| Some(Version::opaque(text.clone())))
                    }
                    other => Version::parse(&other.to_string()),
                }
            }
        }
    }

    pub fn to_semver(&self) -> Option<semver::Version> {
        let mut text = format!("{}.{}.{}", self.major, self.minor, self.patch);
        if let Some(pre) = &self.prerelease {
            text.push('-');
            text.push_str(pre);
        }
        semver::Version::parse(&text).ok()
    }

    /// Ordering between two versions. Non-comparable versions are considered equal to
    /// everything but themselves, so a wrong badge is never shown because of a
    /// version string we could not understand.
    pub fn ordering(&self, other: &Version) -> Ordering {
        if !self.comparable || !other.comparable {
            if self.raw == other.raw {
                return Ordering::Equal;
            }
            return Ordering::Equal;
        }
        match (self.to_semver(), other.to_semver()) {
            (Some(left), Some(right)) => left.cmp(&right),
            _ => (self.major, self.minor, self.patch).cmp(&(other.major, other.minor, other.patch)),
        }
    }

    pub fn is_newer_than(&self, other: &Version) -> bool {
        self.ordering(other) == Ordering::Greater
    }
}

impl std::fmt::Display for Version {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.raw)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn parsed(text: &str) -> (u64, u64, u64) {
        let version = Version::parse(text).expect("should parse");
        (version.major, version.minor, version.patch)
    }

    #[test]
    fn parses_real_world_outputs() {
        assert_eq!(parsed("2.0.14 (Claude Code)"), (2, 0, 14));
        assert_eq!(parsed("codex-cli 0.98.0"), (0, 98, 0));
        assert_eq!(parsed("v1.2.3"), (1, 2, 3));
        assert_eq!(parsed("opencode version 0.6.3\nextra"), (0, 6, 3));
        assert_eq!(parsed("gemini 1.0"), (1, 0, 0));
    }

    #[test]
    fn rejects_non_versions() {
        assert!(Version::parse("no version here").is_none());
        assert!(Version::parse("build abc123").is_none());
        assert!(Version::parse("2024-01-05").is_none());
        assert!(Version::parse("").is_none());
    }

    #[test]
    fn keeps_prerelease_and_build_metadata() {
        let version = Version::parse("1.2.3-beta.1+build.7").unwrap();
        assert_eq!(version.prerelease.as_deref(), Some("beta.1"));
        assert_eq!(version.raw, "1.2.3-beta.1+build.7");
    }

    #[test]
    fn compares_semver_aware() {
        let older = Version::parse("1.2.3").unwrap();
        let newer = Version::parse("1.2.4").unwrap();
        assert!(newer.is_newer_than(&older));
        assert!(!older.is_newer_than(&newer));

        let beta = Version::parse("2.0.0-beta.1").unwrap();
        let stable = Version::parse("2.0.0").unwrap();
        assert!(stable.is_newer_than(&beta));
    }

    #[test]
    fn opaque_versions_never_claim_an_update() {
        let opaque = Version::opaque("deadbeef");
        let real = Version::parse("9.9.9").unwrap();
        assert!(!opaque.is_newer_than(&real));
        assert!(!real.is_newer_than(&opaque));
    }

    #[test]
    fn json_extraction() {
        let version = Version::from_output(r#"{"version":"1.4.2"}"#, VersionExtract::Json).unwrap();
        assert_eq!(version.raw, "1.4.2");
        let nested =
            Version::from_output(r#"{"data":{"version":"3.0.0"}}"#, VersionExtract::Json).unwrap();
        assert_eq!(nested.raw, "3.0.0");
        assert!(Version::from_output("not json", VersionExtract::Json).is_none());
    }

    #[test]
    fn line_extraction_keeps_unknown_strings() {
        let version = Version::from_output("nightly-2026-10-05", VersionExtract::Line).unwrap();
        assert!(!version.comparable);
        assert_eq!(version.raw, "nightly-2026-10-05");
    }
}
