//! Running install / update / uninstall commands and streaming their output.
//!
//! Safety properties:
//! * only commands that came out of a manifest reach this module (see
//!   `adapters::manifest_adapter::plan_for`) — the frontend sends an agent id and a method
//!   id, never a command line;
//! * output is streamed line by line to the UI through a [`JobSink`];
//! * every job is cancellable, and cancelling actually kills the process tree root;
//! * jobs never inherit stdin, so a chatty installer cannot block forever on a prompt.

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::sync::{watch, Mutex};
use ts_rs::TS;

use crate::domain::{InstallAction, InstallPlan};
use crate::error::{AppError, Result};
use crate::platform;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub enum StreamKind {
    Stdout,
    Stderr,
    /// Ahabby's own messages (the command being run, cancellation, exit code).
    System,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct JobOutputEvent {
    pub job_id: String,
    pub stream: StreamKind,
    pub line: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/shared/bindings/")]
pub struct JobOutcome {
    pub job_id: String,
    pub agent_id: String,
    pub action: InstallAction,
    pub command: String,
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub cancelled: bool,
    #[ts(type = "number")]
    pub duration_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

/// Where job output goes. The Tauri implementation emits events to the webview; tests use
/// a channel.
pub trait JobSink: Send + Sync + 'static {
    fn output(&self, event: JobOutputEvent);
    fn finished(&self, outcome: JobOutcome);
}

pub struct JobRunner {
    sink: Arc<dyn JobSink>,
    jobs: Mutex<HashMap<String, watch::Sender<bool>>>,
    counter: AtomicU64,
}

impl JobRunner {
    pub fn new(sink: Arc<dyn JobSink>) -> Arc<Self> {
        Arc::new(Self {
            sink,
            jobs: Mutex::new(HashMap::new()),
            counter: AtomicU64::new(0),
        })
    }

    /// Start a job and return its id immediately.
    pub async fn start(self: &Arc<Self>, plan: InstallPlan) -> Result<String> {
        if plan.program.trim().is_empty() {
            return Err(AppError::InvalidInput(
                "the install plan has no program to run".to_string(),
            ));
        }
        if !plan.manager_available {
            return Err(AppError::ManagerUnavailable {
                manager: plan
                    .manager
                    .binary()
                    .unwrap_or("required package manager")
                    .to_string(),
            });
        }

        let job_id = format!("job-{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1);
        let (sender, receiver) = watch::channel(false);
        self.jobs.lock().await.insert(job_id.clone(), sender);

        let runner = Arc::clone(self);
        let task_id = job_id.clone();
        tokio::spawn(async move {
            let outcome = run_job(runner.sink.clone(), &plan, &task_id, receiver).await;
            runner.jobs.lock().await.remove(&task_id);
            runner.sink.finished(outcome);
        });

        Ok(job_id)
    }

    /// Ask a running job to stop. Returns `false` when it had already finished.
    pub async fn cancel(&self, job_id: &str) -> Result<bool> {
        let jobs = self.jobs.lock().await;
        let Some(sender) = jobs.get(job_id) else {
            return Err(AppError::JobNotFound(job_id.to_string()));
        };
        Ok(sender.send(true).is_ok())
    }

    pub async fn running(&self) -> Vec<String> {
        let mut ids: Vec<String> = self.jobs.lock().await.keys().cloned().collect();
        ids.sort();
        ids
    }
}

async fn run_job(
    sink: Arc<dyn JobSink>,
    plan: &InstallPlan,
    job_id: &str,
    mut cancel: watch::Receiver<bool>,
) -> JobOutcome {
    let started = Instant::now();
    let emit = |stream: StreamKind, line: String| {
        sink.output(JobOutputEvent {
            job_id: job_id.to_string(),
            stream,
            line,
        });
    };

    emit(StreamKind::System, format!("$ {}", plan.display_command));
    if plan.uses_shell {
        emit(
            StreamKind::System,
            "running through the platform shell, as declared by the manifest".to_string(),
        );
    }
    for warning in &plan.warnings {
        emit(StreamKind::System, format!("note: {warning}"));
    }

    let mut command = platform::build_command(&plan.program);
    command.args(&plan.args);

    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            return JobOutcome {
                job_id: job_id.to_string(),
                agent_id: plan.agent_id.clone(),
                action: plan.action,
                command: plan.display_command.clone(),
                ok: false,
                exit_code: None,
                cancelled: false,
                duration_ms: started.elapsed().as_millis() as u64,
                message: Some(format!("could not start `{}`: {error}", plan.program)),
            }
        }
    };

    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    let stdout_task = tokio::spawn(pump(
        stdout,
        sink.clone(),
        job_id.to_string(),
        StreamKind::Stdout,
    ));
    let stderr_task = tokio::spawn(pump(
        stderr,
        sink.clone(),
        job_id.to_string(),
        StreamKind::Stderr,
    ));

    let mut cancelled = false;
    let exit_code = loop {
        tokio::select! {
            biased;
            status = child.wait() => {
                break status.ok().and_then(|status| status.code());
            }
            changed = cancel.changed() => {
                match changed {
                    Ok(()) if *cancel.borrow() => {
                        cancelled = true;
                        emit(StreamKind::System, "cancelling…".to_string());
                        let _ = child.start_kill();
                    }
                    Ok(()) => {}
                    Err(_) => {
                        cancelled = true;
                        let _ = child.start_kill();
                    }
                }
            }
        }
    };

    let _ = stdout_task.await;
    let _ = stderr_task.await;

    let ok = !cancelled && exit_code == Some(0);
    emit(
        StreamKind::System,
        match (cancelled, exit_code) {
            (true, _) => "cancelled".to_string(),
            (false, Some(code)) => format!("exited with code {code}"),
            (false, None) => "process ended without an exit code".to_string(),
        },
    );

    JobOutcome {
        job_id: job_id.to_string(),
        agent_id: plan.agent_id.clone(),
        action: plan.action,
        command: plan.display_command.clone(),
        ok,
        exit_code,
        cancelled,
        duration_ms: started.elapsed().as_millis() as u64,
        message: None,
    }
}

async fn pump<R: AsyncRead + Unpin + Send + 'static>(
    reader: Option<R>,
    sink: Arc<dyn JobSink>,
    job_id: String,
    stream: StreamKind,
) {
    let Some(reader) = reader else {
        return;
    };
    let mut lines = BufReader::new(reader).lines();
    while let Ok(Some(line)) = lines.next_line().await {
        sink.output(JobOutputEvent {
            job_id: job_id.clone(),
            stream,
            line,
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{Manager, Os};
    use tokio::sync::mpsc;

    enum TestEvent {
        Output(JobOutputEvent),
        Done(JobOutcome),
    }

    struct TestSink(mpsc::UnboundedSender<TestEvent>);

    impl JobSink for TestSink {
        fn output(&self, event: JobOutputEvent) {
            let _ = self.0.send(TestEvent::Output(event));
        }
        fn finished(&self, outcome: JobOutcome) {
            let _ = self.0.send(TestEvent::Done(outcome));
        }
    }

    fn plan(program: &str, args: &[&str]) -> InstallPlan {
        InstallPlan {
            agent_id: "unit-agent".to_string(),
            agent_name: "Unit Agent".to_string(),
            action: InstallAction::Install,
            method_id: "test".to_string(),
            manager: Manager::Script,
            program: program.to_string(),
            args: args.iter().map(|arg| (*arg).to_string()).collect(),
            display_command: format!("{program} {}", args.join(" ")),
            uses_shell: false,
            manager_available: true,
            warnings: Vec::new(),
            target_os: Os::current(),
        }
    }

    fn echo_plan(text: &str) -> InstallPlan {
        let (program, args) = platform::shell_invocation(Os::current(), &format!("echo {text}"));
        plan(
            &program,
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
        )
    }

    fn sleep_plan() -> InstallPlan {
        let command = if cfg!(windows) {
            "Start-Sleep -Seconds 30"
        } else {
            "sleep 30"
        };
        let (program, args) = platform::shell_invocation(Os::current(), command);
        plan(
            &program,
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
        )
    }

    /// Collect events until the job finishes.
    async fn drain(
        receiver: mpsc::UnboundedReceiver<TestEvent>,
    ) -> (Vec<JobOutputEvent>, JobOutcome) {
        tokio::time::timeout(std::time::Duration::from_secs(30), drain_inner(receiver))
            .await
            .expect("job did not finish in time")
    }

    async fn drain_inner(
        mut receiver: mpsc::UnboundedReceiver<TestEvent>,
    ) -> (Vec<JobOutputEvent>, JobOutcome) {
        let mut output = Vec::new();
        while let Some(event) = receiver.recv().await {
            match event {
                TestEvent::Output(event) => output.push(event),
                TestEvent::Done(outcome) => return (output, outcome),
            }
        }
        panic!("sink closed before the job finished");
    }

    #[tokio::test]
    async fn streams_output_and_reports_success() {
        let (sender, receiver) = mpsc::unbounded_channel();
        let runner = JobRunner::new(Arc::new(TestSink(sender)));
        let job_id = runner.start(echo_plan("ahabby-install-ok")).await.unwrap();
        assert_eq!(runner.running().await, vec![job_id.clone()]);

        let (output, outcome) = drain(receiver).await;
        assert!(outcome.ok, "outcome: {outcome:?}");
        assert_eq!(outcome.exit_code, Some(0));
        assert!(!outcome.cancelled);
        assert!(output
            .iter()
            .any(|event| event.stream == StreamKind::Stdout
                && event.line.contains("ahabby-install-ok")));
        assert!(output
            .iter()
            .any(|event| event.stream == StreamKind::System
                && event.line.contains("exited with code 0")));
        assert!(runner.running().await.is_empty());
    }

    #[tokio::test]
    async fn reports_failing_commands() {
        let (sender, receiver) = mpsc::unbounded_channel();
        let runner = JobRunner::new(Arc::new(TestSink(sender)));
        let (program, args) = platform::shell_invocation(Os::current(), "exit 4");
        let plan = plan(
            &program,
            &args.iter().map(String::as_str).collect::<Vec<_>>(),
        );
        runner.start(plan).await.unwrap();

        let (_output, outcome) = drain(receiver).await;
        assert!(!outcome.ok);
        assert_eq!(outcome.exit_code, Some(4));
    }

    #[tokio::test]
    async fn cancellation_kills_the_process() {
        let (sender, receiver) = mpsc::unbounded_channel();
        let runner = JobRunner::new(Arc::new(TestSink(sender)));
        let job_id = runner.start(sleep_plan()).await.unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(400)).await;
        assert!(runner.cancel(&job_id).await.unwrap());

        let started = Instant::now();
        let (_output, outcome) = drain(receiver).await;
        assert!(outcome.cancelled, "outcome: {outcome:?}");
        assert!(!outcome.ok);
        assert!(
            started.elapsed() < std::time::Duration::from_secs(20),
            "cancel should not wait for the process to finish on its own"
        );
    }

    #[tokio::test]
    async fn cancelling_an_unknown_job_is_an_error() {
        let (sender, _receiver) = mpsc::unbounded_channel();
        let runner = JobRunner::new(Arc::new(TestSink(sender)));
        let error = runner.cancel("job-999").await.unwrap_err();
        assert_eq!(error.code(), "job_not_found");
    }

    #[tokio::test]
    async fn refuses_unavailable_managers_and_empty_programs() {
        let (sender, _receiver) = mpsc::unbounded_channel();
        let runner = JobRunner::new(Arc::new(TestSink(sender)));

        let mut unavailable = echo_plan("x");
        unavailable.manager_available = false;
        assert_eq!(
            runner.start(unavailable).await.unwrap_err().code(),
            "manager_unavailable"
        );

        let mut empty = echo_plan("x");
        empty.program = "   ".to_string();
        assert_eq!(
            runner.start(empty).await.unwrap_err().code(),
            "invalid_input"
        );
    }
}
