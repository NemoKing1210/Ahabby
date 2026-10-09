//! The desktop editors Ahabby can hand a file to.
//!
//! Two rules keep this honest:
//! * every entry is *detected* on this machine before it is offered — the command-line shim the
//!   editor installs on `PATH` first, then the documented install location for the platform, so
//!   nothing is offered that would fail when clicked;
//! * every entry is launched with the contract its own resolution implies, which is what makes
//!   one table enough for three platforms: a macOS `.app` bundle goes through `open -a` (no
//!   command-line shim has to be installed), a Windows `.cmd`/`.bat` shim through `cmd /C`
//!   (`CreateProcess` cannot start a batch file directly), and everything else is executed
//!   directly with the file as its only argument.
//!
//! Nothing here writes to the file: the editor is started on the path the scan resolved and
//! Ahabby is finished with it.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use crate::domain::Os;
use crate::error::{AppError, Result};
use crate::platform::paths::{expand_template, PlatformContext};
use crate::platform::shell::{quote_command, ShellKind};
use crate::platform::which;

/// One known editor.
struct EditorApp {
    /// Stable id, and the brand key the frontend paints the icon from.
    id: &'static str,
    name: &'static str,
    os: &'static [Os],
    /// Names searched on `PATH` — the shims the editors install themselves.
    binaries: &'static [&'static str],
    /// Absolute candidates: install directories and `.app` bundles. `${VAR}` is expanded.
    paths: &'static [&'static str],
}

const ALL: &[Os] = &[Os::Windows, Os::Macos, Os::Linux];

/// The support matrix.
///
/// SOURCE: each entry's command-line shim is the one its own documentation names for opening a
/// file (`code <file>`, `cursor <file>`, `zed <file>`, `subl <file>`, `idea <file>`, …), and the
/// absolute candidates are the default install locations of those same installers (checked
/// 2026-10-09). The shim on `PATH` always wins, so a user who installed elsewhere is still
/// covered; the absolute entries only help the one who did not add it to `PATH`.
const EDITORS: &[EditorApp] = &[
    EditorApp {
        id: "vscode",
        name: "Visual Studio Code",
        os: ALL,
        binaries: &["code"],
        paths: &[
            "${LOCALAPPDATA}/Programs/Microsoft VS Code/bin/code.cmd",
            "${PROGRAMFILES}/Microsoft VS Code/bin/code.cmd",
            "/Applications/Visual Studio Code.app",
            "${HOME}/Applications/Visual Studio Code.app",
            "/usr/bin/code",
            "/usr/share/code/code",
            "/snap/bin/code",
        ],
    },
    EditorApp {
        id: "cursor",
        name: "Cursor",
        os: ALL,
        binaries: &["cursor"],
        paths: &[
            "${LOCALAPPDATA}/Programs/cursor/resources/app/bin/cursor.cmd",
            "/Applications/Cursor.app",
            "${HOME}/Applications/Cursor.app",
            "/usr/bin/cursor",
            "/usr/local/bin/cursor",
            "${HOME}/.local/bin/cursor",
        ],
    },
    EditorApp {
        id: "zed",
        name: "Zed",
        os: ALL,
        binaries: &["zed"],
        paths: &[
            "${LOCALAPPDATA}/Programs/Zed/bin/Zed.exe",
            "/Applications/Zed.app",
            "${HOME}/Applications/Zed.app",
            "/usr/bin/zed",
            "${HOME}/.local/bin/zed",
        ],
    },
    EditorApp {
        id: "windsurf",
        name: "Windsurf",
        os: ALL,
        binaries: &["windsurf"],
        paths: &[
            "${LOCALAPPDATA}/Programs/Windsurf/bin/windsurf.cmd",
            "/Applications/Windsurf.app",
            "/usr/bin/windsurf",
            "${HOME}/.local/bin/windsurf",
        ],
    },
    EditorApp {
        id: "vscodium",
        name: "VSCodium",
        os: ALL,
        binaries: &["codium"],
        paths: &[
            "${LOCALAPPDATA}/Programs/VSCodium/bin/codium.cmd",
            "/Applications/VSCodium.app",
            "/usr/bin/codium",
            "/snap/bin/codium",
        ],
    },
    EditorApp {
        id: "sublime",
        name: "Sublime Text",
        os: ALL,
        binaries: &["subl"],
        paths: &[
            "${PROGRAMFILES}/Sublime Text/subl.exe",
            "${PROGRAMFILES}/Sublime Text 3/subl.exe",
            "/Applications/Sublime Text.app",
            "/usr/bin/subl",
            "/opt/sublime_text/sublime_text",
        ],
    },
    EditorApp {
        id: "notepadpp",
        name: "Notepad++",
        os: &[Os::Windows],
        binaries: &["notepad++"],
        paths: &[
            "${PROGRAMFILES}/Notepad++/notepad++.exe",
            "${PROGRAMFILES(X86)}/Notepad++/notepad++.exe",
        ],
    },
    EditorApp {
        id: "idea",
        name: "IntelliJ IDEA",
        os: ALL,
        binaries: &["idea"],
        paths: &[
            "/Applications/IntelliJ IDEA.app",
            "/Applications/IntelliJ IDEA CE.app",
        ],
    },
    EditorApp {
        id: "webstorm",
        name: "WebStorm",
        os: ALL,
        binaries: &["webstorm"],
        paths: &["/Applications/WebStorm.app"],
    },
    EditorApp {
        id: "pycharm",
        name: "PyCharm",
        os: ALL,
        binaries: &["pycharm"],
        paths: &["/Applications/PyCharm.app", "/Applications/PyCharm CE.app"],
    },
    EditorApp {
        id: "phpstorm",
        name: "PhpStorm",
        os: ALL,
        binaries: &["phpstorm"],
        paths: &["/Applications/PhpStorm.app"],
    },
    EditorApp {
        id: "goland",
        name: "GoLand",
        os: ALL,
        binaries: &["goland"],
        paths: &["/Applications/GoLand.app"],
    },
    EditorApp {
        id: "clion",
        name: "CLion",
        os: ALL,
        binaries: &["clion"],
        paths: &["/Applications/CLion.app"],
    },
    EditorApp {
        id: "rider",
        name: "Rider",
        os: ALL,
        binaries: &["rider"],
        paths: &["/Applications/Rider.app"],
    },
];

