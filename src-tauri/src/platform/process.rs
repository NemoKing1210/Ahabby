//! Process execution with hard timeouts.
//!
//! Every external command in Ahabby goes through here. Two rules:
//! * a command never outlives its timeout (`kill_on_drop` + `tokio::time::timeout`),
//! * nothing is executed through a shell unless the manifest explicitly said so.

use std::process::Stdio;
use std::time::{Duration, Instant};

use tokio::process::Command;

use crate::domain::Os;
use crate::error::{AppError, Result};

/// Result of a finished (or timed out) command.
#[derive(Debug, Clone)]
pub struct CommandOutput {
    pub program: String,
    pub args: Vec<String>,
    pub status: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub duration_ms: u64,
}

impl CommandOutput {
    pub fn success(&self) -> bool {
        !self.timed_out && self.status == Some(0)
    }

    /// stdout, falling back to stderr when a CLI writes its version there.
    pub fn best_text(&self) -> &str {
        let stdout = self.stdout.trim();
        if stdout.is_empty() {
            self.stderr.trim()
        } else {
            stdout
        }
    }

    pub fn combined(&self) -> String {
        let mut text = String::new();
        if !self.stdout.trim().is_empty() {
            text.push_str(self.stdout.trim_end());
        }
        if !self.stderr.trim().is_empty() {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(self.stderr.trim_end());
        }
        text
    }
}

/// How to hand a command line to the platform shell. Only used for manifest methods
/// with `manager = "script"` (official installers).
pub fn shell_invocation(os: Os, command: &str) -> (String, Vec<String>) {
    match os {
        Os::Windows => (
            "powershell".to_string(),
            vec![
                "-NoProfile".to_string(),
                "-NonInteractive".to_string(),
                "-ExecutionPolicy".to_string(),
                "Bypass".to_string(),
                "-Command".to_string(),
                command.to_string(),
            ],
        ),
        _ => (
            "sh".to_string(),
            vec!["-lc".to_string(), command.to_string()],
        ),
    }
}

