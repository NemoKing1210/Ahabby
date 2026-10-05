//! The built-in terminal: one PTY session per tab, streamed to the webview.
//!
//! A session is a real console — `portable-pty` gives ConPTY on Windows and `openpty` elsewhere
//! — so a full-screen agent (Claude Code, Codex, opencode) draws exactly as it does in any
//! terminal, and the frontend is a terminal *emulator* (xterm.js) rather than a text view.
//!
//! Safety and liveness properties, mirroring the install job runner:
//! * the session starts from an agent id; the binary is the one the scan resolved, so the
//!   frontend can never hand Ahabby a program or a command line;
//! * the agent is handed to the user's own shell as one line, which is what makes npm's
//!   `.cmd`/`.ps1` shims work on Windows;
//! * output streams as it is read, in bounded chunks;
//! * closing a tab closes the console itself, which is the only thing that takes the agent down
//!   with the shell on Windows (`ClosePseudoConsole` sends `CTRL_CLOSE_EVENT` to its clients;
//!   terminating the shell alone would orphan the agent);
//! * the number of live sessions is capped, and long-finished ones are pruned.

use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, RwLock};

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use portable_pty::{
    native_pty_system, Child, ChildKiller, CommandBuilder, MasterPty, PtyPair, PtySize,
};

use crate::domain::{Os, TerminalExit, TerminalOutput, TerminalSession};
use crate::error::{AppError, Result};
use crate::platform::{self, shell};

/// Output goes here. The Tauri implementation emits events to the webview; tests use channels.
pub trait TerminalSink: Send + Sync + 'static {
    fn output(&self, event: TerminalOutput);
    fn exited(&self, event: TerminalExit);
}

/// What to start: an agent binary inside the user's shell, in one directory.
pub struct TerminalRequest {
    pub agent_id: String,
    pub agent_name: String,
    /// Absolute path the scan resolved for the agent.
    pub binary: String,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub cols: u16,
    pub rows: u16,
}

/// Tabs a user can realistically keep track of; beyond this a session is refused instead of
/// silently spawning another console.
const MAX_SESSIONS: usize = 24;
/// A finished session keeps its place in the map (its tab is still on screen) until this long
/// after the process ended, so finished tabs do not pile up consoles.
const PRUNE_AFTER_MS: i64 = 10 * 60 * 1000;
/// PTY reads are batched into this buffer; a fast TUI repaint arrives as a handful of events
/// instead of one per escape sequence.
const READ_BUFFER: usize = 16 * 1024;

/// What the reader and waiter threads share with the session. Deliberately separate from
/// [`Session`]: those threads must not keep the console handle alive, or closing a session
/// could not close the console.
struct SessionState {
    info: RwLock<TerminalSession>,
    finished_at_ms: Mutex<Option<i64>>,
}

impl SessionState {
    fn snapshot(&self) -> TerminalSession {
        self.info
            .read()
            .map(|info| info.clone())
            .unwrap_or_else(|poisoned| poisoned.into_inner().clone())
    }

    /// The console is gone — the reader hit the end of the stream, or the user closed the tab.
    /// The real exit code still arrives from the waiter thread via [`SessionState::finish`].
    fn mark_closed(&self) {
        if let Ok(mut info) = self.info.write() {
            info.running = false;
        }
        if let Ok(mut finished) = self.finished_at_ms.lock() {
            *finished = Some(platform::now_ms());
        }
    }

    /// Record what the process exited with; called once, by the waiter thread.
    fn finish(&self, exit_code: Option<i32>) {
        if let Ok(mut info) = self.info.write() {
            info.running = false;
            info.exit_code = exit_code;
        }
        if let Ok(mut finished) = self.finished_at_ms.lock() {
            *finished = Some(platform::now_ms());
        }
    }
}

struct Session {
    state: Arc<SessionState>,
    writer: Mutex<Box<dyn Write + Send>>,
    master: Mutex<Box<dyn MasterPty + Send>>,
    killer: Mutex<Box<dyn ChildKiller + Send + Sync>>,
}

impl Session {
    /// Terminate the shell process.
    ///
    /// The result is deliberately ignored: portable-pty 0.9's ConPTY killer reports a failure
    /// even when `TerminateProcess` succeeded (its success check is inverted), and on Windows
    /// the *console* has to be closed anyway — dropping the master does that, and that is what
    /// takes the agent down with the shell.
    fn kill(&self) {
        if let Ok(mut killer) = self.killer.lock() {
            let _ = killer.kill();
        }
    }
}

