//! The terminal emulators Ahabby can hand an agent to.
//!
//! Two rules keep this honest:
//! * every entry is *detected* on this machine before it is offered (a terminal that is not
//!   installed never appears in Settings), and
//! * every entry is launched with that terminal's own documented contract — the `-e` /
//!   `--command` family, Windows Terminal's `-w 0 nt -d`, macOS's AppleScript `do script`, or a
//!   URI scheme for the ones that have no command-line escape hatch (Warp).
//!
//! Entries whose terminal cannot be told to run a program are marked
//! [`TerminalCapability::OpensDirectory`] and are only opened in the working directory.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::domain::{Os, TerminalCapability};
use crate::error::{AppError, Result};
use crate::platform::shell::{quote_command, ShellKind};
use crate::platform::which;

/// The id Ahabby's own terminal has in Settings and in the sidebar picker.
pub const BUILTIN_ID: &str = "builtin";

/// How the launch is assembled.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Launch {
    /// An argv template for the terminal's own binary. `{cwd}` and `{argv}` (program plus its
    /// arguments, splatted) are replaced; `{cmdline}` asks for a command line quoted for the
    /// shell the terminal itself runs, which is `cmdline` here.
    Argv {
        argv: &'static [&'static str],
        cmdline: Option<ShellKind>,
    },
    /// macOS: run a command line inside the app through `osascript`.
    MacScript(MacScript),
    /// A registered URI handler: the only interface Warp exposes.
    Uri,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MacScript {
    Terminal,
    Iterm2,
}

/// One known terminal.
struct TerminalApp {
    id: &'static str,
    name: &'static str,
    os: &'static [Os],
    /// Names searched on `PATH`.
    binaries: &'static [&'static str],
    /// Absolute candidates: `.app` bundles and per-user installs. `${VAR}` is expanded.
    paths: &'static [&'static str],
    launch: Launch,
    capability: TerminalCapability,
}

/// Shorthand for the template entries that pass the program as separate arguments.
const fn argv(argv: &'static [&'static str]) -> Launch {
    Launch::Argv {
        argv,
        cmdline: None,
    }
}

const ALL: &[Os] = &[Os::Windows, Os::Macos, Os::Linux];
const UNIX: &[Os] = &[Os::Macos, Os::Linux];

