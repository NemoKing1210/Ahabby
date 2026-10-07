//! Ahabby's tray icon: what it says, what its menu offers and what a click on either does.
//!
//! The tray is the one surface the webview does not draw, which shapes everything here:
//!
//! * the menu is *planned* as plain data ([`plan`]) and only then turned into native items, so
//!   what the user will see can be asserted in a test without a running application;
//! * the entries that act on the application itself are finished here (`Scan again`, `Quit`),
//!   while the two that need a screen the window owns — going somewhere, running an agent in the
//!   terminal — bring the window forward and *ask* the frontend over the event bus, so the tray
//!   starts its session through the very same code path as the button on an agent's page;
//! * the menu is rebuilt whenever the settings or the scan change ([`sync`]), because it lists
//!   what this machine actually has installed.

use tauri::menu::{
    IsMenuItem, Menu, MenuBuilder, MenuItemBuilder, MenuItemKind, PredefinedMenuItem,
    SubmenuBuilder,
};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tracing::{info, warn};

use crate::domain::Agent;
use crate::services::{Language, ScanReport};
use crate::state::{events, AppState};

use super::window;

/// The id Ahabby's tray icon is registered under — what `AppHandle::tray_by_id` looks it up by,
/// and what says whether the tray is on screen at all.
pub const TRAY_ID: &str = "ahabby";

/// Ids of the fixed entries. Two of them carry a subject (`goto:<route>`, `run:<agent id>`), which
/// is what lets one handler serve a list that changes with every scan without a closure per item.
const ID_STATUS: &str = "status";
const ID_OPEN: &str = "open";
const ID_GOTO: &str = "goto";
const ID_RUN: &str = "run";
const ID_RUN_EMPTY: &str = "run-empty";
const ID_RESCAN: &str = "rescan";
const ID_QUIT: &str = "quit";
const NAVIGATE_PREFIX: &str = "goto:";
const RUN_PREFIX: &str = "run:";

/// The screens the tray offers, each with the key of its label in the i18n bundle — the same key
/// the sidebar uses, so the two cannot describe one screen differently. The test at the bottom of
/// this file reads `src/shared/i18n/locales/*.json` and fails when they drift apart.
const DESTINATIONS: [(&str, &str); 6] = [
    ("/", "home"),
    ("/agents", "agents"),
    ("/projects", "projects"),
    ("/library", "library"),
    ("/hub", "hub"),
    ("/settings", "settings"),
];

/// Every string the tray shows, in the language picked in Settings. The tray cannot read the i18n
/// bundle — the OS draws it, not the webview — so the strings live here, next to the menu that
/// uses them.
struct Labels {
    open: &'static str,
    go_to: &'static str,
    run: &'static str,
    run_empty: &'static str,
    rescan: &'static str,
    quit: &'static str,
    never_scanned: &'static str,
    agents: &'static str,
    updates: &'static str,
    /// Labels of [`DESTINATIONS`], in the same order.
    nav: [&'static str; DESTINATIONS.len()],
}

impl Labels {
    fn for_language(language: Language) -> Self {
        match language {
            Language::En => Self {
                open: "Open Ahabby",
                go_to: "Go to",
                run: "Run in terminal",
                run_empty: "No agent is installed",
                rescan: "Scan again",
                quit: "Quit Ahabby",
                never_scanned: "Not scanned yet",
                agents: "Agents",
                updates: "Updates",
                nav: ["Home", "Agents", "Projects", "Library", "Hub", "Settings"],
            },
            Language::Ru => Self {
                open: "Открыть Ahabby",
                go_to: "Перейти",
                run: "Запустить в терминале",
                run_empty: "Ни один агент не установлен",
                rescan: "Сканировать заново",
                quit: "Выйти из Ahabby",
                never_scanned: "Ещё не сканировано",
                agents: "Агентов",
                updates: "Обновлений",
                nav: [
                    "Главная",
                    "Агенты",
                    "Проекты",
                    "Библиотека",
                    "Хаб",
                    "Настройки",
                ],
            },
        }
    }

