# Changelog

All notable changes to Ahabby are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.38.1] - 2026-10-08

### Changed

- **"Quick info" is now "Quick settings".** The panel on an agent page is headed "Quick settings"
  in English (`Быстрые настройки` in Russian), and its hint says the values can be changed there,
  not only read.

## [0.38.0] - 2026-10-08

### Added

- **The `anti-slop` collection in the Hub.** Six skills from Miqdad Badjuber's ruleset against
  generic, machine-made output — the always-loaded core filter plus one per concern (UI and
  visual, copy and text, human and accessibility, mobile layout, code comments). Browsable and
  installable like any other collection; each skill links to the core `antislop.md`, which stays
  in the repository.

## [0.37.1] - 2026-10-07

### Changed

- **Every picker that offers an agent lists the favourites first.** The owner picker of a new
  skill or MCP server (and of a Hub install), the agent select of a new terminal, the Library's
  agent filter and the "run an agent here" picker all follow the same order as the agents list:
  pinned agents first — in the order they were pinned — then the rest. Where the agent-neutral
  shared surface is one of the answers it stays first, because it is the default of those forms
  rather than an agent.

## [0.37.0] - 2026-10-07

### Added

- **An Extensions tab on every agent page.** The tab is always there, and for an agent whose
  manifest declares no extensions surface it says so instead of showing an empty list.
- **Extensions of Pi are read and managed.** Ahabby lists the packages the settings declare (npm,
  git and local, with the version, description, author and links read from the installed
  `package.json`), the modules in the extensions directory and the ones Pi ships itself. Each row
  opens a details dialog, a package is updated or removed through Pi's own CLI (with the resolved
  command confirmed first and its output streamed in the job console), a local module is switched
  off by renaming its entry file or removed to the OS trash, and its source can be opened in the
  editor.
- **`[[extensions]]` in the manifest schema.** A manifest opts into the surface with one entry
  (`format = "pi"`, the extensions directory, the settings document that declares packages and the
  built-in names); an agent without one has no extensions tab content.
- **The extensions list opens on the packages.** The modules in the extensions directory and the
  ones Pi ships itself are behind a type filter with counts, so the list starts with what the user
  actually installed — and a filter that hides everything always offers a way back.

### Changed

- A document the editor can open now also covers an extension's entry file, resolved through the
  same scan-backed path checks as a config or a skill.

## [0.36.1] - 2026-10-07

### Fixed

- **An agent starts in the terminal every time.** The command line is handed to the shell only once
  the shell has drawn its first prompt, instead of being written into a console that may not be
  listening yet — a line swallowed at startup was an agent that never appeared. The PTY is also
  given the `TERM` and `COLORTERM` a desktop launch does not inherit, so a full-screen agent no
  longer drops its colours, its frames or its box drawing, or refuses to start at all.
- **A terminal keeps what it has already painted.** The emulator now belongs to the session rather
  than to the component that shows it, so a screen that React mounts twice (which is what
  development does) shows the same scrollback again instead of a blank terminal that only fills in
  once the agent prints something new.
- **A tab never claims to be alive when it is not.** A process that ends before its tab is painted,
  a session the backend no longer holds, and a keystroke sent to a session that is already gone all
  now end up shown as ended — with the restart button — instead of swallowing input silently.
  Reconciling after a reload also finishes the tabs of sessions that no longer exist, next to
  closing the sessions that no tabs can reach.
- **The “process ended” strip no longer covers the terminal.** It takes its own row under the
  output, so the last lines an agent printed — the ones that say why it ended — stay readable.
- **The New terminal dialog works while the scan is still running.** It falls back to the first
  installed agent instead of opening with a choice nothing could ever select.

### Changed

- A burst of PTY output is coalesced into far fewer events, and a session is published to the
  frontend only once every thread that keeps it alive is running — a failure to start the reader
  leaves no console behind.

## [0.36.0] - 2026-10-07

### Added

- **Every package manager and installer has its own mark.** npm, pnpm, Yarn, Bun, Homebrew, WinGet,
  Scoop, pipx, pip, Cargo and Go are identified by a brand tile wherever Ahabby names them: the install
  methods of an agent's overview, the detected method on its card, the package-manager picker of the run
  dialog, the removal dialog and the list of managers found on Settings → About. The marks come from
  simple-icons (CC0-1.0); WinGet and Scoop publish none, so Ahabby draws those two itself. An official
  install script and a manual install are not products, so they keep the neutral tile with a mark that
  says which they are instead of a made-up colour.

### Changed

- **A manager is named the way people say it.** Where the id of an install method was shown raw, the
  method now reads with its manager — `Homebrew`, `WinGet`, `Install script`, `Manual` — translated in
  both languages, and the picker adds that name beside a method whose own id does not already say it
  (`native-installer`).

## [0.35.0] - 2026-10-07

### Added

- **The Hub filters by what you already have.** A chip row next to the kind filter switches between every
  entry, the ones this machine holds and the ones it does not, so a collection of hundreds can be read as
  “what is still missing”. The answer comes from the scan — the same source the “Installed” badge is read
  from — so switching the filter asks the collection for nothing, and an entry installed from anywhere shows
  up under “Installed” as soon as the report lands. When the filter hides every entry of a source that was
  already read, the section says so instead of going blank, and points at Load more while the collection has
  more to read.

