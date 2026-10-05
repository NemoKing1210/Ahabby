//! Ahabby — a control panel for the AI coding agents installed on your machine.
//!
//! Layer overview (dependencies only ever point downwards):
//!
//! ```text
//! commands  →  services  →  adapters  →  catalog  →  domain
//!                   ↓            ↓
//!                platform  ──────┘        (OS paths, processes, files, package managers)
//! ```
//!
//! * [`domain`] — pure models, no I/O, mirrored into TypeScript with `ts-rs`;
//! * [`catalog`] — declarative manifests (builtin TOML embedded at compile time + user overrides);
//! * [`adapters`] — the [`adapters::AgentAdapter`] seam; the default implementation is fully
//!   manifest driven;
//! * [`platform`] — everything OS specific;
//! * [`services`] — scanner, installer, config editor, version checker, settings;
//! * [`commands`] — the thin Tauri command surface.

pub mod adapters;
pub mod catalog;
pub mod commands;
pub mod domain;
pub mod error;
pub mod platform;
pub mod services;
pub mod state;

use tauri::Manager;
use tracing_subscriber::EnvFilter;

/// Commands exposed to the frontend. Keep this list in sync with
/// `src/shared/api/ipc.ts`.
macro_rules! handlers {
    () => {
        tauri::generate_handler![
            commands::agents::list_agents,
            commands::agents::rescan,
            commands::agents::get_agent,
            commands::agents::list_package_managers,
            commands::agents::reveal_path,
            commands::agents::open_url,
            commands::configs::read_config,
            commands::configs::preview_config_save,
            commands::configs::save_config,
            commands::configs::list_backups,
            commands::configs::restore_backup,
            commands::configs::backup_root,
            commands::configs::user_catalog_dir,
            commands::skills::list_library,
            commands::skills::list_agent_skills,
            commands::skills::delete_skill,
            commands::mcp::list_agent_mcp_servers,
            commands::mcp::delete_mcp_server,
            commands::mcp::reveal_mcp_secret,
            commands::install::plan_install,
            commands::install::run_install,
            commands::install::cancel_job,
            commands::install::running_jobs,
            commands::install::rescan_after_job,
            commands::settings::get_settings,
            commands::settings::save_settings,
            commands::settings::set_window_theme,
        ]
    };
}

fn init_tracing() {
    let filter = EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| EnvFilter::new("warn,ahabby_lib=info,ahabby=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(filter)
        .with_target(false)
        .try_init();
}

pub fn run() {
    init_tracing();

    tauri::Builder::default()
        .setup(|app| {
            let state = state::AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(handlers!())
        .run(tauri::generate_context!())
        .expect("error while running Ahabby");
}