    /// The line the menu opens with: what this machine holds, or that nothing has been read yet.
    ///
    /// Counts are labelled rather than pluralized: "8 агентов" and "1 агент" cannot share a format
    /// string without a plural table, and a menu the bundle never touches has nowhere to put one.
    fn status(&self, summary: Option<&Summary>) -> String {
        match summary {
            None => self.never_scanned.to_string(),
            Some(summary) => format!(
                "{}: {} · {}: {}",
                self.agents, summary.installed, self.updates, summary.updates
            ),
        }
    }
}

/// An agent the tray can start, flattened out of the report: a name to show and an id to ask the
/// frontend to run, and nothing else.
#[derive(Debug, Clone, PartialEq, Eq)]
struct TrayAgent {
    id: String,
    name: String,
}

/// What the last scan says about the machine, as far as the tray is concerned.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Summary {
    installed: usize,
    updates: usize,
    agents: Vec<TrayAgent>,
}

impl Summary {
    /// `None` means nothing has been scanned yet — a state the menu admits to instead of showing
    /// a machine with no agents in it.
    fn of(report: Option<&ScanReport>) -> Option<Self> {
        let report = report?;
        Some(Self {
            installed: report.installed,
            updates: report
                .agents
                .iter()
                .filter(|agent| agent.update.is_some())
                .count(),
            agents: report
                .agents
                .iter()
                .filter(|agent| startable(agent))
                .map(|agent| TrayAgent {
                    id: agent.id.clone(),
                    name: agent.name.clone(),
                })
                .collect(),
        })
    }
}

/// Whether the tray may offer to start this agent: it has to be installed, and the scan has to
/// know the executable — the tray asks for a session by agent id alone, and an id with no binary
/// behind it would only fail once the user had already clicked.
fn startable(agent: &Agent) -> bool {
    agent.is_installed() && agent.binary_path.is_some()
}

/// One entry of the menu before it becomes a native item.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Entry {
    Item {
        id: String,
        label: String,
        enabled: bool,
    },
    Separator,
    Submenu {
        id: String,
        label: String,
        items: Vec<Entry>,
    },
}

/// The whole tray, as data.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Plan {
    tooltip: String,
    entries: Vec<Entry>,
}

/// Plan the tray for a language, the last scan and the application's own name.
fn plan(app_name: &str, language: Language, summary: Option<&Summary>) -> Plan {
    let labels = Labels::for_language(language);
    let status = labels.status(summary);

    let destinations = DESTINATIONS
        .iter()
        .zip(labels.nav)
        .map(|((route, _), label)| Entry::Item {
            id: format!("{NAVIGATE_PREFIX}{route}"),
            label: label.to_string(),
            enabled: true,
        })
        .collect();

    let startable = summary
        .map(|summary| summary.agents.as_slice())
        .unwrap_or(&[]);
    let runs = if startable.is_empty() {
        vec![Entry::Item {
            id: ID_RUN_EMPTY.to_string(),
            label: labels.run_empty.to_string(),
            enabled: false,
        }]
    } else {
        startable
            .iter()
            .map(|agent| Entry::Item {
                id: format!("{RUN_PREFIX}{}", agent.id),
                label: agent.name.clone(),
                enabled: true,
            })
            .collect()
    };

    Plan {
        tooltip: format!("{app_name} — {status}"),
        entries: vec![
            Entry::Item {
                id: ID_STATUS.to_string(),
                label: status,
                enabled: false,
            },
            Entry::Separator,
            Entry::Item {
                id: ID_OPEN.to_string(),
                label: labels.open.to_string(),
                enabled: true,
            },
            Entry::Separator,
            Entry::Submenu {
                id: ID_GOTO.to_string(),
                label: labels.go_to.to_string(),
                items: destinations,
            },
            Entry::Submenu {
                id: ID_RUN.to_string(),
                label: labels.run.to_string(),
                items: runs,
            },
            Entry::Separator,
            Entry::Item {
                id: ID_RESCAN.to_string(),
                label: labels.rescan.to_string(),
                enabled: true,
            },
            Entry::Separator,
            Entry::Item {
                id: ID_QUIT.to_string(),
                label: labels.quit.to_string(),
                enabled: true,
            },
        ],
    }
}

