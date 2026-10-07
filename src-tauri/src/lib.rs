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
            commands::agents::cached_agents,
            commands::agents::rescan,
            commands::agents::get_agent,
            commands::agents::remove_agent,
            commands::agents::restore_agent,
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
            commands::configs::reveal_config_fact,
            commands::skills::list_library,
            commands::skills::list_agent_skills,
            commands::skills::create_skill,
            commands::skills::delete_skill,
            commands::skills::set_skill_enabled,
            commands::mcp::list_agent_mcp_servers,
            commands::mcp::create_mcp_server,
            commands::mcp::delete_mcp_server,
            commands::mcp::set_mcp_server_enabled,
            commands::mcp::reveal_mcp_secret,
            commands::hub::list_hub_sources,
            commands::hub::search_hub,
            commands::hub::get_hub_entry,
            commands::hub::install_hub_resource,
            commands::projects::add_project_folder,
            commands::projects::remove_project_folder,
            commands::projects::pick_project_folder,
            commands::install::plan_install,
            commands::install::run_install,
            commands::install::cancel_job,
            commands::install::running_jobs,
            commands::install::rescan_after_job,
            commands::settings::get_settings,
            commands::settings::set_agent_favorite,
            commands::settings::set_sidebar_collapsed,
            commands::settings::set_last_route,
            commands::settings::save_settings,
            commands::settings::set_window_theme,
            commands::terminal::list_terminals,
            commands::terminal::launch_terminal,
            commands::terminal::write_terminal,
            commands::terminal::resize_terminal,
            commands::terminal::close_terminal,
            commands::terminal::list_terminal_sessions,
            commands::terminal::open_in_terminal,
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

    let app = tauri::Builder::default()
        // The dialog plugin is used from Rust only (the native folder picker of the Projects
        // screen): the webview has no permission for it, so nothing in the frontend can open a
        // dialog of its own.
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // The window is created hidden (`"visible": false` in `tauri.conf.json`) and is shown
            // below, once its caption is painted: the webview cannot colour it — the splash is on
            // screen before its bundle, stylesheet or theme round-trip exist, and this closure
            // only ever runs after WebView2 is up — so a window shown at creation would wear the
            // OS caption for as long as the boot takes.
            let window = app
                .get_webview_window("main")
                .map(|webview| webview.as_ref().window());
            if let Some(window) = &window {
                // Read the settings straight from the file: the service that holds them is built
                // with the rest of the state, below.
                if let Ok(config) = app.path().app_config_dir() {
                    let theme = services::SettingsService::load(&config).get().theme;
                    let _ = commands::settings::paint_startup_window_theme(window, theme);
                }
                let _ = window.show();
            }
            let state = state::AppState::new(app.handle())?;
            app.manage(state);
            Ok(())
        })
        .invoke_handler(handlers!())
        .build(tauri::generate_context!())
        .expect("error while running Ahabby");

    app.run(|handle, event| {
        // A terminal session's shell is a child Ahabby owns: on Windows it is not in our
        // process group, so it has to be killed here or the user is left with an orphaned
        // console behind a window that no longer exists.
        if let tauri::RunEvent::Exit = event {
            handle.state::<state::AppState>().terminals().close_all();
        }
    });
}