/// An editor found on this machine.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DetectedEditor {
    pub id: &'static str,
    pub name: &'static str,
    pub path: PathBuf,
}

/// Every editor of the table that exists on this platform, in table order.
pub fn detect(ctx: &PlatformContext) -> Vec<DetectedEditor> {
    EDITORS
        .iter()
        .filter(|app| app.os.contains(&ctx.os))
        .filter_map(|app| {
            locate(app, ctx).map(|path| DetectedEditor {
                id: app.id,
                name: app.name,
                path,
            })
        })
        .collect()
}

/// Open `file` in the editor called `id`.
///
/// The id must be one this table knows *and* one that was found on this machine; the file comes
/// from the caller (the scan), never from the frontend.
pub fn launch(ctx: &PlatformContext, id: &str, file: &Path) -> Result<()> {
    let app = EDITORS
        .iter()
        .find(|app| app.id == id)
        .ok_or_else(|| AppError::InvalidInput(format!("unknown editor '{id}'")))?;
    if !app.os.contains(&ctx.os) {
        return Err(AppError::NotSupported(format!(
            "{} is not available on this platform",
            app.name
        )));
    }

    let resolved = locate(app, ctx)
        .ok_or_else(|| AppError::NotSupported(format!("{} is not installed", app.name)))?;
    let command = open_command(&resolved, file);
    let cwd = file.parent().unwrap_or_else(|| Path::new("."));
    spawn(command, cwd).map_err(|error| {
        AppError::Other(format!(
            "could not open {} in {}: {error}",
            file.display(),
            app.name
        ))
    })
}

/// The command that opens `file` with the editor resolved at `resolved`.
///
/// Only the *kind* of the resolved path decides the contract — a bundle, a batch shim, or a
/// plain executable — so the table above stays a list of names and locations.
fn open_command(resolved: &Path, file: &Path) -> Command {
    let file = file.to_string_lossy().to_string();
    let resolved_text = resolved.to_string_lossy().to_string();

    if has_extension(resolved, "app") {
        // macOS: Launch Services opens the bundle, which is why an editor that never installed
        // its command-line shim is still offered here.
        let mut command = Command::new("open");
        command.args(["-a", &resolved_text, &file]);
        return command;
    }

    // A batch file is not a program `CreateProcess` can start, so the shell runs it. The line
    // goes over verbatim: the standard argument quoting would escape the quotes `cmd` has to
    // see, and `cmd` is not the CRT.
    #[cfg(windows)]
    if has_extension(resolved, "cmd") || has_extension(resolved, "bat") {
        use std::os::windows::process::CommandExt;
        let mut command = Command::new("cmd");
        command.raw_arg("/C");
        command.raw_arg(batch_command_line(&resolved_text, &file));
        return command;
    }

    let mut command = Command::new(resolved);
    command.arg(file);
    command
}

/// The command line handed to `cmd /C` for a batch shim.
///
/// The extra outer pair of quotes is not decoration, and dropping it is a silent failure: `cmd`
/// strips the outermost quotes of what follows `/C` itself, so a line that opens with the
/// already-quoted program loses exactly that quoting and the shim is then split at its first
/// space. Wrapping the whole line again is what survives that rule.
fn batch_command_line(program: &str, file: &str) -> String {
    format!(
        "\"{}\"",
        quote_command(ShellKind::Cmd, program, &[file.to_string()])
    )
}

fn has_extension(path: &Path, extension: &str) -> bool {
    path.extension()
        .is_some_and(|value| value.eq_ignore_ascii_case(extension))
}

/// A binary on `PATH` wins, then an absolute candidate; directories count (`.app` bundles).
fn locate(app: &EditorApp, ctx: &PlatformContext) -> Option<PathBuf> {
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
        .filter_map(|candidate| expand(candidate, ctx))
        .find(|path| path.is_file() || path.is_dir())
}