/// Put the desktop in the shape the settings describe: create the tray, refresh the menu it shows,
/// or take the icon away.
///
/// Called at startup, on every settings save and whenever a scan finishes. Safe from any thread:
/// menus belong to the main one, so the work is handed over to it.
pub fn sync<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    if let Err(error) = app.clone().run_on_main_thread(move || on_main_thread(&app)) {
        warn!("could not reach the main thread to update the tray: {error}");
    }
}

fn on_main_thread<R: Runtime>(app: &AppHandle<R>) {
    let state = app.state::<AppState>();
    let settings = state.settings();
    let report = state.report().ok();
    let plan = plan(
        &app.package_info().name,
        settings.language,
        Summary::of(report.as_ref()).as_ref(),
    );

    if !settings.tray_icon {
        if app.remove_tray_by_id(TRAY_ID).is_some() {
            info!("tray icon removed");
        }
        return;
    }

    let menu = match build_menu(app, &plan.entries) {
        Ok(menu) => menu,
        Err(error) => {
            warn!("could not build the tray menu: {error}");
            return;
        }
    };

    match app.tray_by_id(TRAY_ID) {
        // The menu is replaced wholesale, which is what keeps a language change, a finished scan
        // and a switched-off tray icon from needing three different code paths.
        Some(tray) => {
            if let Err(error) = tray.set_menu(Some(menu)) {
                warn!("could not replace the tray menu: {error}");
            }
            let _ = tray.set_tooltip(Some(plan.tooltip.as_str()));
        }
        None => create(app, &menu, &plan.tooltip),
    }
}

/// Create the icon itself.
///
/// The menu goes into the builder rather than being set afterwards, because a tray icon with no
/// menu is not shown at all on some Linux desktops.
fn create<R: Runtime>(app: &AppHandle<R>, menu: &Menu<R>, tooltip: &str) {
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(menu)
        .tooltip(tooltip)
        // The left button belongs to the user and not to the menu: it brings the window back (or
        // puts it away). The menu is what the right button opens.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| on_menu_event(app, event.id().as_ref()))
        .on_tray_icon_event(|tray, event| on_icon_event(tray.app_handle(), &event));
    match app.default_window_icon() {
        Some(icon) => builder = builder.icon(icon.clone()),
        None => warn!("no application icon to put in the tray"),
    }
    match builder.build(app) {
        Ok(_) => info!("tray icon created"),
        Err(error) => warn!("could not create the tray icon: {error}"),
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>, entries: &[Entry]) -> tauri::Result<Menu<R>> {
    let items = build_entries(app, entries)?;
    MenuBuilder::new(app).items(&as_items(&items)).build()
}

fn build_entries<R: Runtime>(
    app: &AppHandle<R>,
    entries: &[Entry],
) -> tauri::Result<Vec<MenuItemKind<R>>> {
    entries
        .iter()
        .map(|entry| build_entry(app, entry))
        .collect()
}

fn build_entry<R: Runtime>(app: &AppHandle<R>, entry: &Entry) -> tauri::Result<MenuItemKind<R>> {
    Ok(match entry {
        Entry::Item { id, label, enabled } => MenuItemKind::MenuItem(
            MenuItemBuilder::with_id(id.clone(), label)
                .enabled(*enabled)
                .build(app)?,
        ),
        Entry::Separator => MenuItemKind::Predefined(PredefinedMenuItem::separator(app)?),
        Entry::Submenu { id, label, items } => {
            let children = build_entries(app, items)?;
            MenuItemKind::Submenu(
                SubmenuBuilder::with_id(app, id.clone(), label)
                    .items(&as_items(&children))
                    .build()?,
            )
        }
    })
}

fn as_items<R: Runtime>(items: &[MenuItemKind<R>]) -> Vec<&dyn IsMenuItem<R>> {
    items
        .iter()
        .map(|item| item as &dyn IsMenuItem<R>)
        .collect()
}

/// What a menu entry does. The retired status line and the separators are not clickable, and
/// anything else is an id Ahabby did not write — nothing to do, and nothing to guess.
fn on_menu_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
    if id == ID_OPEN {
        window::show(app);
    } else if id == ID_RESCAN {
        rescan(app);
    } else if id == ID_QUIT {
        // `exit` and not `close`: quitting from the tray has to work even when the close button
        // is set to hide the window, and it is what runs the shutdown hooks (the terminal sessions
        // Ahabby owns are closed by `RunEvent::Exit`).
        app.exit(0);
    } else if let Some(route) = id.strip_prefix(NAVIGATE_PREFIX) {
        window::show(app);
        let _ = app.emit(events::TRAY_NAVIGATE, route.to_string());
    } else if let Some(agent_id) = id.strip_prefix(RUN_PREFIX) {
        window::show(app);
        let _ = app.emit(events::TRAY_RUN_AGENT, agent_id.to_string());
    }
}