/// Live terminal sessions, keyed by session id.
///
/// Everything here is synchronous: the PTY is blocking, the map is held for microseconds and
/// nothing waits on another lock while it is held. The blocking work that does matter — reading
/// the PTY, waiting for the shell — happens on the per-session threads started by [`spawn`].
pub struct TerminalManager {
    sink: Arc<dyn TerminalSink>,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
    counter: AtomicU64,
}

impl TerminalManager {
    pub fn new(sink: Arc<dyn TerminalSink>) -> Arc<Self> {
        Arc::new(Self {
            sink,
            sessions: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
        })
    }

    /// Open a PTY, start the user's shell in it and type the agent's command line in.
    pub fn spawn(&self, request: TerminalRequest) -> Result<TerminalSession> {
        if request.binary.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "the agent has no executable to start".to_string(),
            ));
        }
        if !request.cwd.is_dir() {
            return Err(AppError::InvalidInput(format!(
                "working directory does not exist: {}",
                request.cwd.display()
            )));
        }

        {
            let mut sessions = self.sessions.lock().map_err(poisoned)?;
            sessions.retain(|_, session| !prunable(session));
            if sessions.len() >= MAX_SESSIONS {
                return Err(AppError::Other(format!(
                    "too many terminal sessions are open (limit {MAX_SESSIONS}); close one first"
                )));
            }
        }

        let spec = shell::default_shell(Os::current(), &path_lookup);
        let size = PtySize {
            rows: request.rows.max(1),
            cols: request.cols.max(1),
            pixel_width: 0,
            pixel_height: 0,
        };
        let PtyPair { master, slave } = native_pty_system()
            .openpty(size)
            .map_err(|error| AppError::Other(format!("could not open a terminal: {error}")))?;

        let mut command = CommandBuilder::new(&spec.program);
        command.args(&spec.args);
        command.cwd(&request.cwd);
        let child = slave.spawn_command(command).map_err(|error| {
            AppError::Other(format!("could not start {}: {error}", spec.label()))
        })?;
        // The slave handle must go: keeping it open would hold the PTY alive after the shell
        // exits, and the reader below would never see the end of the stream.
        drop(slave);

        let reader = master
            .try_clone_reader()
            .map_err(|error| AppError::Other(format!("could not read the terminal: {error}")))?;
        let writer = master.take_writer().map_err(|error| {
            AppError::Other(format!("could not write to the terminal: {error}"))
        })?;
        let killer = child.clone_killer();

        let id = format!("term-{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1);
        let command = shell::quote_command(spec.kind, &request.binary, &request.args);
        let session = TerminalSession {
            id: id.clone(),
            agent_id: request.agent_id.clone(),
            agent_name: request.agent_name.clone(),
            cwd: request.cwd.to_string_lossy().to_string(),
            shell: spec.label(),
            command: command.clone(),
            cols: size.cols,
            rows: size.rows,
            running: true,
            exit_code: None,
            started_at_ms: platform::now_ms(),
        };

        let handle = Arc::new(Session {
            state: Arc::new(SessionState {
                info: RwLock::new(session.clone()),
                finished_at_ms: Mutex::new(None),
            }),
            writer: Mutex::new(writer),
            master: Mutex::new(master),
            killer: Mutex::new(killer),
        });
        self.sessions
            .lock()
            .map_err(poisoned)?
            .insert(id.clone(), Arc::clone(&handle));

        // The shell is interactive from the start; the agent is handed to it exactly the way a
        // user would type it. `\r` is Enter on Windows' console, `\n` is Enter for a POSIX line
        // discipline. A failure here means the session is unusable, so it is rolled back.
        let enter = if cfg!(windows) { "\r" } else { "\n" };
        if let Err(error) = self.write(&id, &format!("{command}{enter}")) {
            let _ = self.close(&id);
            return Err(error);
        }

        let stream_sink = Arc::clone(&self.sink);
        let stream_id = id.clone();
        let stream_state = Arc::clone(&handle.state);
        std::thread::Builder::new()
            .name(format!("pty-read-{id}"))
            .spawn(move || stream(reader, stream_sink, stream_id, stream_state))
            .map_err(|error| AppError::Other(format!("could not read the terminal: {error}")))?;

        let exit_sink = Arc::clone(&self.sink);
        let exit_id = id.clone();
        let exit_state = Arc::clone(&handle.state);
        std::thread::Builder::new()
            .name(format!("pty-wait-{id}"))
            .spawn(move || {
                let code = wait_for(child);
                exit_state.finish(code);
                exit_sink.exited(TerminalExit {
                    session_id: exit_id,
                    exit_code: code,
                });
            })
            .map_err(|error| AppError::Other(format!("could not watch the terminal: {error}")))?;

        Ok(session)
    }

    /// Send input to a session (keystrokes and pastes from xterm).
    pub fn write(&self, id: &str, data: &str) -> Result<()> {
        let session = self.session(id)?;
        let mut writer = session
            .writer
            .lock()
            .map_err(|_| AppError::Other("terminal writer is unavailable".to_string()))?;
        writer
            .write_all(data.as_bytes())
            .and_then(|()| writer.flush())
            .map_err(|error| AppError::Other(format!("could not write to the terminal: {error}")))
    }

    /// Tell the session its visible size changed (xterm's fit addon after a resize).
    pub fn resize(&self, id: &str, cols: u16, rows: u16) -> Result<()> {
        let session = self.session(id)?;
        let cols = cols.max(1);
        let rows = rows.max(1);
        session
            .master
            .lock()
            .map_err(|_| AppError::Other("terminal is unavailable".to_string()))?
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|error| AppError::Other(format!("could not resize the terminal: {error}")))?;
        if let Ok(mut info) = session.state.info.write() {
            info.cols = cols;
            info.rows = rows;
        }
        Ok(())
    }

    /// End a session: kill the shell and drop the console. Returns `false` when the process had
    /// already finished.
    pub fn close(&self, id: &str) -> Result<bool> {
        let session = self.session(id)?;
        let running = session.state.snapshot().running;
        if running {
            session.kill();
            session.state.mark_closed();
        }
        self.sessions.lock().map_err(poisoned)?.remove(id);
        // `session` — and with it the console handle — is dropped here, which closes the console
        // and terminates whatever is still attached to it.
        Ok(running)
    }

    /// Every session this process knows about, oldest first.
    pub fn list(&self) -> Vec<TerminalSession> {
        let mut sessions: Vec<TerminalSession> = self
            .sessions
            .lock()
            .map(|sessions| {
                sessions
                    .values()
                    .map(|session| session.state.snapshot())
                    .collect()
            })
            .unwrap_or_default();
        sessions.sort_by_key(|session| session.started_at_ms);
        sessions
    }

    /// Kill every session: called when Ahabby exits, so no shell is orphaned.
    pub fn close_all(&self) {
        let Ok(mut sessions) = self.sessions.lock() else {
            return;
        };
        for session in sessions.values() {
            session.kill();
        }
        sessions.clear();
    }

    fn session(&self, id: &str) -> Result<Arc<Session>> {
        self.sessions
            .lock()
            .map_err(poisoned)?
            .get(id)
            .cloned()
            .ok_or_else(|| AppError::NotFound(format!("terminal session '{id}'")))
    }
}

