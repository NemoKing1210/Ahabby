//! The shell a built-in terminal session runs, and how a command line is typed into it.
//!
//! A session is a *shell* — `cmd.exe`, PowerShell or the user's login shell — and the agent is
//! handed to it the way a terminal hands a command to a shell: as one line written to the PTY.
//! That is deliberate, because it is the only thing that works for every install shape on
//! Windows (npm installs `claude`, `claude.cmd` and `claude.ps1`, and neither of the latter two
//! is an executable `CreateProcess` can run), and it leaves the user at a usable prompt in the
//! right directory once the agent exits.

use std::path::PathBuf;

use crate::domain::Os;

/// How a shell parses a command line, which is all the quoting below depends on.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ShellKind {
    /// `cmd.exe`: double quotes, `%` expansion.
    Cmd,
    /// PowerShell (`powershell.exe` 5.1 and `pwsh` 7+): the `&` call operator.
    PowerShell,
    /// POSIX shells (`sh`, `bash`, `zsh`, `fish`, …): single quotes.
    Posix,
}

/// The shell to start, and the arguments that make it interactive.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ShellSpec {
    pub program: String,
    pub args: Vec<String>,
    pub kind: ShellKind,
}

impl ShellSpec {
    /// The shell as it should be displayed in a tab (`pwsh`, `zsh`, …).
    pub fn label(&self) -> String {
        PathBuf::from(&self.program)
            .file_stem()
            .map(|stem| stem.to_string_lossy().to_string())
            .unwrap_or_else(|| self.program.clone())
    }
}

/// Which shell a session should start on this platform.
///
/// `path_lookup` is a lookup of "is this binary on PATH" — `platform::which` in production, a
/// stub in tests, so the choice is testable without depending on the machine.
pub fn default_shell(os: Os, path_lookup: &dyn Fn(&str) -> Option<PathBuf>) -> ShellSpec {
    let program = match os {
        // PowerShell is preferred over `cmd.exe` because it can run every shim shape npm
        // produces (`& claude.cmd`, `& claude.ps1`, `claude`), while `cmd.exe` cannot run a
        // `.ps1` at all.
        Os::Windows => ["pwsh", "powershell"]
            .iter()
            .find_map(|candidate| path_lookup(candidate))
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_else(|| std::env::var("ComSpec").unwrap_or_else(|_| "cmd.exe".to_string())),
        _ => {
            // The user's own login shell, so their `PATH` and aliases are in place once the
            // agent exits — the agent itself is started by absolute path, so it does not need
            // them. Without `$SHELL` the first shell on `PATH` wins, then `/bin/sh`.
            std::env::var("SHELL")
                .ok()
                .filter(|value| !value.trim().is_empty())
                .or_else(|| {
                    ["bash", "zsh", "fish", "sh"]
                        .iter()
                        .find_map(|candidate| path_lookup(candidate))
                        .map(|path| path.to_string_lossy().to_string())
                })
                .unwrap_or_else(|| "/bin/sh".to_string())
        }
    };
    spec_for(program)
}

/// The interactive invocation for a shell program.
///
/// The kind follows the *program*, not the platform: a user may have set `$SHELL` to something
/// unusual, and the quoting and the arguments have to match it.
pub fn spec_for(program: String) -> ShellSpec {
    let kind = kind_of(&program);
    ShellSpec {
        args: match kind {
            // A login shell for POSIX: the user's environment is what they expect at a prompt.
            ShellKind::Posix => vec!["-l".to_string()],
            ShellKind::PowerShell => vec!["-NoLogo".to_string()],
            ShellKind::Cmd => Vec::new(),
        },
        program,
        kind,
    }
}

/// The shell kind a program path implies — used when the user's own `$SHELL` is something
/// unusual and the quoting has to follow the program rather than the platform.
pub fn kind_of(program: &str) -> ShellKind {
    let stem = PathBuf::from(program)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    match stem.as_str() {
        "cmd" => ShellKind::Cmd,
        "powershell" | "pwsh" => ShellKind::PowerShell,
        _ => ShellKind::Posix,
    }
}

/// The environment variables a PTY session needs so the program inside it believes it is talking
/// to a real terminal.
///
/// A desktop application inherits no `TERM` — the launcher that started it has none — and a CLI
/// that reads `TERM=dumb` (or an empty one) drops its colours, its box drawing, or refuses to
/// start at all; a full-screen agent is exactly such a program. The values are the ones VS Code's
/// integrated terminal uses on every platform, which is what a program written against a modern
/// terminal expects to find.
///
/// `current` reports what the session's own environment already says, so these are defaults: a
/// user who exports `TERM` in their shell keeps it, and only a missing (or `dumb`) value is
/// replaced.
pub fn terminal_env(current: &dyn Fn(&str) -> Option<String>) -> Vec<(&'static str, &'static str)> {
    let mut vars = Vec::new();
    let term = current("TERM").unwrap_or_default();
    if term.trim().is_empty() || term.trim().eq_ignore_ascii_case("dumb") {
        vars.push(("TERM", "xterm-256color"));
    }
    if current("COLORTERM")
        .map(|value| value.trim().is_empty())
        .unwrap_or(true)
    {
        vars.push(("COLORTERM", "truecolor"));
    }
    vars
}