/// Build a `Command` with the standard bells and whistles (no console window on Windows,
/// piped stdio, killed when dropped).
pub fn build_command(program: &str) -> Command {
    let mut command = Command::new(program);
    command
        .kill_on_drop(true)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    {
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

pub async fn run_capture(
    program: &str,
    args: &[String],
    timeout: Duration,
) -> Result<CommandOutput> {
    let started = Instant::now();
    let mut command = build_command(program);
    command.args(args);

    match tokio::time::timeout(timeout, command.output()).await {
        Ok(Ok(output)) => Ok(CommandOutput {
            program: program.to_string(),
            args: args.to_vec(),
            status: output.status.code(),
            stdout: String::from_utf8_lossy(&output.stdout).to_string(),
            stderr: String::from_utf8_lossy(&output.stderr).to_string(),
            timed_out: false,
            duration_ms: started.elapsed().as_millis() as u64,
        }),
        Ok(Err(error)) if error.kind() == std::io::ErrorKind::NotFound => {
            Err(AppError::NotFound(program.to_string()))
        }
        Ok(Err(error)) => Err(AppError::other(format!(
            "failed to run `{program}`: {error}"
        ))),
        Err(_) => Ok(CommandOutput {
            program: program.to_string(),
            args: args.to_vec(),
            status: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out: true,
            duration_ms: started.elapsed().as_millis() as u64,
        }),
    }
}

/// Run a command line through the platform shell.
pub async fn run_shell_capture(command: &str, os: Os, timeout: Duration) -> Result<CommandOutput> {
    let (program, args) = shell_invocation(os, command);
    run_capture(&program, &args, timeout).await
}

/// Run an agent's executable found on disk.
///
/// On Windows, package managers install `.cmd` / `.ps1` shims. A `.ps1` is not
/// executable at all and a `.cmd` occasionally trips `CreateProcess`, so a failed
/// direct spawn is retried once through the platform shell. Everything else is
/// executed directly — no shell, no quoting surprises.
pub async fn run_binary(binary: &str, args: &[String], timeout: Duration) -> Result<CommandOutput> {
    let is_script = cfg!(windows)
        && matches!(
            std::path::Path::new(binary)
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| extension.to_ascii_lowercase())
                .as_deref(),
            Some("ps1") | Some("cmd") | Some("bat")
        );

    if is_script {
        return run_shell_capture(&shim_command_line(binary, args), Os::Windows, timeout).await;
    }

    match run_capture(binary, args, timeout).await {
        Ok(output) => Ok(output),
        Err(error) => {
            if cfg!(windows) {
                let fallback =
                    run_shell_capture(&shim_command_line(binary, args), Os::Windows, timeout).await;
                if fallback.is_ok() {
                    return fallback;
                }
            }
            Err(error)
        }
    }
}

/// Quote a command line for the Windows shell used by [`run_binary`].
#[cfg_attr(not(windows), allow(dead_code))]
fn shim_command_line(binary: &str, args: &[String]) -> String {
    let quote = |value: &str| {
        if value.is_empty() || value.contains([' ', '\t', '"', '\'', '(', ')', '&', '|']) {
            format!("'{}'", value.replace('\'', "''"))
        } else {
            value.to_string()
        }
    };
    let binary = quote(binary);
    if args.is_empty() {
        format!("& {binary}")
    } else {
        let args = args
            .iter()
            .map(|arg| quote(arg))
            .collect::<Vec<_>>()
            .join(" ");
        format!("& {binary} {args}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fast_timeout() -> Duration {
        Duration::from_secs(20)
    }

    #[tokio::test]
    async fn captures_stdout_and_exit_code() {
        let output = run_shell_capture("echo ahabby", Os::current(), fast_timeout())
            .await
            .unwrap();
        assert!(output.success(), "stderr: {}", output.stderr);
        assert!(output.stdout.contains("ahabby"));
        assert!(!output.timed_out);
    }

    #[tokio::test]
    async fn reports_non_zero_exit_code() {
        let output = run_shell_capture("exit 3", Os::current(), fast_timeout())
            .await
            .unwrap();
        assert_eq!(output.status, Some(3));
        assert!(!output.success());
    }

    #[tokio::test]
    async fn kills_commands_that_overrun_their_timeout() {
        let sleep = if cfg!(windows) {
            "Start-Sleep -Seconds 30"
        } else {
            "sleep 30"
        };
        let started = Instant::now();
        let output = run_shell_capture(sleep, Os::current(), Duration::from_millis(1200))
            .await
            .unwrap();
        assert!(output.timed_out);
        assert!(started.elapsed() < Duration::from_secs(25));
    }

    #[tokio::test]
    async fn missing_program_is_reported_as_not_found() {
        let error = run_capture("definitely-not-a-real-program-xyz", &[], fast_timeout())
            .await
            .unwrap_err();
        assert_eq!(error.code(), "not_found");
    }

    #[tokio::test]
    async fn falls_back_to_stderr_for_version_like_output() {
        let command = if cfg!(windows) {
            "[Console]::Error.WriteLine('2.1.0')"
        } else {
            "echo 2.1.0 1>&2"
        };
        let output = run_shell_capture(command, Os::current(), fast_timeout())
            .await
            .unwrap();
        assert_eq!(output.best_text(), "2.1.0");
    }

    #[tokio::test]
    async fn runs_an_installed_binary_shim() {
        let dir = tempfile::tempdir().unwrap();
        let binary = if cfg!(windows) {
            let path = dir.path().join("demo-agent.cmd");
            std::fs::write(&path, "@echo off\r\necho 4.5.6\r\n").unwrap();
            path
        } else {
            let path = dir.path().join("demo-agent");
            std::fs::write(&path, "#!/bin/sh\necho 4.5.6\n").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            path
        };

        let output = run_binary(
            &binary.to_string_lossy(),
            &["--version".to_string()],
            fast_timeout(),
        )
        .await
        .unwrap();
        assert_eq!(output.best_text(), "4.5.6", "stderr: {}", output.stderr);
    }
}