fn poisoned<T>(_: std::sync::PoisonError<T>) -> AppError {
    AppError::Other("the terminal session table is unavailable".to_string())
}

/// `platform::which` as the plain lookup `shell::default_shell` takes.
fn path_lookup(name: &str) -> Option<PathBuf> {
    platform::which::find_binary(&[name.to_string()], &[]).map(|found| found.path)
}

fn prunable(session: &Arc<Session>) -> bool {
    if session.state.snapshot().running {
        return false;
    }
    session
        .state
        .finished_at_ms
        .lock()
        .ok()
        .and_then(|finished| *finished)
        .is_some_and(|finished| platform::now_ms() - finished > PRUNE_AFTER_MS)
}

/// Read the PTY until it closes, forwarding everything to the sink in base64 chunks.
fn stream(
    mut reader: Box<dyn Read + Send>,
    sink: Arc<dyn TerminalSink>,
    id: String,
    state: Arc<SessionState>,
) {
    let mut buffer = vec![0u8; READ_BUFFER];
    loop {
        match reader.read(&mut buffer) {
            Ok(0) => break,
            Ok(read) => sink.output(TerminalOutput {
                session_id: id.clone(),
                data: BASE64.encode(&buffer[..read]),
            }),
            Err(error) if error.kind() == std::io::ErrorKind::Interrupted => continue,
            // A PTY whose last writer is gone reports `EIO` on Linux: the normal end of a session.
            Err(_) => break,
        }
    }
    // The reader is normally first to notice (the waiter is blocked in `wait`), and a tab must
    // stop looking alive the moment the console closes; the waiter still reports the code.
    state.mark_closed();
}

