//! Diagnostic tool: scan this machine and print what Ahabby sees.
//!
//! ```bash
//! cargo run --manifest-path src-tauri/Cargo.toml --example scan
//! cargo run --manifest-path src-tauri/Cargo.toml --example scan -- --json
//! ```
//!
//! Maintainers use it to check a new manifest against a real installation without launching the
//! desktop app (which needs a window and a webview).

use std::path::PathBuf;

use ahabby_lib::catalog;
use ahabby_lib::domain::{Agent, AgentStatus};
use ahabby_lib::platform::PlatformContext;
use ahabby_lib::services::{aggregate, Scanner};

fn data_dir(name: &str) -> PathBuf {
    dirs::data_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(name)
}

fn config_dir(name: &str) -> PathBuf {
    dirs::config_dir()
        .or_else(dirs::home_dir)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(name)
}

fn describe(agent: &Agent) -> String {
    let version = agent
        .version
        .as_ref()
        .map(|version| version.raw.clone())
        .unwrap_or_else(|| "-".to_string());
    let mut lines = vec![format!(
        "{} [{}] version={} binary={} via={}",
        agent.name,
        match agent.status {
            AgentStatus::Installed => "installed",
            AgentStatus::NotInstalled => "not installed",
        },
        version,
        agent.binary_path.as_deref().unwrap_or("-"),
        agent.installed_via.as_deref().unwrap_or("-")
    )];
    lines.push(format!(
        "    configs: {} ({} existing), skills: {}, mcp: {}, other: {}",
        agent.configs.len(),
        agent.configs.iter().filter(|config| config.exists).count(),
        agent.skills.len(),
        agent.mcp_servers.len(),
        agent.other.len()
    ));
    for warning in &agent.warnings {
        lines.push(format!("    warning: {warning}"));
    }
    if !agent.unverified.is_empty() {
        lines.push(format!("    unverified: {}", agent.unverified.join(", ")));
    }
    lines.join("\n")
}

#[tokio::main]
async fn main() {
    let as_json = std::env::args().any(|argument| argument == "--json");
    let app_data = data_dir("ahabby");
    let app_config = config_dir("ahabby");

    let catalog = catalog::load(Some(&app_config.join("catalog")));
    for problem in &catalog.problems {
        eprintln!(
            "catalog {:?}: {} ({})",
            problem.severity, problem.message, problem.source
        );
    }

    let context = PlatformContext::detect(app_data, app_config, Vec::new());
    let scanner = Scanner::new(&catalog);
    let report = scanner.scan(&context, None).await;
    let library = aggregate(&report);

    if as_json {
        match serde_json::to_string_pretty(&report) {
            Ok(json) => println!("{json}"),
            Err(error) => eprintln!("cannot serialize the report: {error}"),
        }
        return;
    }

    println!(
        "Ahabby scan: os={} agents={} installed={} available={} took={}ms",
        report.os.as_str(),
        report.agents.len(),
        report.installed,
        report.available_to_install,
        report.duration_ms
    );
    println!(
        "library: skills={} mcp={} other={}",
        library.stats.skills, library.stats.mcp_servers, library.stats.other
    );
    println!();

    for agent in report.agents.iter().filter(|agent| agent.is_installed()) {
        println!("{}", describe(agent));
    }

    let missing: Vec<&str> = report
        .agents
        .iter()
        .filter(|agent| !agent.is_installed())
        .map(|agent| agent.id.as_str())
        .collect();
    println!();
    println!("not installed: {}", missing.join(", "));
}