/// A click on the icon itself: left toggles the window, anything else is the menu's business.
fn on_icon_event<R: Runtime>(app: &AppHandle<R>, event: &TrayIconEvent) {
    if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
    } = event
    {
        window::toggle(app);
    }
}

/// "Scan again": the scan the window's own Refresh button runs, so the two always agree.
///
/// It goes to the runtime's thread pool — a menu click must not block the event loop — and this
/// very menu is rebuilt by the scan sink once the report lands, which is also how the counts and
/// the list of runnable agents stay current.
fn rescan<R: Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let report = app.state::<AppState>().scan().await;
        info!(installed = report.installed, "tray scan finished");
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The bundle the webview renders, so the tray can be compared with it instead of trusted.
    fn locale(language: &str) -> serde_json::Value {
        let raw = match language {
            "en" => include_str!("../../../src/shared/i18n/locales/en.json"),
            "ru" => include_str!("../../../src/shared/i18n/locales/ru.json"),
            other => panic!("unexpected locale {other}"),
        };
        serde_json::from_str(raw).expect("the locale files are JSON")
    }

    fn summary() -> Summary {
        Summary {
            installed: 8,
            updates: 2,
            agents: vec![
                TrayAgent {
                    id: "claude-code".into(),
                    name: "Claude Code".into(),
                },
                TrayAgent {
                    id: "codex".into(),
                    name: "Codex CLI".into(),
                },
            ],
        }
    }

    /// Every label of the menu, in the order the user reads them, with the id the handler sees.
    fn walk(entries: &[Entry], found: &mut Vec<(String, Option<String>, bool)>) {
        for entry in entries {
            match entry {
                Entry::Item { id, label, enabled } => {
                    found.push((id.clone(), Some(label.clone()), *enabled))
                }
                Entry::Separator => found.push(("separator".to_string(), None, false)),
                Entry::Submenu { id, label, items } => {
                    found.push((id.clone(), Some(label.clone()), true));
                    walk(items, found);
                }
            }
        }
    }

    fn flat(plan: &Plan) -> Vec<(String, Option<String>, bool)> {
        let mut found = Vec::new();
        walk(&plan.entries, &mut found);
        found
    }

    fn labelled(plan: &Plan, id: &str) -> String {
        flat(plan)
            .into_iter()
            .find(|(entry, _, _)| entry == id)
            .map(|(_, label, _)| label.unwrap_or_default())
            .unwrap_or_else(|| panic!("the menu has no entry {id}"))
    }

    #[test]
    fn the_menu_opens_with_what_the_last_scan_found() {
        let plan = plan("Ahabby", Language::En, Some(&summary()));

        assert_eq!(labelled(&plan, ID_STATUS), "Agents: 8 · Updates: 2");
        assert!(plan.tooltip.starts_with("Ahabby — Agents: 8"));
        // The status line is the one entry that is not a command.
        let status = flat(&plan)
            .into_iter()
            .find(|(id, _, _)| id == ID_STATUS)
            .expect("a status entry");
        assert!(!status.2);
    }

    #[test]
    fn a_menu_without_a_scan_admits_it_instead_of_showing_an_empty_machine() {
        let plan = plan("Ahabby", Language::En, None);

        assert_eq!(labelled(&plan, ID_STATUS), "Not scanned yet");
        assert_eq!(labelled(&plan, ID_RUN_EMPTY), "No agent is installed");
    }

    #[test]
    fn every_screen_of_the_shell_is_one_click_away() {
        let plan = plan("Ahabby", Language::En, Some(&summary()));
        let ids: Vec<String> = flat(&plan).into_iter().map(|(id, _, _)| id).collect();

        for (route, _) in DESTINATIONS {
            assert!(
                ids.contains(&format!("{NAVIGATE_PREFIX}{route}")),
                "the tray cannot reach {route}"
            );
        }
        assert!(ids.contains(&ID_OPEN.to_string()));
        assert!(ids.contains(&ID_RESCAN.to_string()));
        assert!(ids.contains(&ID_QUIT.to_string()));
    }

    #[test]
    fn only_agents_the_scan_can_start_are_offered() {
        let menu = plan("Ahabby", Language::En, Some(&summary()));

        assert_eq!(labelled(&menu, "run:claude-code"), "Claude Code");
        assert_eq!(labelled(&menu, "run:codex"), "Codex CLI");

        let empty = Summary {
            installed: 0,
            updates: 0,
            agents: Vec::new(),
        };
        let menu = plan("Ahabby", Language::En, Some(&empty));
        assert_eq!(labelled(&menu, ID_RUN_EMPTY), "No agent is installed");
        assert!(
            !flat(&menu)
                .iter()
                .any(|(id, _, _)| id.starts_with(RUN_PREFIX)),
            "an empty scan must not leave a runnable entry behind"
        );
    }

    #[test]
    fn the_tray_speaks_every_language_the_interface_does() {
        // The screens the tray offers carry the names the sidebar uses: the bundle is the truth,
        // and the table next to the menu is checked against it rather than trusted.
        for (locale_code, language) in [("en", Language::En), ("ru", Language::Ru)] {
            let bundle = locale(locale_code);
            for ((route, key), label) in DESTINATIONS.iter().zip(Labels::for_language(language).nav)
            {
                assert_eq!(
                    bundle["nav"][*key].as_str(),
                    Some(label),
                    "the tray's label for {route} drifted from the sidebar's"
                );
            }
        }

        // Every other string is spelled out per language: a table copied twice would pass the
        // checks above and leave a Russian user reading English.
        let (en, ru) = (
            Labels::for_language(Language::En),
            Labels::for_language(Language::Ru),
        );
        for (field, english, russian) in [
            ("open", en.open, ru.open),
            ("go_to", en.go_to, ru.go_to),
            ("run", en.run, ru.run),
            ("run_empty", en.run_empty, ru.run_empty),
            ("rescan", en.rescan, ru.rescan),
            ("quit", en.quit, ru.quit),
            ("never_scanned", en.never_scanned, ru.never_scanned),
            ("agents", en.agents, ru.agents),
            ("updates", en.updates, ru.updates),
        ] {
            assert_ne!(english, russian, "the tray's {field} was left in English");
        }
    }
}
