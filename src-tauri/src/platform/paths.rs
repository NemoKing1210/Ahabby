//! Path resolution and `${VAR}` template expansion.
//!
//! Manifests address paths through templates (`${HOME}/.claude/settings.json`,
//! `${APPDATA}/npm`) so that a single catalog works on Windows, macOS and Linux.
//! Expansion is deliberately strict: an unresolvable template yields `None`, which the
//! scanner reports as "not applicable on this OS" instead of inventing a path.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use crate::domain::Os;

/// Snapshot of everything the platform needs to resolve a manifest path.
#[derive(Debug, Clone)]
pub struct PlatformContext {
    pub os: Os,
    pub home: PathBuf,
    /// Ahabby's own data directory (backups, caches).
    pub app_data: PathBuf,
    /// Ahabby's own config directory (`settings.json`, user catalog overrides).
    pub app_config: PathBuf,
    /// Where timestamped backups of user files are stored.
    pub backup_root: PathBuf,
    env: BTreeMap<String, String>,
    /// Extra directories the user added in Settings.
    pub extra_scan_paths: Vec<PathBuf>,
}

impl PlatformContext {
    /// Build a context for the current machine.
    pub fn detect(app_data: PathBuf, app_config: PathBuf, extra_scan_paths: Vec<PathBuf>) -> Self {
        let os = Os::current();
        let env: BTreeMap<String, String> = std::env::vars().collect();
        let home = dirs::home_dir()
            .or_else(|| env.get("USERPROFILE").map(PathBuf::from))
            .or_else(|| env.get("HOME").map(PathBuf::from))
            .unwrap_or_else(|| PathBuf::from("."));
        let backup_root = app_data.join("backups");
        Self {
            os,
            home,
            app_data,
            app_config,
            backup_root,
            env,
            extra_scan_paths,
        }
    }

    /// Deterministic context for tests: no real environment is consulted.
    pub fn for_tests(
        os: Os,
        home: impl AsRef<Path>,
        app_data: impl AsRef<Path>,
        app_config: impl AsRef<Path>,
    ) -> Self {
        let home = home.as_ref().to_path_buf();
        let mut env = BTreeMap::new();
        env.insert("HOME".to_string(), home.to_string_lossy().to_string());
        env.insert(
            "USERPROFILE".to_string(),
            home.to_string_lossy().to_string(),
        );
        env.insert(
            "APPDATA".to_string(),
            home.join("AppData/Roaming").to_string_lossy().to_string(),
        );
        env.insert(
            "LOCALAPPDATA".to_string(),
            home.join("AppData/Local").to_string_lossy().to_string(),
        );
        env.insert(
            "PROGRAMFILES".to_string(),
            home.join("Program Files").to_string_lossy().to_string(),
        );
        Self {
            os,
            home,
            app_data: app_data.as_ref().to_path_buf(),
            backup_root: app_data.as_ref().join("backups"),
            app_config: app_config.as_ref().to_path_buf(),
            env,
            extra_scan_paths: Vec::new(),
        }
    }

    pub fn with_env(mut self, key: impl Into<String>, value: impl Into<String>) -> Self {
        self.env.insert(key.into(), value.into());
        self
    }

    pub fn with_extra_scan_paths(mut self, paths: Vec<PathBuf>) -> Self {
        self.extra_scan_paths = paths;
        self
    }

    pub fn env_var(&self, key: &str) -> Option<&str> {
        self.env.get(key).map(String::as_str)
    }

    /// Resolve one template for the current OS.
    pub fn expand(&self, template: &str) -> Option<PathBuf> {
        expand_template(template, self.os, &self.home, |key| {
            self.env.get(key).cloned()
        })
    }

    /// Expand the manifest path for this OS.
    pub fn expand_map(&self, map: &crate::domain::OsPathMap) -> Option<PathBuf> {
        map.get(self.os).and_then(|template| self.expand(template))
    }
}

/// Expand `${VAR}` / `%VAR%` placeholders and a leading `~`.
///
/// XDG variables fall back to their standard defaults so the same manifest works on a
/// minimal Linux where none of them are exported.
pub fn expand_template<F>(template: &str, os: Os, home: &Path, lookup: F) -> Option<PathBuf>
where
    F: Fn(&str) -> Option<String>,
{
    let template = template.trim();
    if template.is_empty() {
        return None;
    }

    let resolve = |key: &str| -> Option<String> {
        if let Some(value) = lookup(key) {
            if !value.trim().is_empty() {
                return Some(value);
            }
        }
        default_for(key, os, home)
    };

    let mut out = String::with_capacity(template.len() + 32);
    let mut rest = template;

    if template == "~" {
        return Some(home.to_path_buf());
    }
    if let Some(stripped) = template
        .strip_prefix("~/")
        .or_else(|| template.strip_prefix("~\\"))
    {
        out.push_str(&home.to_string_lossy());
        out.push(std::path::MAIN_SEPARATOR);
        rest = stripped;
    }

    let bytes = rest.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        let open_dollar = rest[index..].starts_with("${");
        let open_percent = rest[index..].starts_with('%');

        if open_dollar {
            let end = rest[index + 2..].find('}')? + index + 2;
            let key = &rest[index + 2..end];
            out.push_str(&resolve(key)?);
            index = end + 1;
            continue;
        }
        if open_percent {
            match rest[index + 1..].find('%') {
                Some(offset) => {
                    let end = index + 1 + offset;
                    let key = &rest[index + 1..end];
                    out.push_str(&resolve(key)?);
                    index = end + 1;
                    continue;
                }
                None => return None,
            }
        }

        // Copy one UTF-8 character.
        let ch = rest[index..].chars().next()?;
        out.push(ch);
        index += ch.len_utf8();
    }

    if out.contains("${") || out.contains('%') {
        return None;
    }

    let normalized = if os == Os::Windows {
        out.replace('/', "\\")
    } else {
        out.replace('\\', "/")
    };
    Some(PathBuf::from(normalized))
}

