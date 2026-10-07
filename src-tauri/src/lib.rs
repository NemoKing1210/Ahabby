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
pub mod desktop;
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
        // Same terms for the login item: `desktop::autostart` drives it from Rust, the webview is
        // given none of its permissions and no package for it. No arguments are passed to the
        // registered command line — whether a launch shows its window is `Settings::start_minimized`,
        // which is applied on every save instead of being frozen into the login item.
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // The close button is the tray's business: with `close_to_tray` the window is not closed
        // at all, it is put away, and Ahabby lives on in the tray until `Quit` is picked there.
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if desktop::window::close_to_tray(window.app_handle()) {
                    api.prevent_close();
                }
            }
        })
        .setup(|app| {
            let state = state::AppState::new(app.handle())?;
            // The login item is the only thing Ahabby describes that lives outside its own config
            // directory, so the OS is asked what it actually holds and the file is corrected
            // rather than re-applied blindly: a user who removed Ahabby from their startup apps
            // must not have it put back by the next launch.
            if let Some(enabled) = desktop::autostart::is_enabled(app.handle()) {
                if enabled != state.settings().launch_at_login {
                    let _ = state.set_launch_at_login(enabled);
                }
            }
            app.manage(state);
            // The tray exists before the window is shown, because the window may never be shown:
            // it is also what makes `start_minimized` safe to honour.
            desktop::sync(app.handle());

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
                // with the rest of the state, above.
                if let Ok(config) = app.path().app_config_dir() {
                    let theme = services::SettingsService::load(&config).get().theme;
                    let _ = commands::settings::paint_startup_window_theme(window, theme);
                }
                // A launch that starts in the tray leaves the window hidden — but only when a tray
                // icon is really there: a platform that could not create one must never leave a
                // running process with no surface to click, whatever the settings file says.
                let start_in_tray = app.state::<state::AppState>().settings().starts_in_tray()
                    && app.tray_by_id(desktop::tray::TRAY_ID).is_some();
                if start_in_tray {
                    tracing::info!("starting in the tray: the window stays hidden");
                } else {
                    let _ = window.show();
                }
            }
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