## [0.34.0] - 2026-10-07

### Added

- **Seven more agents, taking the catalog from 34 to 41**: Mistral Vibe, Kimi Code CLI, Qoder CLI,
  Muse Code, Freebuff, DeepSeek Harness and TraeCode CLI — each with its config files, skills
  directory, MCP servers, instructions, custom agents and install/update commands
- Brand tiles for the new agents (Mistral, Kimi, Qoder, Meta, DeepSeek, Trae and the Freebuff lime), so
  the card, the picker and the badge paint the brand instead of a monogram

### Changed

- Every new manifest carries a `# SOURCE:` comment pointing at the vendor's own documentation, and the
  one path those docs do not confirm (TraeCode CLI's skills directory) is listed under `unverified`
  rather than guessed

## [0.33.0] - 2026-10-07

### Added

- **The Hub says what you already have.** A skill or an MCP server that is already on this machine wears an
  “Installed” badge on its card, with a chip per owner that holds it — the agent-neutral shared surface, a
  named agent, or one of your projects — so the same entry is never installed twice by accident. A copy
  that is switched off, or that no longer matches what the collection publishes, is marked as such: the
  installed copy is compared with the published one by content (a skill by the SHA-256 of its `SKILL.md`, a
  server by its launch recipe), which needs no extra request because a repository is read to list its skills
  anyway. The preview and the install dialog list every copy with the path it lives at, and a name an owner
  already holds is refused in the form instead of by the backend.

## [0.32.0] - 2026-10-07

### Added

- **A folder on the Projects screen folds away.** The chevron on a folder's card collapses the projects it
  found and opens them again — the card keeps its name, its path and its project count, so a long list of
  folders stays readable. Where a group was left is remembered for the rest of the session, the way the
  screen's filters are, and a restart starts with every group open.

## [0.31.1] - 2026-10-07

### Changed

- **Ahabby wears its new icon.** The window, the title bar, the taskbar button and the tray all draw the
  application icon the binary carries, and that icon is now the new mark.

### Fixed

- Replacing `src-tauri/icons/icon.ico` no longer leaves the old icon in the built binary. The build script
  now tracks the `icons/` directory, so the next build re-embeds the icon instead of reusing the resource it
  compiled before the change — previously a rebuild after an icon-only change silently kept the old face on
  the window, the taskbar and the tray.

## [0.31.0] - 2026-10-07

### Added

- **Ahabby has its own browser, and a link can no longer take the window with it.** Clicking a link in a
  document — a `SKILL.md`, a user's `AGENTS.md` or `USER.md`, a command's markdown, an agent's website or
  docs button, a URL printed in the terminal — opens it in a reader inside the app instead of navigating
  Ahabby's window away to a page it cannot come back from. The reader is a window of its own: back, forward,
  reload, an address bar you can type an address into, copy, and **Open in your browser** for the pages it
  will not show.
- **The window never loads a remote origin.** A page is read by the backend — through the same proxy as every
  other network call, with a size cap, a timeout, a redirect limit, and the charset the page declares — and
  sanitized before it is drawn, so a third-party page can never run script next to the app or be framed into
  it, and its images travel through the backend too. The reader shows the article with Ahabby's own
  typography, drops the navigation, footers and sidebars around it, and keeps its own place in the page.
- **A link Ahabby cannot open is text, not a trap.** Documents are full of relative and in-page links that
  the window used to resolve against Ahabby's own address, which is what broke the app; those now read as
  plain text, while a host written without a scheme (`docs.example.com`) becomes a working link. A page that
  draws itself with its own scripts, one that is too short to be worth reading, or one the reader cannot show
  at all (a PDF, an image) says so and hands it to your browser instead.

## [0.30.0] - 2026-10-07

### Added

- **Ahabby has a system tray, and its menu is a control panel of its own.** The icon says what the last scan
  found (how many agents, how many have an update), a left click brings the window back or puts it away, and
  a right click opens a menu that reopens the window, jumps straight to Agents, Projects, Library, Hub or
  Settings, starts an installed agent in the terminal — Ahabby's own or the external one picked in Settings —
  scans the machine again, and quits. The menu is written in the interface language and is rebuilt after
  every scan, so it never offers an agent that is not there any more.
- **Settings → Window & tray** groups how Ahabby starts and how it ends: launch at login, the tray icon, keep
  running when the window is closed, and start hidden in the tray. The login item is registered with the
  operating system before the setting is stored, so a registration that fails is an error instead of a saved
  lie — and a login item removed in the OS's own startup settings turns the switch off rather than being
  silently put back.
- **Closing the window can now mean "keep working".** With the tray icon on, the close button hides the
  window instead of quitting: a running install and the open terminal sessions go on, and Quit in the tray
  menu is what really exits. Without a tray icon — or on a machine where one cannot be created — the window
  is never hidden, because a process with no surface to click is worse than a closed window.

## [0.29.1] - 2026-10-07

### Changed

- **The filters a screen is left with are still there when you come back to it.** The Agents search box, its
  scope and its facet chips, the Hub's search, kind, source and tags, the Library's search, owning agent,
  origin, sort, facet, tab and activity, and which half of a skills or MCP list you were looking at all
  survive a trip to another screen — and from one agent's skills tab to the next agent's. Nothing is written
  to disk: a filter is a way of looking at a list, not a preference, so it is kept for exactly as long as the
  session is, and a restart starts from a clean slate.

## [0.29.0] - 2026-10-07

### Added

- **The Agents screen can filter for the agents that route through a proxy.** A "With proxy" chip joins the
  property filters, and it means exactly what the scan already knows: the agent's own config files — a JSON,
  TOML or YAML setting, or an `env` section (or a `.env` file) with `HTTP_PROXY` and friends — carry a value
  the scan read as a proxy, with the credentials in it masked. Such an agent now also says so on its card, so
  the chip never hides a property you cannot see; an agent that is not installed has no config to read and is
  therefore not counted.

## [0.28.7] - 2026-10-07

### Changed

- **The background refresh is a whisper now.** The band that crosses a card while its agent is being
  re-inspected is a one-pixel hairline at two thirds of the accent's strength, sweeping over 2.6 s instead of
  1.2 s, and the wash that fades out on a card whose fresh data just landed starts at half opacity — a scan
  running behind the screen is something to notice in the corner of the eye, not to watch.

## [0.28.6] - 2026-10-07

### Changed

- **The Home screen now knows about every screen the app has.** Two summaries join the four it already
  showed — the folders you work in, and the collections the Hub reads — and the "Go to" list leads to Projects
  and the Hub beside Agents, the Library and Settings. The "What Ahabby is" card gained what the Hub promises
  (a collection is installed through the same path checks, backups and config edits as the manual forms), and
  its privacy line now names the Hub among the features that reach the network, because it does. The two
  cards of the page — "Go to" and "What Ahabby is" — now span its full width, one under the other, instead of
  sharing a row: a half-width column squeezed the rows and the prose into the same 40-odd characters.

## [0.28.5] - 2026-10-07

### Changed

- **Every list in the app now animates its own contents.** A row that leaves — a skill narrowed away by a
  filter, an agent hidden, a tag folded shut, a terminal tab closed — fades out where it stood while the rows
  around it slide into the gap, a row that arrives eases in, and the ones that come later never queue behind
  a stagger. The agent roster on the Home screen, the sidebar's favourites, the Hub's tag row and source
  sections, the fact rows of an agent and the settings lists all move the same way. An OS that asks for less
  motion keeps the fade and drops the movement.

## [0.28.4] - 2026-10-07

### Changed

- **The sidebar lists the Hub after the Library**, so the two collections of what can be installed read
  next to each other instead of the Hub standing between Projects and the Library.

## [0.28.3] - 2026-10-07

### Changed

- **An unselected tag in the filter row is no longer coloured.** Only the tags you are filtering by wear
  their colour, so the row reads as "what is being filtered for" and nothing else; the chips still fold, and
  the tags on a card or in the install dialog are unchanged — there one is always coloured.

## [0.28.2] - 2026-10-07

### Fixed

- The window opens already in the app's colour: the native title bar no longer wears the OS caption while the
  boot splash is on screen (the window stays hidden until the backend has painted it from the saved theme).

## [0.28.1] - 2026-10-07

### Added

- **Every tag has a colour of its own.** A tag is painted from its own name — the same hue on a card, in the
  filter row and in the install dialog, in both themes — so a subject is recognisable at a glance instead of
  being read.

### Changed

- **The tag filter folds.** The row shows the first few tags with the rest behind a button, so the library
  itself stays on screen; a tag that is switched on is never hidden by the fold, since its chip is the only
  way to switch it off again.

## [0.28.0] - 2026-10-07

### Added

- **Entries in the Hub say what they are for.** Every skill and MCP server now wears tags — `documents`,
  `design`, `review`, `security`, `testing` and the like — on its card and in the preview and install
  dialogs, so a collection of hundreds can be browsed by subject instead of by repository layout. The Hub
  ships tags for the four skill collections it reads (Anthropic's, Superpowers, Sentry's and the 92 plugins
  of Agentic Skills), a skill's own `tags:`/`keywords:` frontmatter is read where a publisher writes it, and
  a source file can declare its own.
- **A tag filter above the Hub.** The chips are the tags the collections in view declare; picking one asks
  the source for the entries carrying it, and picking several asks for the entries carrying any of them —
  the same tags narrow the free-text search.

### Changed

- A hub source declares tags in its own file: `tags = [...]` for every entry of the source and
  `[[tag_rules]]` (`prefix`, `tags`) for the entries it names by prefix. See `catalog/HUB.md`.

## [0.27.0] - 2026-10-07

### Added

- **The window opens where you left it.** The sidebar's collapsed state and the screen that was on are
  remembered in settings and restored on the next launch — the rail is already in the shape you left it
  and the app paints that screen directly, home never flashes past. Both are the shell's own state: the
  Settings page cannot roll them back, and a hand-edited `lastRoute` is dropped unless it is a path the
  router can actually open.

## [0.26.1] - 2026-10-07

### Changed

- The boot splash shows only the logo mark: the wordmark under it is gone, so the window opens on the icon
  alone before the app paints.

## [0.26.0] - 2026-10-07

### Added

- **A Hub for skills and MCP servers.** A new screen lists large, always-growing collections — the official
  MCP registry and four repositories of `SKILL.md` skills (Anthropic's, Superpowers, a large plugin-organised
  set and Sentry's) — with one search box over all of them. Each collection is its own section with its own
  paging, and a collection that is slow or down is a note under its own heading instead of an empty screen.
- **Install into the owner you choose.** One entry can be installed globally (the shared `~/.agents` surface
  every installed agent reads), into one installed agent, or inside one of your projects — a skill arrives as
  a whole directory including its scripts and templates, an MCP server as one entry in the config file that
  owner already reads, written in that agent's own shape.
- **A review step before anything is written.** The install dialog lists every file the payload would write
  (naming the ones an agent may run), or the exact launch recipe — command, arguments and the environment
  variables or headers the publisher says are required, pre-filled and editable. The backend refuses an
  install that was not confirmed, and a payload path that would step outside the skill's own directory is
  rejected before a byte lands.
- **Read an entry before you install it.** Opening a card (or choosing Preview in its right-click menu) shows
  what the payload _is_ — the instructions themselves (`SKILL.md` rendered, with its frontmatter), the exact
  file list, or how a server is launched with the values it needs. The menu also carries the entry's own page,
  the collection it came from, its id, and re-reading it from the collection when a publisher has moved.
- **Hub sources are declarative.** Dropping a TOML file into `<app config>/hub/` adds a collection of your
  own — a GitHub repository of skills, the MCP registry, or a published JSON index — and a file with the same
  id replaces a built-in one. `src-tauri/catalog/HUB.md` documents the format, and
  `cargo run --example hub` reads every source over the network without launching the app.

### Changed

- The MCP registry is asked for the latest version of each server only, so a page of the Hub is as full as
  the page size it asked for.

## [0.25.1] - 2026-10-06

### Fixed

- The built-in terminal now wears its colour scheme as a whole, not just from the canvas inwards: the strip
  around the text and the find bar floating over it are painted from the chosen palette too, so a dark scheme
  (Dracula, Gruvbox, …) no longer sits in a frame of the light app theme — and vice versa. The scheme that
  follows the interface is unchanged.

## [0.25.0] - 2026-10-06

### Added

- Right-click menus on library and project cards, matching the agent cards: open, edit or switch off a skill, open or remove an MCP server, expand or edit a document, and open, run in or reveal a project — each with copy and reveal path actions

## [0.24.1] - 2026-10-06

### Changed

- A button that is working on something now shows a spinner instead of the "…" that followed its label
  (Save, Rescan, Reveal, Restart, Run and the other pending actions), and the trailing ellipsis is gone
  from the loading labels that already carried a spinner (Loading, Validating, Refreshing, Waiting for output).

## [0.24.0] - 2026-10-06

### Added

- **Projects**: add the folder you keep your projects in — or a single project's folder — and Ahabby finds
  every project inside it (a git repository, a `.claude` or `.agents` directory, `.mcp.json`, `AGENTS.md`,
  `.cursor/rules`, …) and reads what each one holds. One project per added folder counts as much as twenty.
- What a project holds: project skills (`.claude/skills`, `.agents/skills`, `.opencode/skills`), MCP servers
  (`.mcp.json`, `.cursor/mcp.json`, `.vscode/mcp.json`, `.gemini/settings.json`, `.agents/mcp.json`),
  instructions (`AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, `.github/copilot-instructions.md`, `CONVENTIONS.md`),
  rules (`.cursor/rules`, `.clinerules`, `.continue/rules`), sub-agents and slash commands.
- Everything inside a project is edited exactly like an agent's own resources: switch a skill or a server off
  without deleting it, edit any project file in the editor (validation, diff and backups included), and create
  new project skills and MCP servers straight from the UI.
- The system's own folder picker for adding a folder: the dialog is the OS's, opened by the backend
  (`tauri-plugin-dialog`, reachable from Rust only — the webview gets no permission for it), so a path never
  has to be typed by hand while typing one still works.
- **Run an agent here**: an installed agent starts in the project's own directory, from the project's page or
  its card.
- A manifest may now declare more than one skills directory and more than one MCP source (`[[skills]]`,
  `[[mcp]]`); the previous single-table form keeps working, so existing manifests and user overrides are
  unaffected.
- VS Code's project MCP file (`.vscode/mcp.json`) is written in the shape that editor requires, `type`
  included.

### Changed

- A directory the user adds but where no project marker is found is treated as one project, so "a folder
  with a project" and "a folder with projects" are the same gesture.
- `ScanReport` carries the projects next to the agents and the shared resources, so the Projects screen is
  painted from the same scan the rest of the app uses — one source of truth, refreshed by every edit.

## [0.23.0] - 2026-10-06

### Added

- Skills and MCP servers of your own can be created from the UI: on an agent's page and in the Library a
  form writes the `SKILL.md` convention (with YAML frontmatter) into the skills directory the manifest
  declares, or adds a server to the agent's own MCP config — `command`/`args`/`env` for a local process,
  `url`/`headers` for a remote one — in the file's own format (JSON, JSONC, TOML, YAML) and the agent's own
  entry shape (opencode's `type: local` command array included), keeping every other byte of that file intact.
  Agents that keep their servers in a list (goose, Continue, gptme) stay read-only instead of getting an
  entry they would not read.
- In the Library the owner is part of the form: a skill or server can be written for one specific agent or
  for the shared `~/.agents` surface that every installed agent reads

### Changed

- Every select that chooses an agent — the Library's owner filter, the creation forms and the terminal
  dialog — now shows the agent's logo in the closed select and in each row, with the resource count or the
  installed version as a dimmed note beside the name, so the owner is recognised before the name is read

## [0.22.1] - 2026-10-06

### Changed

- The boot splash is quieter: the loading bar is gone, and the mark keeps its own colour instead of taking
  the accent from Settings

## [0.22.0] - 2026-10-06

### Added

- The built-in terminal has colour schemes: Settings → Terminal offers ten of them, each with a swatch and a
  live preview of the palette, so the dock can be painted in Ahabby's own colours (which keep following the
  app theme and accent) or in One Dark, Dracula, Tokyo Night, Catppuccin, Nord, Gruvbox, Solarized or One
  Light — the choice applies to every open tab and to every tab opened later, without a restart

## [0.21.0] - 2026-10-06

### Added

- Skills and MCP servers can be switched off without deleting anything: a skill's entry file is renamed to
  `SKILL.md.disabled`, so the agent stops loading it while the skill itself stays on disk, and an MCP entry is
  moved into a sibling `mcpServersDisabled` object of the same config file, where no agent looks for servers —
  the switch is on the card, in the agent's own tabs and in the Library, and switching back restores exactly
  the previous state (the entry keeps its place, its secrets stay masked, and the JSONC comments around it are
  preserved)
- A switched-off skill or server stays listed, marked as off, so the switch is always there to turn it back on
  and nothing has to be remembered outside the app; every switch takes a timestamped backup first, and a
  plugin-managed skill or a read-only MCP source is never touched
- Every list that carries switches — the agent's Skills and MCP tabs and both Library tabs — can be narrowed
  by activity (All / On / Off), with the number of resources behind each choice on the chip, so a
  switched-off skill or server is found without reading the whole list; a chip that has nothing behind it
  says so instead of looking like a filter that does nothing

## [0.20.0] - 2026-10-06

### Added

- An agent's page now opens with "Quick info": the few values worth knowing at a glance, read from the
  agent's own config files during the scan — the default model, the provider, an endpoint, a proxy and any
  credentials, grouped by the file they came from
- Quick info reads JSON, JSONC, TOML and YAML configs, plus the dotenv-shaped files agents keep next to them
  (`.env`, `.sgptrc`), and skips everything that is a collection of like things (MCP servers, hooks, projects,
  history) or too large to be a settings file
- Detection covers the shapes the values actually come in: a default model hidden in a role map
  (`modelRoles.default`), a provider or a model behind one more level (`model.name`), a proxy under any of its
  names (`HTTP_PROXY`, `ALL_PROXY`, `PI_PROXY` — but not the `NO_PROXY` bypass list), and the same value
  declared four times counted once
- A credential in that panel stays masked — including the password inside a `user:password@host` proxy, whose
  key name gives nothing away; revealing or copying the real value is a click that asks the backend for that
  one key, so a token never sits in the interface on its own

## [0.19.0] - 2026-10-06

### Added

- The app opens on a home screen instead of jumping straight into the agent list: what Ahabby is in one
  sentence, the state of the last scan with a Rescan button, and four numbers — agents installed, skills, MCP
  servers and other resources — that each lead to the screen explaining them
- The home screen also carries the roster of the agents installed on this machine: brand mark, name and the
  version its own CLI reported, favourites first, with an "Update available" badge and a jump to the agent —
  alongside the three sections (Agents, Library, Settings) as one-line links

### Changed

- Settings is a set of sub-pages instead of one long scroll: Appearance, Terminal, Search & catalog, Network,
  Safety, Hidden agents and About each have an address of their own, listed in a section rail beside the
  content (a scrollable row on a narrow window), so a section can be linked to and the back button walks
  between them — the appearance sets the tone here as everywhere else
- Settings keeps one draft and one Save button across every sub-page: switching sections no longer throws away
  an unsaved edit, the header marks the draft as unsaved, and "Discard changes" puts the whole thing back; the
  live preview of the language, theme and accent keeps applying the page being edited, wherever that is
- The settings areas are grouped by what they affect: Appearance is General, Accent color and Size & fonts;
  Network is Version checks and Proxy; Search & catalog keeps the extra scan paths together with your manifest
  directory; Safety is the backup directory; About is the version and the package managers that were found
- The cards on a settings sub-page sit in the same concentric run as the agent list: one tight stack where only
  the exposed corners keep the full radius, instead of evenly spaced cards each rounded on every side
- The agent list moved to `/agents` (an agent to `/agents/:id`) so that `/` can be the home screen; the sidebar
  gained a Home entry, and "All agents" on an agent's page returns to the list
- Files that do not exist yet stand out on an agent's page: the config or resource card is drawn with a dashed
  border on a tinted surface, its badge reads "Not created yet" in the accent colour, and the action reads
  "Create" instead of "Edit" (a primary button, since there is nothing to edit yet); such files are also listed
  after the ones that already exist, so nothing to act on never stands in the way of something that is

### Removed

- Settings "About" no longer repeats the catalog directory under a second "About" heading — the directory is
  listed once, in Search & catalog, with the copy and reveal actions that belong to it

## [0.18.2] - 2026-10-06

### Changed

- The sidebar is a floating panel inset from the window edges instead of a strip fused to them: it groups the
  screens under a "Navigation" label with the pinned agents below it, marks the current screen with an accent
  pill and its count, and keeps the terminal and rescan controls in a footer of their own — collapsed to the
  icon rail every control stays named for screen readers and described by a tooltip

## [0.18.1] - 2026-10-06

### Fixed

- The file editor scrolls again: the code area is bounded by the dialog and its contents scroll inside it,
  instead of the whole editor growing to fit every line and being clipped at the bottom
- The file editor got its top spacing back — the code no longer sits flush against the quick-action bar

## [0.18.0] - 2026-10-06

### Added

- Agents can be started in a terminal: the agent's page, its card and its right-click menu all offer "Run in
  terminal", and so does every favourite row in the sidebar — one click next to a pinned agent, or a right
  click on it (which is also how the collapsed sidebar rail offers it) — and Ahabby starts the executable the
  scan found, never a command line from the interface
- Ahabby's own terminal lives in a dock at the bottom of the window instead of on a screen of its own: its tab
  strip stays visible while the rest of the interface is used above it, it collapses to just that strip and
  expands again, and its top edge can be dragged to any height — a collapsed tab keeps its full scrollback, and
  the page above is never navigated away from
- The dock's terminals are complete working terminals: copy/paste, find, links that open in the system browser,
  an explicit restart of a finished agent, and a shell prompt in the working directory once the agent exits —
  closing a tab closes the whole console, so no shell is left behind
- Settings has a terminal picker: the built-in terminal is the default, and the terminals installed on this
  machine are offered next to it (Windows Terminal, PowerShell 7, WezTerm, Ghostty, kitty, Alacritty, Warp,
  Terminal, iTerm2, GNOME Terminal, Konsole, Xfce Terminal, Tilix, Terminator, foot, xterm) — each one is
  detected before it can be chosen, and a terminal that cannot be told to run a program says so
- Terminal sessions are asked for by agent id, never by command, and they are killed with the app
- Skill, MCP and other-resource cards now show the file's date — the creation time when the platform reports
  one, otherwise the modification time under its own label, never mislabelled — with the exact date and time
  in the tooltip, and the skill detail dialog lists both

### Changed

- The Library can be filtered and sorted properly: a source picker (everything / shared only / agents only),
  a sort picker (name A–Z and Z–A, newest and oldest first, largest and smallest first — groups follow their
  leading item), and a chip row of the active tab's own refinements: "needs verification" for skills, the
  transport for MCP servers, the kind for the other resources, each chip showing how many items it leaves

## [0.17.0] - 2026-10-06

### Added

- The Library now lists the shared, agent-neutral resources of the machine: global skills, MCP servers and
  instructions from `~/.agents` belong to no single agent, so they get their own "Shared" owner — a neutral
  tile and a tag everywhere an agent would be named, their own section when grouped by agent, and their own
  entry in the agent filter
- Shared resources behave like any other: they can be opened, edited (with the usual backup and validation)
  and deleted through the trash, under the same path checks that guard an agent's own files
- A resource an agent manifest declares inside a shared root no longer shows up as that one agent's — goose,
  codebuff and the rest are reported through the shared surface, so nothing is counted twice
- Removing an agent now asks what to do: **Hide** keeps it on the machine but drops it from Ahabby
  (restorable from Settings → Hidden agents), while **Uninstall** really removes it by running the uninstall
  command its manifest declares — with the exact command shown and its output streamed live. The delete
  choice only appears when a real removal is possible; otherwise the dialog says why (no uninstall command
  for the platform, or the package manager it needs is missing)

### Changed

- `catalog/shared.toml` describes the cross-agent surface (@see `catalog/SCHEMA.md`), and `shared` is a
  reserved manifest id: a user manifest claiming it is rejected with a catalog problem instead of silently
  shadowing it
- `remove_agent` takes an explicit `hide`/`delete` mode instead of deciding on its own, and manifests are
  validated so an uninstall command must pass the same safety whitelist as install commands

## [0.15.0] - 2026-10-06

### Added

- Agents can be pinned as favourites: the star on a card (or in its right-click menu) keeps the agent first
  in its list section and adds a shortcut to the sidebar, and the agent page offers the same toggle

## [0.14.0] - 2026-10-06

### Changed

- The Library page is rebuilt around the same cards the agents list uses: every skill, MCP server and other
  resource shows its name, description, path, size and the brand-marked agents it belongs to, with the file
  actions in their own column
- Library groupings are now predictable: by name, where one heading gathers a skill or server shared by
  several agents, or by agent, where each shared resource is listed under every agent that owns it — and the
  group header carries the agent's icon
- Filters moved into one row above the tabs: search, an agent picker that shows how many resources each agent
  contributes, a grouping toggle, and a reset button; the tab counters follow the filters

### Added

- The Library explains itself: a summary of the scanned agents and when the last scan ran, a rescan button
  and the catalog-problem banner the agents list shows, plus per-tab empty states that offer to clear the
  filters
- Skills can be opened in the editor straight from the Library card, like they already could inside an agent

## [0.13.0] - 2026-10-06

### Added

- Ahabby remembers the result of the last scan, so a restart opens straight into the real agent list instead
  of skeletons
- That remembered list is refreshed in the background right away, and every card reports its own progress: a
  light band crosses the top edge of each agent that is still being inspected and fades into a soft highlight
  the moment its fresh data arrives, while the sidebar shows how many agents are left

## [0.12.0] - 2026-10-05

### Changed

- Page headers stay pinned to the top of the scrolling area: the title and its actions remain visible on
  every screen instead of scrolling away, sitting on a blurred backdrop so content passes cleanly beneath

## [0.11.0] - 2026-10-05

### Added

- The file editor has a quick-action bar: undo/redo, revert to the saved version, clear, format
  JSON, find and replace, copy, line wrapping, the diff and the backup list — plus `Ctrl+S` to save
- MCP servers can be opened in the editor from their card, and skills (`SKILL.md`) and
  instructions/commands/hooks/rules files can now be viewed and edited too: any file the scan
  declared is editable, always with a timestamped backup first

### Fixed

- The editor finally follows the app theme: it is no longer painted with CodeMirror's own light
  palette (which made plain text invisible in dark mode), line indentation and gutter spacing are
  even, and searching with `Ctrl+F` opens a styled panel instead of doing nothing

### Changed

- Edits are validated automatically shortly after typing, so the error banner and the Save button
  always describe the text on screen; a file changed by someone else is still refused, not
  overwritten

## [0.10.0] - 2026-10-05

### Added

- The sidebar navigation shows how much is behind each section while it is expanded: the Agents item
  carries the number of installed agents, the Library item the total of skills, MCP servers and other
  resources. The badges are hidden in the collapsed icon rail

## [0.9.0] - 2026-10-05

### Added

- Appearance settings, so the app can be tuned to taste: an accent colour (nine presets or any custom
  `#rrggbb`), an interface size and a text size, plus the interface font (Inter, system or Lora) and the code
  font (JetBrains Mono or the system one). Everything is previewed live on the real interface and restored if
  you leave without saving, and a single button resets accent, sizes and fonts to their defaults
- The Appearance section carries a preview: heading, body text, button, badge and code chip, painted with the
  choices currently in the draft

### Changed

- Type sizes are expressed in rem, so the text-size setting reaches every label, badge, code block, rendered
  markdown and the config editor — not only the token-driven text
- Settings written or edited by hand are sanitized on load and on save: the two size scales are clamped and a
  custom accent that is not a colour falls back to the default preset

## [0.8.0] - 2026-10-05

### Added

- The sidebar can be collapsed to an icon-only rail with a button next to the navigation; collapsed
  items reveal their label on hover, and the scan status and rescan button tuck into icons

### Changed

- Sidebar navigation items are larger — bigger hit area, icon and label — so the rail reads at a
  glance and is easier to click

## [0.7.1] - 2026-10-05

### Changed

- Card lists are tighter and concentric: the cards sit close together, the corners at the exposed ends
  keep the full radius, and a corner facing a neighbouring card is rounded a step smaller
- The agent Overview tab uses the same grouped stack, so its panels sit close with matching corners
- Dropdown options follow the same rule: a menu item is rounded by the content radius minus its padding

## [0.7.0] - 2026-10-05

### Added

- Agent cards have a context menu: right-click a card (or press the keyboard's context-menu key while
  a control on it has focus) for open details, website and docs, copying the binary path, showing it in
  the file manager, install/update — with the version it would install — and removal. Entries whose
  action cannot run are not offered at all
- The app now opens on a splash instead of an empty window: the icon mark, the wordmark and a loading
  bar are painted with the first HTML frame, before the bundle and the stylesheet exist, follow the
  light/dark theme (including a pinned one) and cross-fade into the app once it has rendered

### Changed

- The window no longer answers a right click with the WebView's own menu (Back, Reload, Save as). Text
  entry keeps it, because that is the only clipboard UI available without a paste command
- Dragging across the interface no longer leaves a text selection behind. Code, rendered markdown and
  form fields stay selectable so they can still be copied

## [0.6.2] - 2026-10-05

### Fixed

- Every clickable control now shows a pointer cursor. Buttons (including the tab bar), filter
  chips, disclosure toggles and select options previously kept the operating system's default
  arrow because Tailwind v4 no longer styles native `<button>` elements

## [0.6.1] - 2026-10-05

### Fixed

- The highlight behind the active sidebar item is visible in the dark theme again; the pill and the
  item hover used a surface token that composited to the same shade as the translucent sidebar

## [0.6.0] - 2026-10-05

### Added

- The agents list now has a filter row next to the search box: an install-state scope (all,
  installed, available) and toggleable chips for the properties a card already shows — update
  available, needs verification, warnings, skills and MCP servers. A chip only appears while it
  can still match, and its number is what turning it on would leave, so a stack of filters can
  never quietly end in an empty page; one click on “Clear filters” resets everything
- Agents can be removed from Ahabby with a confirmation dialog. A manifest you dropped into your
  own catalog is deleted — the file is moved to the OS trash, never unlinked — while an agent
  whose manifest ships with Ahabby (or whose user manifest overrides one) is only hidden, because
  deleting the file would bring the builtin back. Hidden agents are listed in Settings, where
  they can be restored, and a removed agent disappears from the list, the counters and the Library

## [0.5.3] - 2026-10-05

### Added

- The update dialog now shows the version you have installed next to the one that would be
  installed, so the effect of the command is visible before it runs. When no newer version was
  found, it says so instead

## [0.5.2] - 2026-10-05

### Changed

- Avatar tiles now use each agent's own brand colour, with the mark drawn in the colour that stays legible
  on it, instead of the earlier neutral tile and per-agent tint. That applies to the agents the icon
  library ships (its own avatar colours) and to the ones it does not — Aider, Amazon Q, Augment, Codebuff,
  Continue, Crush, Factory Droid, Forge, gptme, omp, Open Interpreter, Plandex, ShellGPT, Tabby, Warp and
  Zed — whose colours were taken from the vendor's own site or logo. An icon key with neither entry still
  gets a plain neutral monogram instead of a made-up colour

## [0.5.1] - 2026-10-05

### Changed

- Cancelling a running install or update now asks for confirmation first, so an accidental click can no
  longer leave an agent half-installed

### Fixed

- The backend now refuses `run_install` unless the frontend explicitly confirms it, the same way it
  already refused a skill or MCP server deletion. Installing, updating and uninstalling an agent run a
  command from the manifest, and that command can no longer be executed without the confirmation dialog
  having been shown

## [0.5.0] - 2026-10-05

### Added

- Agent avatars now show the real product logo instead of initials: the cards and the agent's own page
  draw brand marks from `@lobehub/icons` (Claude Code, Codex, Cursor, Windsurf, Cline, GitHub Copilot,
  Gemini CLI, Qwen, OpenHands, Kiro, Goose, Amp, Junie, Kilo Code, OpenCode, OpenClaw, Pi and Hermes).
  Agents without a matching logo keep the deterministic monogram, and the logo follows the manifest's
  `icon` key, so a new agent picks it up by declaring the same key

## [0.4.3] - 2026-10-05

### Added

- Every agent card in the list now shows how many skills, MCP servers, config files and other
  resources that agent has, so the counts are visible without opening the agent's page

## [0.4.2] - 2026-10-05

### Changed

- The native window header is now painted in the theme's own colour instead of the Windows accent and
  the gradient it comes with, so it blends into the app

### Fixed

- Switching the theme no longer snaps back to the previous one: repainting the native header used to
  flip the webview's own `prefers-color-scheme`, and a leftover listener chased the app back to the
  theme it had just left

## [0.4.1] - 2026-10-05

### Removed

- The top bar showing the app name and tagline; the sidebar now starts at the very top of the window

## [0.4.0] - 2026-10-05

### Added

- Motion across the interface, tuned to stay quick and quiet: screens cross-fade as you navigate, the
  sidebar highlight glides between sections, tab underlines slide to the active tab, and card lists
  settle in with a short stagger. The first paint stays still — nothing animates on launch
- Resource and raw-JSON sections now grow open and close smoothly instead of appearing in one step

### Changed

- Dialogs, tooltips, selects and toasts ease in as they appear, and dialogs and toasts also animate out
  again (a toast can still be swiped away)
- Switching between the light and dark theme crossfades the palette instead of flipping in a single frame
- Anyone who asked their system for less motion gets plain fades: slides, layout movement and the
  growing height of collapsible sections are dropped instead of animated

## [0.3.0] - 2026-10-05

### Added

- Proxy settings with three modes: connect directly (the new default — `HTTP_PROXY` / `HTTPS_PROXY` are
  ignored and stripped from install commands), use the system proxy from the environment, or enter one
  custom `http://`/`https://` URL. The choice applies to the "newer version exists" checks and to every
  install, update and uninstall command (npm, pip, cargo, brew and `curl`-based install scripts)

### Changed

- The app shell has a full-width header in the theme colours (application name and tagline), and the
  sidebar no longer carries the logo — it starts straight with the navigation

## [0.2.0] - 2026-10-05

### Added

- 24 new agents, taking the catalog from 10 to 34: Hermes, OpenClaw, Pi, omp, Amp, Kilo Code, Kiro, Goose,
  Crush, Plandex, gptme, ShellGPT, Open Interpreter, Tabby, Forge, Factory Droid, OpenHands, Codebuff,
  JetBrains Junie, Augment Code, Warp, Zed, Windsurf and Amazon Q Developer CLI — each with its config
  files, skills, MCP servers, instructions, other resources and install/update commands
- `binaries.version_extract = "line"` for agents whose build numbers are not semver (Junie, Warp, Zed)

### Changed

- Every new manifest carries `# SOURCE:` comments pointing at the official documentation, and anything the
  docs do not confirm is listed under `unverified` instead of being guessed

## [0.1.1] - 2026-10-05

### Fixed

- Cancelling an install or update now stops the whole process tree on Linux, where the login shell
  forked the installer instead of exec'ing it and only the shell was killed

## [0.1.0] - 2026-10-05

Initial release.

### Added

- Scans the machine for installed AI coding agents (Claude Code, Codex CLI, Gemini CLI, opencode, GitHub
  Copilot CLI, Cursor CLI, Aider, Cline, Continue, Qwen Code) from declarative TOML manifests
- Agent pages with version, install path, install method, and an optional newer-version check
- Config file viewer/editor with validate → diff → timestamped backup → atomic write and stale-file detection
- Skill list with `SKILL.md` frontmatter and rendered body, plus trash-based deletion
- MCP server list with backend-side secret masking and per-value reveal
- Library view aggregating skills, MCP servers, and other resources across agents
- Install and update jobs with streamed output, cancellation, and manifest-only commands
- Settings for language, theme, scan paths, network checks, backup directory, and catalog directory
- English and Russian interface