fn default_for(key: &str, os: Os, home: &Path) -> Option<String> {
    let join = |segments: &[&str]| home.join(segments.join("/")).to_string_lossy().to_string();
    let windows_only = |segments: &[&str]| -> Option<String> {
        if os == Os::Windows {
            Some(join(segments))
        } else {
            None
        }
    };
    match key {
        "HOME" | "USERPROFILE" => Some(home.to_string_lossy().to_string()),
        "XDG_CONFIG_HOME" => Some(join(&[".config"])),
        "XDG_DATA_HOME" => Some(join(&[".local", "share"])),
        "XDG_STATE_HOME" => Some(join(&[".local", "state"])),
        "XDG_CACHE_HOME" => Some(join(&[".cache"])),
        "APPDATA" => windows_only(&["AppData", "Roaming"]),
        "LOCALAPPDATA" => windows_only(&["AppData", "Local"]),
        "PROGRAMFILES" => windows_only(&["Program Files"]),
        "PROGRAMDATA" => windows_only(&["ProgramData"]),
        "TMPDIR" | "TEMP" | "TMP" => Some(std::env::temp_dir().to_string_lossy().to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn expand(template: &str, os: Os) -> Option<String> {
        let home = PathBuf::from("/home/tester");
        expand_template(template, os, &home, |key| match key {
            "APPDATA" => Some("/home/tester/AppData/Roaming".to_string()),
            "LOCALAPPDATA" => Some("/home/tester/AppData/Local".to_string()),
            "CUSTOM" => Some("/custom".to_string()),
            _ => None,
        })
        .map(|path| path.to_string_lossy().to_string())
    }

    #[test]
    fn expands_home_and_custom_vars() {
        assert_eq!(
            expand("${HOME}/.claude/settings.json", Os::Linux).unwrap(),
            "/home/tester/.claude/settings.json"
        );
        assert_eq!(
            expand("~/.codex/config.toml", Os::Macos).unwrap(),
            "/home/tester/.codex/config.toml"
        );
        assert_eq!(expand("${CUSTOM}/x", Os::Linux).unwrap(), "/custom/x");
    }

    #[test]
    fn xdg_defaults_apply_when_missing() {
        assert_eq!(
            expand("${XDG_CONFIG_HOME}/opencode/opencode.json", Os::Linux).unwrap(),
            "/home/tester/.config/opencode/opencode.json"
        );
        assert_eq!(
            expand("${XDG_DATA_HOME}/x", Os::Linux).unwrap(),
            "/home/tester/.local/share/x"
        );
    }

    #[test]
    fn windows_style_vars_and_separators() {
        // Every separator is normalised for the target OS, including the ones that came
        // from an expanded variable.
        assert_eq!(
            expand("%APPDATA%/npm/claude.cmd", Os::Windows).unwrap(),
            r"\home\tester\AppData\Roaming\npm\claude.cmd"
        );
    }

    #[test]
    fn unknown_vars_and_partial_templates_fail_closed() {
        assert!(expand("${NOPE}/x", Os::Linux).is_none());
        assert!(expand("${HOME", Os::Linux).is_none());
        assert!(expand("", Os::Linux).is_none());
        assert!(expand("   ", Os::Linux).is_none());
        assert!(expand("%UNCLOSED", Os::Windows).is_none());
    }

    #[test]
    fn context_expands_manifest_map() {
        let context = PlatformContext::for_tests(Os::Linux, "/home/tester", "/data", "/cfg");
        let map = crate::domain::OsPathMap {
            windows: Some("%APPDATA%/x".to_string()),
            macos: None,
            linux: Some("${HOME}/.x".to_string()),
        };
        assert_eq!(
            context.expand_map(&map).unwrap().to_string_lossy(),
            "/home/tester/.x"
        );
        let macos = PlatformContext::for_tests(Os::Macos, "/Users/t", "/data", "/cfg");
        assert!(macos.expand_map(&map).is_none());
    }
}