/// Expand a `/`-separated candidate against the context's environment and home.
fn expand(candidate: &str, ctx: &PlatformContext) -> Option<PathBuf> {
    expand_template(candidate, ctx.os, &ctx.home, |key| {
        ctx.env_var(key).map(str::to_string)
    })
}

/// Spawn detached: the editor outlives Ahabby and must not hold its pipes open.
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

    fn args(command: &Command) -> Vec<String> {
        command
            .get_args()
            .map(|arg| arg.to_string_lossy().to_string())
            .collect()
    }

    fn context(os: Os, home: &str) -> PlatformContext {
        PlatformContext::for_tests(os, home, "/data", "/config")
    }

    #[test]
    fn the_argument_follows_the_kind_of_command_that_was_resolved() {
        let file = Path::new("/work/notes/settings.json");

        let direct = open_command(Path::new("/usr/bin/code"), file);
        assert_eq!(direct.get_program().to_string_lossy(), "/usr/bin/code");
        assert_eq!(args(&direct), vec!["/work/notes/settings.json"]);

        // A Windows shim cannot be started by `CreateProcess`, so the shell starts it — with the
        // whole line wrapped in a second pair of quotes, which is what `cmd /C` needs to keep the
        // program's own quoting intact.
        assert_eq!(
            batch_command_line(r"C:\bin\code.cmd", "/work/notes/settings.json"),
            r#"""C:\bin\code.cmd" "/work/notes/settings.json"""#
        );

        // A macOS bundle needs no shim at all.
        let bundle = open_command(Path::new("/Applications/Visual Studio Code.app"), file);
        assert_eq!(bundle.get_program().to_string_lossy(), "open");
        assert_eq!(
            args(&bundle),
            vec![
                "-a",
                "/Applications/Visual Studio Code.app",
                "/work/notes/settings.json"
            ]
        );
    }

    #[test]
    fn install_locations_expand_from_the_context_environment() {
        let ctx = context(Os::Windows, "C:/Users/tester");
        let vscode = EDITORS.iter().find(|app| app.id == "vscode").unwrap();

        assert!(
            vscode.paths.iter().any(|candidate| expand(candidate, &ctx)
                == Some(PathBuf::from(
                    r"C:\Users\tester\AppData\Local\Programs\Microsoft VS Code\bin\code.cmd"
                ))),
            "the per-user install location must resolve"
        );

        // An unresolvable variable drops the candidate rather than inventing a path.
        assert_eq!(expand("${MISSING}/bin/code", &ctx), None);
    }

    #[test]
    fn an_editor_installed_at_a_documented_location_is_detected() {
        let home = tempfile::tempdir().unwrap();
        let ctx = context(Os::Windows, &home.path().to_string_lossy());
        let shim = home
            .path()
            .join("AppData/Local/Programs/Microsoft VS Code/bin/code.cmd");
        std::fs::create_dir_all(shim.parent().unwrap()).unwrap();
        std::fs::write(&shim, "@echo off\n").unwrap();

        let detected = detect(&ctx);
        assert!(
            detected.iter().any(|editor| editor.id == "vscode"),
            "detected: {detected:?}"
        );
        // A Windows-only entry is never offered on another platform.
        assert!(detect(&context(Os::Linux, "/home/t"))
            .iter()
            .all(|editor| editor.id != "notepadpp"));
    }

    #[cfg(windows)]
    #[test]
    fn a_batch_shim_is_really_started_through_the_shell() {
        // The one part the argv test cannot prove: `cmd /C` actually runs the shim and hands it
        // the file — including a path with a space, which is what the quoting is for. A `.cmd`
        // of our own stands in for `code.cmd`, so no editor is opened.
        let dir = tempfile::tempdir().unwrap();
        let shim = dir.path().join("fake-code.cmd");
        let marker = dir.path().join("opened.txt");
        std::fs::write(
            &shim,
            format!("@echo off\r\necho %~1 > \"{}\"\r\n", marker.display()),
        )
        .unwrap();
        let file = dir.path().join("settings with space.json");
        std::fs::write(&file, "{}").unwrap();

        spawn(open_command(&shim, &file), dir.path()).unwrap();

        let mut written = String::new();
        for _ in 0..100 {
            if let Ok(value) = std::fs::read_to_string(&marker) {
                written = value;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        assert!(
            written.contains("settings with space.json"),
            "the shim got {written:?}"
        );
    }

    #[test]
    fn unknown_and_foreign_editors_are_refused() {
        let ctx = context(Os::current(), "/home/tester");
        let file = Path::new("/home/tester/settings.json");

        // Nothing is looked up for an id the table does not know.
        let error = launch(&ctx, "nope", file).unwrap_err();
        assert_eq!(error.code(), "invalid_input");

        // Known, but not on this platform — refused before anything is resolved.
        if Os::current() != Os::Windows {
            let error = launch(&ctx, "notepadpp", file).unwrap_err();
            assert_eq!(error.code(), "not_supported");
        }
    }
}