/// The support matrix.
const TERMINALS: &[TerminalApp] = &[
    TerminalApp {
        id: "wt",
        name: "Windows Terminal",
        os: &[Os::Windows],
        binaries: &["wt"],
        paths: &["${LOCALAPPDATA}/Microsoft/WindowsApps/wt.exe"],
        // `-w 0` targets the most recently used window (so the agent lands in a new tab of the
        // window the user is already in), `nt` opens a tab and `-d` sets its directory.
        launch: argv(&["-w", "0", "nt", "-d", "{cwd}", "{exec}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "powershell",
        name: "Windows PowerShell",
        os: &[Os::Windows],
        binaries: &["powershell"],
        paths: &["${SystemRoot}/System32/WindowsPowerShell/v1.0/powershell.exe"],
        launch: Launch::Argv {
            argv: &["-NoLogo", "-NoExit", "-Command", "{cmdline}"],
            cmdline: Some(ShellKind::PowerShell),
        },
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "cmd",
        name: "Command Prompt",
        os: &[Os::Windows],
        binaries: &["cmd"],
        paths: &["${SystemRoot}/System32/cmd.exe"],
        // `/k` keeps the window open after the agent exits.
        launch: Launch::Argv {
            argv: &["/k", "{cmdline}"],
            cmdline: Some(ShellKind::Cmd),
        },
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "pwsh",
        name: "PowerShell 7+",
        os: ALL,
        binaries: &["pwsh"],
        paths: &[
            "${PROGRAMFILES}/PowerShell/7/pwsh.exe",
            "/usr/local/bin/pwsh",
            "/opt/homebrew/bin/pwsh",
        ],
        launch: Launch::Argv {
            argv: &["-NoLogo", "-NoExit", "-Command", "{cmdline}"],
            cmdline: Some(ShellKind::PowerShell),
        },
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "wezterm",
        name: "WezTerm",
        os: ALL,
        binaries: &["wezterm", "wezterm-gui"],
        paths: &[
            "${PROGRAMFILES}/WezTerm/wezterm-gui.exe",
            "/Applications/WezTerm.app/Contents/MacOS/wezterm-gui",
        ],
        launch: argv(&["start", "--cwd", "{cwd}", "--", "{exec}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "alacritty",
        name: "Alacritty",
        os: ALL,
        binaries: &["alacritty"],
        paths: &[
            "${LOCALAPPDATA}/Programs/Alacritty/alacritty.exe",
            "/Applications/Alacritty.app/Contents/MacOS/alacritty",
        ],
        launch: argv(&["--working-directory", "{cwd}", "-e", "{exec}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "ghostty",
        name: "Ghostty",
        os: ALL,
        binaries: &["ghostty"],
        paths: &[
            "${LOCALAPPDATA}/Programs/Ghostty/ghostty.exe",
            "/Applications/Ghostty.app/Contents/MacOS/ghostty",
        ],
        launch: argv(&["--working-directory={cwd}", "-e", "{exec}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "kitty",
        name: "kitty",
        os: UNIX,
        binaries: &["kitty"],
        paths: &["/Applications/kitty.app/Contents/MacOS/kitty"],
        launch: argv(&["--directory", "{cwd}", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "warp",
        name: "Warp",
        os: ALL,
        binaries: &["warp", "warp-terminal"],
        paths: &[
            "${LOCALAPPDATA}/Programs/Warp/warp.exe",
            "/Applications/Warp.app",
        ],
        // Warp opens windows and tabs by URI only; running a command is still an open request
        // (`warpdotdev/warp#3959`), so the user starts the agent in the tab Ahabby opens.
        launch: Launch::Uri,
        capability: TerminalCapability::OpensDirectory,
    },
    TerminalApp {
        id: "terminal",
        name: "Terminal",
        os: &[Os::Macos],
        binaries: &[],
        paths: &[
            "/System/Applications/Utilities/Terminal.app",
            "/Applications/Utilities/Terminal.app",
        ],
        launch: Launch::MacScript(MacScript::Terminal),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "iterm2",
        name: "iTerm2",
        os: &[Os::Macos],
        binaries: &[],
        paths: &["/Applications/iTerm.app"],
        launch: Launch::MacScript(MacScript::Iterm2),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "gnome-terminal",
        name: "GNOME Terminal",
        os: &[Os::Linux],
        binaries: &["gnome-terminal"],
        paths: &["/usr/bin/gnome-terminal"],
        launch: argv(&["--working-directory={cwd}", "--", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "konsole",
        name: "Konsole",
        os: &[Os::Linux],
        binaries: &["konsole"],
        paths: &["/usr/bin/konsole"],
        launch: argv(&["--workdir", "{cwd}", "-e", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "xfce4-terminal",
        name: "Xfce Terminal",
        os: &[Os::Linux],
        binaries: &["xfce4-terminal"],
        paths: &["/usr/bin/xfce4-terminal"],
        launch: argv(&["--working-directory={cwd}", "-x", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "tilix",
        name: "Tilix",
        os: &[Os::Linux],
        binaries: &["tilix"],
        paths: &["/usr/bin/tilix"],
        launch: argv(&["--working-directory={cwd}", "-e", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "terminator",
        name: "Terminator",
        os: &[Os::Linux],
        binaries: &["terminator"],
        paths: &["/usr/bin/terminator"],
        launch: argv(&["--working-directory={cwd}", "-x", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "foot",
        name: "foot",
        os: &[Os::Linux],
        binaries: &["foot"],
        paths: &["/usr/bin/foot"],
        launch: argv(&["--working-directory={cwd}", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
    TerminalApp {
        id: "xterm",
        name: "xterm",
        os: &[Os::Linux],
        binaries: &["xterm"],
        paths: &["/usr/bin/xterm", "/usr/X11/bin/xterm"],
        // xterm has no directory flag; the shell it starts inherits the launcher's own working
        // directory, so `current_dir` is set for every spawn below.
        launch: argv(&["-e", "{argv}"]),
        capability: TerminalCapability::RunsCommand,
    },
];

/// A terminal found on this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedTerminal {
    pub id: &'static str,
    pub name: &'static str,
    pub path: PathBuf,
    pub capability: TerminalCapability,
}

/// Every terminal of the table that exists on this platform, in table order.
pub fn detect(os: Os) -> Vec<DetectedTerminal> {
    let lookup = |name: &str| -> Option<String> { std::env::var(name).ok() };
    TERMINALS
        .iter()
        .filter(|app| app.os.contains(&os))
        .filter_map(|app| {
            locate(app, &lookup).map(|path| DetectedTerminal {
                id: app.id,
                name: app.name,
                path,
                capability: app.capability,
            })
        })
        .collect()
}

/// The name and capability of a known terminal, whether or not it is installed here — what
/// Settings validation needs to tell a real id from a forged one.
pub fn spec(id: &str) -> Option<(&'static str, TerminalCapability)> {
    TERMINALS
        .iter()
        .find(|app| app.id == id)
        .map(|app| (app.name, app.capability))
}

/// Start `program` (with `args`) in the terminal called `id`, in `cwd`.
///
/// The id must be a terminal this table knows *and* one that was found on this machine; the
/// program comes from the caller (the scan), never from the frontend.
pub fn launch(id: &str, os: Os, cwd: &Path, program: &str, args: &[String]) -> Result<()> {
    let app = TERMINALS
        .iter()
        .find(|app| app.id == id)
        .ok_or_else(|| AppError::InvalidInput(format!("unknown terminal '{id}'")))?;
    if !app.os.contains(&os) {
        return Err(AppError::NotSupported(format!(
            "{} is not available on this platform",
            app.name
        )));
    }

    let command = match app.launch {
        Launch::MacScript(kind) => mac_script_command(kind, cwd, program, args),
        Launch::Uri => uri_command(app.id, cwd)?,
        Launch::Argv { argv, cmdline } => {
            let path = locate(app, &|name| std::env::var(name).ok())
                .ok_or_else(|| AppError::NotSupported(format!("{} is not installed", app.name)))?;
            let shell = cmdline.unwrap_or(ShellKind::Posix);
            let mut command = Command::new(path);
            command.args(expand_argv(argv, cwd, program, args, shell));
            command
        }
    };

    spawn(command, cwd)
        .map_err(|error| AppError::Other(format!("could not open {}: {error}", app.name)))
}

/// A binary on `PATH` wins, then an absolute candidate; directories count (`.app` bundles).
fn locate(app: &TerminalApp, lookup: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let names: Vec<String> = app
        .binaries
        .iter()
        .map(|name| (*name).to_string())
        .collect();
    if let Some(found) = which::find_binary(&names, &[]) {
        return Some(found.path);
    }
    app.paths
        .iter()
        .filter_map(|candidate| expand_path(candidate, lookup))
        .find(|path| path.is_file() || path.is_dir())
}

/// Expand a `/`-separated candidate with `${VAR}` names, resolving nothing else.
fn expand_path(candidate: &str, lookup: &dyn Fn(&str) -> Option<String>) -> Option<PathBuf> {
    let mut out = String::with_capacity(candidate.len());
    let mut rest = candidate;
    while let Some(start) = rest.find("${") {
        out.push_str(&rest[..start]);
        let tail = &rest[start + 2..];
        let end = tail.find('}')?;
        let value = lookup(&tail[..end])?;
        out.push_str(value.trim());
        rest = &tail[end + 1..];
    }
    out.push_str(rest);
    Some(PathBuf::from(out))
}

/// Turn an argv template into the real argument list.
///
/// `{exec}` is the command to start, wrapped for the platform: a terminal that runs the given
/// program *itself* (everything in the `-e` / `--command` family) cannot execute npm's `.cmd`
/// shims on Windows, so those get `cmd /k <command line>` there and the plain program elsewhere.
fn expand_argv(
    template: &[&str],
    cwd: &Path,
    program: &str,
    args: &[String],
    shell: ShellKind,
) -> Vec<String> {
    let cwd = cwd.to_string_lossy().to_string();
    let mut out: Vec<String> = Vec::with_capacity(template.len() + args.len());
    for token in template {
        match *token {
            "{cwd}" => out.push(cwd.clone()),
            "{argv}" => {
                out.push(program.to_string());
                out.extend(args.iter().cloned());
            }
            "{exec}" => {
                if cfg!(windows) {
                    out.push("cmd".to_string());
                    out.push("/k".to_string());
                    out.push(quote_command(ShellKind::Cmd, program, args));
                } else {
                    out.push(program.to_string());
                    out.extend(args.iter().cloned());
                }
            }
            "{cmdline}" => out.push(quote_command(shell, program, args)),
            other => match other.strip_suffix("{cwd}") {
                Some(prefix) => out.push(format!("{prefix}{cwd}")),
                None => out.push(other.to_string()),
            },
        }
    }
    out
}

/// `osascript` that opens the app and runs the agent inside it.
fn mac_script_command(kind: MacScript, cwd: &Path, program: &str, args: &[String]) -> Command {
    // The app's own terminal already runs a shell, so the command line is `cd … && <command>`:
    // changing the directory of another application's shell cannot be done from here.
    let command = quote_command(ShellKind::Posix, program, args);
    let line = format!("cd {} && {command}", shell_quote(&cwd.to_string_lossy()));
    let escaped = line.replace('\\', "\\\\").replace('"', "\\\"");

    let script = match kind {
        MacScript::Terminal => format!(
            "tell application \"Terminal\" to do script \"{escaped}\"\ntell application \"Terminal\" to activate"
        ),
        MacScript::Iterm2 => format!(
            "tell application \"iTerm\" to create window with default profile\ntell current session of current window to write text \"{escaped}\""
        ),
    };

    let mut command = Command::new("osascript");
    for line in script.split('\n') {
        command.args(["-e", line]);
    }
    command
}

fn shell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', r"'\''"))
}

/// `warp://action/new_tab?path=…`, opened through the OS URI handler.
fn uri_command(id: &str, cwd: &Path) -> Result<Command> {
    if id != "warp" {
        return Err(AppError::NotSupported(format!(
            "terminal '{id}' has no launch URI"
        )));
    }
    let uri = format!(
        "warp://action/new_tab?path={}",
        percent_encode(&cwd.to_string_lossy())
    );
    let mut command = if cfg!(windows) {
        // `start` needs an (empty) window title before the URI, or it treats the URI as one.
        let mut command = Command::new("cmd");
        command.args(["/c", "start", "", &uri]);
        command
    } else if cfg!(target_os = "macos") {
        let mut command = Command::new("open");
        command.arg(&uri);
        command
    } else {
        let mut command = Command::new("xdg-open");
        command.arg(&uri);
        command
    };
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    Ok(command)
}

/// Percent-encode everything outside the URI unreserved set (`RFC 3986` §2.3), keeping `/`.
fn percent_encode(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for byte in value.as_bytes() {
        let ch = *byte as char;
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '.' | '_' | '~' | '/') {
            out.push(ch);
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// Spawn detached: the terminal outlives Ahabby and must not hold its pipes open.
fn spawn(mut command: Command, cwd: &Path) -> std::io::Result<()> {
    command.current_dir(cwd);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    command.spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vars(name: &str) -> Option<String> {
        match name {
            "LOCALAPPDATA" => Some("C:/Users/tester/AppData/Local".to_string()),
            "PROGRAMFILES" => Some("C:/Program Files".to_string()),
            "SystemRoot" => Some("C:/Windows".to_string()),
            _ => None,
        }
    }

    #[test]
    fn templates_expand_into_the_documented_argvs() {
        let cwd = Path::new("/work dir");
        let args = vec!["--resume".to_string()];

        let argv = expand_argv(
            &["-w", "0", "nt", "-d", "{cwd}", "{argv}"],
            cwd,
            r"C:\bin\claude.cmd",
            &args,
            ShellKind::PowerShell,
        );
        assert_eq!(
            argv,
            vec![
                "-w",
                "0",
                "nt",
                "-d",
                "/work dir",
                r"C:\bin\claude.cmd",
                "--resume"
            ]
        );

        let argv = expand_argv(
            &["--working-directory={cwd}", "-e", "{argv}"],
            cwd,
            "/usr/bin/claude",
            &[],
            ShellKind::Posix,
        );
        assert_eq!(
            argv,
            vec!["--working-directory=/work dir", "-e", "/usr/bin/claude"]
        );

        let argv = expand_argv(
            &["/k", "{cmdline}"],
            cwd,
            "C:/bin/claude.cmd",
            &args,
            ShellKind::Cmd,
        );
        assert_eq!(argv, vec!["/k", r#""C:/bin/claude.cmd" "--resume""#]);

        let argv = expand_argv(
            &["--directory", "{cwd}", "{argv}"],
            cwd,
            "/usr/bin/claude",
            &[],
            ShellKind::Posix,
        );
        assert_eq!(argv, vec!["--directory", "/work dir", "/usr/bin/claude"]);
    }

    #[test]
    fn exec_is_wrapped_for_the_platform() {
        let argv = expand_argv(
            &["--working-directory", "{cwd}", "-e", "{exec}"],
            Path::new("/work dir"),
            r"C:\bin\claude.cmd",
            &["--resume".to_string()],
            ShellKind::Posix,
        );
        if cfg!(windows) {
            // A `.cmd` shim cannot be started by the terminal itself, so `cmd /k` runs it.
            assert_eq!(
                argv,
                vec![
                    "--working-directory",
                    "/work dir",
                    "-e",
                    "cmd",
                    "/k",
                    r#""C:\bin\claude.cmd" "--resume""#
                ]
            );
        } else {
            assert_eq!(
                argv,
                vec![
                    "--working-directory",
                    "/work dir",
                    "-e",
                    r"C:\bin\claude.cmd",
                    "--resume"
                ]
            );
        }
    }

    #[test]
    fn detection_only_reports_terminals_of_this_platform_that_exist() {
        for terminal in detect(Os::Windows) {
            assert!(
                TERMINALS
                    .iter()
                    .any(|app| app.id == terminal.id && app.os.contains(&Os::Windows)),
                "{} is not a Windows terminal",
                terminal.id
            );
        }
        assert!(detect(Os::Linux)
            .iter()
            .all(|terminal| terminal.id != "cmd"));
        assert!(detect(Os::Windows)
            .iter()
            .all(|terminal| terminal.id != "gnome-terminal"));
    }

    #[test]
    fn unknown_and_foreign_terminals_are_refused() {
        let error = launch("nope", Os::current(), Path::new("."), "claude", &[]).unwrap_err();
        assert_eq!(error.code(), "invalid_input");

        // Known, but not on this platform.
        let foreign = if cfg!(windows) {
            "gnome-terminal"
        } else {
            "wt"
        };
        let error = launch(foreign, Os::current(), Path::new("."), "claude", &[]).unwrap_err();
        assert_eq!(error.code(), "not_supported");
    }

    #[test]
    fn paths_expand_environment_variables() {
        assert_eq!(
            expand_path("${LOCALAPPDATA}/Programs/Warp/warp.exe", &vars),
            Some(PathBuf::from(
                "C:/Users/tester/AppData/Local/Programs/Warp/warp.exe"
            ))
        );
        assert_eq!(expand_path("${MISSING}/x", &vars), None);
        assert_eq!(
            expand_path("/usr/bin/warp", &vars),
            Some(PathBuf::from("/usr/bin/warp"))
        );
    }

    #[test]
    fn warp_uris_are_percent_encoded() {
        assert_eq!(percent_encode(r"C:\Users\a b"), "C%3A%5CUsers%5Ca%20b");
        assert_eq!(percent_encode("/home/me/code"), "/home/me/code");
    }

    #[test]
    fn the_mac_script_quotes_the_command_and_escapes_it_for_applescript() {
        let command = mac_script_command(
            MacScript::Terminal,
            Path::new("/Users/a b/proj"),
            "/usr/local/bin/claude",
            &["--dangerously-skip-permissions".to_string()],
        );
        let argv: Vec<String> = command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect();
        assert_eq!(argv[0], "-e");
        assert_eq!(
            argv[1],
            r#"tell application "Terminal" to do script "cd '/Users/a b/proj' && '/usr/local/bin/claude' '--dangerously-skip-permissions'""#
        );
    }
}