fn wait_for(mut child: Box<dyn Child + Send + Sync>) -> Option<i32> {
    match child.wait() {
        Ok(status) if status.signal().is_none() => Some(status.exit_code() as i32),
        Ok(_) => None,
        Err(_) => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};
    use tokio::sync::mpsc;

    enum Event {
        Output(TerminalOutput),
        Exit(TerminalExit),
    }

    struct TestSink(mpsc::UnboundedSender<Event>);

    impl TerminalSink for TestSink {
        fn output(&self, event: TerminalOutput) {
            let _ = self.0.send(Event::Output(event));
        }
        fn exited(&self, event: TerminalExit) {
            let _ = self.0.send(Event::Exit(event));
        }
    }

    fn manager() -> (Arc<TerminalManager>, mpsc::UnboundedReceiver<Event>) {
        let (sender, receiver) = mpsc::unbounded_channel();
        (TerminalManager::new(Arc::new(TestSink(sender))), receiver)
    }

    /// An agent-shaped request whose "agent" is a program every platform has.
    fn request(cwd: PathBuf, binary: &str, args: &[&str]) -> TerminalRequest {
        TerminalRequest {
            agent_id: "unit-agent".to_string(),
            agent_name: "Unit Agent".to_string(),
            binary: binary.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
            cwd,
            cols: 80,
            rows: 24,
        }
    }

    fn decode(event: &TerminalOutput) -> String {
        String::from_utf8_lossy(&BASE64.decode(&event.data).unwrap()).to_string()
    }

    /// Drain a session, answering ConPTY's cursor-position query the way a real terminal does.
    ///
    /// ConPTY asks the terminal where the cursor is (`ESC[6n`) and holds its output back until
    /// it gets the report; xterm answers it for the app, so the tests have to answer it here or
    /// they would never see a byte of output. Returns as soon as `needle` shows up (when given)
    /// or the session reports its exit.
    async fn collect(
        manager: &Arc<TerminalManager>,
        session_id: &str,
        receiver: &mut mpsc::UnboundedReceiver<Event>,
        needle: Option<&str>,
        limit: Duration,
    ) -> (String, Option<TerminalExit>) {
        let started = Instant::now();
        let mut seen = String::new();
        while started.elapsed() < limit {
            match tokio::time::timeout(Duration::from_millis(250), receiver.recv()).await {
                Ok(Some(Event::Output(event))) => {
                    let chunk = decode(&event);
                    if chunk.contains("\u{1b}[6n") {
                        // `CSI 1;1 R`: the cursor is at the top-left, as on a fresh terminal.
                        let _ = manager.write(session_id, "\u{1b}[1;1R");
                    }
                    seen.push_str(&chunk);
                    if needle.is_some_and(|needle| seen.contains(needle)) {
                        return (seen, None);
                    }
                }
                Ok(Some(Event::Exit(exit))) => return (seen, Some(exit)),
                Ok(None) => return (seen, None),
                Err(_) => {}
            }
        }
        (seen, None)
    }

    #[tokio::test]
    async fn a_session_prints_its_agents_output_and_reports_the_exit() {
        let dir = tempfile::tempdir().unwrap();
        let (manager, mut receiver) = manager();
        let (binary, args) = if cfg!(windows) {
            ("cmd.exe", vec!["/c", "echo", "ahabby-terminal-ok"])
        } else {
            ("/bin/echo", vec!["ahabby-terminal-ok"])
        };
        let session = manager
            .spawn(request(dir.path().to_path_buf(), binary, &args))
            .unwrap();
        assert_eq!(session.agent_id, "unit-agent");
        assert!(session.running);
        assert!(session.command.contains("ahabby-terminal-ok"));

        let (output, _) = collect(
            &manager,
            &session.id,
            &mut receiver,
            Some("ahabby-terminal-ok"),
            Duration::from_secs(30),
        )
        .await;
        assert!(
            output.contains("ahabby-terminal-ok"),
            "output was: {output:?}"
        );

        // The agent exiting does not end the tab: the user is left at the shell prompt, exactly
        // like a terminal window. `exit` closes the shell, and that is what ends the session.
        manager
            .write(&session.id, if cfg!(windows) { "exit\r" } else { "exit\n" })
            .unwrap();
        let (_, exit) = collect(
            &manager,
            &session.id,
            &mut receiver,
            None,
            Duration::from_secs(30),
        )
        .await;
        let exit = exit.expect("closing the shell should report the session's exit");
        assert_eq!(exit.session_id, session.id);
        assert_eq!(exit.exit_code, Some(0));
        assert!(manager.list()[0].exit_code.is_some());
    }

    #[tokio::test]
    async fn a_shell_session_accepts_input_and_tracks_its_size() {
        let dir = tempfile::tempdir().unwrap();
        let (manager, mut receiver) = manager();
        // The agent runs and finishes, leaving the user at the shell's own prompt.
        let (binary, args) = if cfg!(windows) {
            ("cmd.exe", vec!["/c", "echo", "first-marker"])
        } else {
            ("/bin/echo", vec!["first-marker"])
        };
        let session = manager
            .spawn(request(dir.path().to_path_buf(), binary, &args))
            .unwrap();

        let (seen, _) = collect(
            &manager,
            &session.id,
            &mut receiver,
            Some("first-marker"),
            Duration::from_secs(30),
        )
        .await;
        assert!(seen.contains("first-marker"), "output was: {seen:?}");

        manager.resize(&session.id, 120, 40).unwrap();
        let listed = manager.list();
        assert_eq!(listed[0].cols, 120);
        assert_eq!(listed[0].rows, 40);

        // A command whose *result* is not inside the command line it was typed as, so finding
        // the result in the output proves the keystrokes reached the shell and were executed.
        // Which command depends on the shell this machine actually starts.
        let spec = crate::platform::shell::default_shell(Os::current(), &path_lookup);
        let line = match crate::platform::shell::kind_of(&spec.program) {
            crate::platform::shell::ShellKind::Cmd => "set /a 12345+1\r",
            crate::platform::shell::ShellKind::PowerShell => "Write-Output (12345 + 1)\r",
            crate::platform::shell::ShellKind::Posix => "echo $((12345 + 1))\n",
        };
        let expected = "12346";
        manager.write(&session.id, line).unwrap();
        let (seen, _) = collect(
            &manager,
            &session.id,
            &mut receiver,
            Some(expected),
            Duration::from_secs(30),
        )
        .await;
        assert!(seen.contains(expected), "output was: {seen:?}");

        assert!(manager.close(&session.id).unwrap());
        assert!(manager.list().is_empty());
        // Closing an already closed session is a lookup failure, not a second kill.
        assert_eq!(manager.close(&session.id).unwrap_err().code(), "not_found");
    }

    #[tokio::test]
    async fn unknown_ids_and_bad_inputs_are_refused() {
        let (manager, _receiver) = manager();
        assert_eq!(
            manager.write("term-999", "x").unwrap_err().code(),
            "not_found"
        );
        assert_eq!(
            manager.resize("term-999", 1, 1).unwrap_err().code(),
            "not_found"
        );
        assert_eq!(manager.close("term-999").unwrap_err().code(), "not_found");

        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            manager
                .spawn(request(dir.path().to_path_buf(), "", &[]))
                .unwrap_err()
                .code(),
            "invalid_input"
        );
        assert_eq!(
            manager
                .spawn(request(PathBuf::from("/definitely/not/here"), "sh", &[]))
                .unwrap_err()
                .code(),
            "invalid_input"
        );
    }

    #[tokio::test]
    async fn closing_everything_kills_every_session() {
        let dir = tempfile::tempdir().unwrap();
        let (manager, _receiver) = manager();
        let binary = if cfg!(windows) { "cmd.exe" } else { "/bin/cat" };
        for _ in 0..2 {
            manager
                .spawn(request(dir.path().to_path_buf(), binary, &[]))
                .unwrap();
        }
        assert_eq!(manager.list().len(), 2);
        manager.close_all();
        assert!(manager.list().is_empty());
    }
}