/// A program plus arguments as one line for `kind`, quoted so the shell runs it verbatim.
///
/// The program is an absolute path resolved by the scan, so quoting only has to survive the
/// user's own file names: spaces, quotes and the shell's own metacharacters.
pub fn quote_command(kind: ShellKind, program: &str, args: &[String]) -> String {
    match kind {
        ShellKind::Cmd => {
            let mut line = quote_cmd(program);
            for arg in args {
                line.push(' ');
                line.push_str(&quote_cmd(arg));
            }
            line
        }
        ShellKind::PowerShell => {
            // The call operator is required for a quoted path: `& "C:\…\claude.cmd"`.
            let mut line = format!("& {}", quote_powershell(program));
            for arg in args {
                line.push(' ');
                line.push_str(&quote_powershell(arg));
            }
            line
        }
        ShellKind::Posix => {
            let mut line = quote_posix(program);
            for arg in args {
                line.push(' ');
                line.push_str(&quote_posix(arg));
            }
            line
        }
    }
}

/// `cmd.exe`: `"…"` is enough for a program path, and an embedded quote is doubled.
/// `%VAR%` expansion inside quotes is a known limitation; a file name containing `%` is not
/// a case worth mangling every other path for.
fn quote_cmd(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

/// PowerShell: single quotes do not interpolate; a literal quote is doubled.
fn quote_powershell(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

/// POSIX: single quotes do not interpolate; a literal quote is `'\''`.
fn quote_posix(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn found(name: &str) -> Option<PathBuf> {
        match name {
            "pwsh" => Some(PathBuf::from("/usr/bin/pwsh")),
            other => Some(PathBuf::from(format!("/usr/bin/{other}"))),
        }
    }

    #[test]
    fn windows_prefers_powershell_and_honours_a_missing_one() {
        let spec = default_shell(Os::Windows, &found);
        assert_eq!(spec.program, "/usr/bin/pwsh");
        assert_eq!(spec.kind, ShellKind::PowerShell);
        assert_eq!(spec.args, vec!["-NoLogo".to_string()]);

        let none = |_: &str| None;
        let spec = default_shell(Os::Windows, &none);
        assert_eq!(spec.kind, ShellKind::Cmd);
        assert!(spec.program.to_ascii_lowercase().contains("cmd"));
    }

    #[test]
    fn unix_uses_the_login_shell_and_falls_back_to_a_found_one() {
        let previous = std::env::var("SHELL").ok();
        // `SHELL` is process-global, so the assertion tolerates whatever it is set to on this
        // machine; what must hold either way is the invocation shape below.
        let spec = default_shell(Os::Linux, &found);
        if let Some(shell) = previous.filter(|value| !value.trim().is_empty()) {
            assert_eq!(spec.program, shell);
        } else {
            // Without `$SHELL`, the first shell found on `PATH` wins — not the `/bin/sh` last
            // resort, which is only reached when nothing is on `PATH` at all.
            assert_eq!(spec.program, "/usr/bin/bash");
        }
    }

    #[test]
    fn the_invocation_follows_the_program_not_the_platform() {
        // What `$SHELL` happens to point at decides the arguments and the quoting, so a
        // PowerShell user gets `-NoLogo` and the call operator even on Linux.
        let pwsh = spec_for("/usr/bin/pwsh".to_string());
        assert_eq!(pwsh.kind, ShellKind::PowerShell);
        assert_eq!(pwsh.args, vec!["-NoLogo".to_string()]);

        let zsh = spec_for("/bin/zsh".to_string());
        assert_eq!(zsh.kind, ShellKind::Posix);
        assert_eq!(zsh.args, vec!["-l".to_string()]);

        let fish = spec_for("/usr/bin/fish".to_string());
        assert_eq!(fish.kind, ShellKind::Posix);

        let cmd = spec_for(r"C:\Windows\System32\cmd.exe".to_string());
        assert_eq!(cmd.kind, ShellKind::Cmd);
        assert!(cmd.args.is_empty());
        assert_eq!(cmd.label(), "cmd");
    }

    #[test]
    fn shell_kind_follows_the_program_name() {
        assert_eq!(kind_of("/usr/bin/pwsh"), ShellKind::PowerShell);
        assert_eq!(kind_of("C:/Windows/System32/cmd.exe"), ShellKind::Cmd);
        assert_eq!(kind_of("/bin/zsh"), ShellKind::Posix);
    }

    #[test]
    fn commands_are_quoted_for_each_shell() {
        let args = vec!["--foo bar".to_string()];

        assert_eq!(
            quote_command(ShellKind::Cmd, r"C:\Program Files\node\claude.cmd", &args),
            r#""C:\Program Files\node\claude.cmd" "--foo bar""#
        );
        assert_eq!(
            quote_command(ShellKind::PowerShell, r"C:\Program Files\claude.cmd", &args),
            r"& 'C:\Program Files\claude.cmd' '--foo bar'"
        );
        assert_eq!(
            quote_command(ShellKind::Posix, "/home/a b/claude", &args),
            r"'/home/a b/claude' '--foo bar'"
        );
    }

    #[test]
    fn a_session_is_given_a_terminal_it_can_trust() {
        // A GUI launch has no `TERM` at all — the program inside the PTY still has to see a
        // terminal that supports colour and 256 colours.
        let empty = |_: &str| None;
        assert_eq!(
            terminal_env(&empty),
            vec![("TERM", "xterm-256color"), ("COLORTERM", "truecolor")]
        );

        // A user who says what they want keeps it; `dumb` is the one value that is not a choice.
        let set = |name: &str| match name {
            "TERM" => Some("/bin".to_string()),
            _ => Some("24bit".to_string()),
        };
        assert!(terminal_env(&set).is_empty());

        let dumb = |name: &str| (name == "TERM").then(|| "dumb".to_string());
        assert_eq!(
            terminal_env(&dumb),
            vec![("TERM", "xterm-256color"), ("COLORTERM", "truecolor")]
        );
    }

    #[test]
    fn quotes_inside_a_path_survive() {
        assert_eq!(quote_powershell("a'b"), "'a''b'");
        assert_eq!(quote_posix("/tmp/it's"), r"'/tmp/it'\''s'");
    }
}
