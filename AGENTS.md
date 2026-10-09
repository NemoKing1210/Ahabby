# Repository Guidelines

## Project Overview

Ahabby is a cross-platform (Windows/macOS/Linux) Tauri v2 desktop app that finds the AI coding agents
installed on the machine and puts them in one place: versions, config files, global skills, MCP servers,
rules/instructions/sub-agents/hooks, and safe install/update commands. It does the same for the _projects_ the
user works in: the folders they add are searched for projects, and each project's local skills, MCP servers
and documents are read and edited through the very same pipeline.

Next to what is already on the machine, the **Hub** installs what the user does not have yet: it reads
published collections of skills and MCP servers (the official MCP registry, repositories of `SKILL.md`
directories, JSON indexes) and writes one entry of them into the shared surface, an installed agent or a
project — through the same adapters, path checks and backups everything else goes through.

Core boundary: **the Rust backend owns every file, process and network operation; the React frontend only
renders what the backend reports.** Adding support for a new agent is adding one declarative TOML manifest —
no Rust, no TypeScript. Adding a place the Hub reads a library from is one declarative TOML _source_ file, on
the same terms (`catalog/HUB.md`). UI is bilingual (English/Russian).

Version: `0.51.2`. Changelog: [CHANGELOG.md](CHANGELOG.md). Claude Code uses [CLAUDE.md](CLAUDE.md).

## Architecture & Data Flow

Rust layers (dependencies point one way; no business logic in `commands`):

```
commands → services → adapters → catalog → domain
              ↓           ↓
           platform ──────┘
```

- `domain` — pure models serialized 1:1 to TypeScript (`src-tauri/src/domain/*.rs`).
- `catalog` — loads builtin manifests (embedded at compile time by `src-tauri/build.rs`) merged with user
  manifests from `<app config>/catalog/` (same `id` wins); validates and reports problems instead of failing.
  The same loader pattern carries the **hub sources**: builtin ones from `catalog/hub/*.toml` merged with the
  user's own from `<app config>/hub/`, each source validated before it can turn into a request.
- `adapters` — `AgentAdapter` trait + `ManifestAdapter` (declarative). Two specialised adapters exist:
  `ClaudeAdapter` (`adapter = "claude"`), because Claude Code reads MCP from two files and plugin-managed
  skills must never be deleted, and `ProjectAdapter`, which wraps `ManifestAdapter` to read _one project_:
  it owns the project root (every call is re-rooted, so a relative surface path can only resolve inside that
  project) and stamps everything it yields with the project as the owner.
- `platform` — OS-specific: path expansion (`${VAR}`), binary lookup, package-manager detection, process
  execution with timeouts, atomic writes + backups, native window chrome (Windows: DWM).
- `services` — scanner, config editor, installer + job runner, version checker, settings, library, terminal
  sessions, `project` (project discovery + reading), `hub` (reading the collections of skills and MCP
  servers the Hub installs from, with its own in-memory cache), and `sync` (cloud sync: reading the scan as
  the source of truth for what exists and where a restore may land, uploading through a `SyncProvider`, and
  writing a restore through the app's own checked paths).
- `commands` — thin Tauri command surface; validates input, calls a service.
- `desktop` — the three surfaces the OS draws _for_ Ahabby and no service can own, because each needs
  the live `AppHandle`: the tray icon and its menu (`desktop::tray`), the window's life cycle
  (`desktop::window` — show, hide, and whether the close button quits) and the login item
  (`desktop::autostart`). It depends on `state`/`services` and nothing depends on it, which is why it
  sits beside `state.rs` rather than inside the service layer.

Data flow:

```
manifests → AdapterRegistry → Scanner → ScanReport → commands → React Query → UI
                                  ├→ services::aggregate → Library
                                  └→ services::project → the user's projects

hub sources → services::hub (one request per source, cached) → HubEntry → install_hub_resource
                 └→ the *same* adapter as a manual create: install_skill / create_mcp_server → the owner's own
                    skills directory or MCP config file

scan report → services::sync → SyncProvider (GitHub Gist: one gist per item) → sync://done
                  └→ a restore writes through AppState::document_target / the adapter's install_skill, so a
                     cloud payload can only land where the owner's manifest declares a place for it

agent id ──→ AppState::agent (the scan's binary) ──→ services::terminal (PTY) ──→ terminal://output ──→ xterm

external link ──→ features/browser (the one click listener) ──→ fetch_web_page / fetch_web_image
                      └→ services::web (proxy, caps, charset) ──→ the reader sanitizes and renders it
```

- One scan, one source of truth; the last report is cached in memory so navigation is instant.
- Mutations that touch disk return `MutationResult<T> { data, report }`, and the frontend pushes the fresh
  `report` into the agents query cache.
- **A resource has an owner id, and that id is what addresses it.** A scanned agent's `id`, the reserved
  `shared` surface (see `catalog/shared.toml`) and a project's synthetic `project:<hash>` id all resolve
  through the same `AppState` lookups (`adapter`, `skill`, `mcp_server`, `document_target`), which is why the
  whole editing surface — read, preview, save, create, switch off, delete — serves a project without a second
  command set. Agent ids are restricted to `[a-z0-9_-]`, so `project:` can never collide with one.

Frontend boundaries (enforce them):

- **`src/shared/api/ipc.ts` is the only module that calls Tauri `invoke`.** No component or hook calls it.
- **`src/shared/api/events.ts` is the only module that calls `listen`** (`job://output`, `job://done`,
  `scan://…`, `terminal://output`, `terminal://exit`, `tray://navigate`, `tray://run-agent`,
  `sync://done`).
- Server state = React Query (per-feature `api/` hooks, keys in `src/shared/api/keys.ts`). Zustand is used in
  exactly three places: the install-job console store, the toast store and the terminal tab store.
- Routing is hash-based (`createHashRouter` in `src/app/router.tsx`) because the packaged app has no server SPA
  fallback. Routes: `/` (home — the summary and this machine's roster), `/agents`, `/agents/:agentId`,
  `/projects`, `/projects/:projectId`, `/library`, and `/settings/*` (one sub-page per area,
  `features/settings/routes.tsx`). The terminal has no route — it is a dock of the shell, lazily loaded, that
  stays open under every screen.
- **The Projects screen reads `report.projects` out of the agents query** (`useProjects()` selects that field
  from the same `queryKeys.agents()` entry, `staleTime: Infinity`), so it needs no cache of its own: every
  mutation that writes the fresh report into that entry repaints the page, and after a restart the cached
  report paints it before the background scan lands.
- **A terminal session is asked for by agent id.** The frontend never sends a program, a command line or an
  interpreter; the backend starts the executable the scan resolved, inside the user's own shell.

Type safety across the boundary: Rust types derive `TS` (`#[ts(export, export_to = "../../src/shared/bindings/")]`);
`src/shared/bindings/*.ts` is **generated, never hand-edited**. 64-bit ints need `#[ts(type = "number")]`.

## Key Directories

| Path                               | Purpose                                                                                                                                                                                                                    |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/`                         | Providers (React Query, tooltips, toasts, job event bridge), hash router, theme, shell                                                                                                                                     |
| `src/features/<feature>/`          | `api/` hooks, `components/`, `pages/` — agents, configs, editor, skills, mcp, extensions, library, hub, browser, projects, install, settings, terminal                                                                     |
| `src/features/browser/`            | Ahabby's own browser: the one click listener, the modal window, the sanitizer and the image proxy                                                                                                                          |
| `src/shared/api/`                  | `ipc.ts` (typed `invoke` wrappers), `events.ts`, `keys.ts`, `errors.ts`                                                                                                                                                    |
| `src/shared/bindings/`             | ts-rs generated types (do not edit)                                                                                                                                                                                        |
| `src/shared/i18n/`                 | i18next init + `locales/{en,ru}.json` (single `translation` namespace)                                                                                                                                                     |
| `src/shared/lib/`                  | `cn`, formatting, secret masking, clipboard, `links` (where a link leads)                                                                                                                                                  |
| `src/shared/ui/`                   | Design system: Button, Badge, Card, Tabs, Dialog, Toast, CodeViewer, Markdown, …                                                                                                                                           |
| `src/styles/globals.css`           | CSS variables, `@theme inline` token mapping, base layer, keyframes                                                                                                                                                        |
| `src-tauri/src/`                   | Rust: `domain · catalog · adapters · platform · services · commands · desktop · state.rs · error.rs`                                                                                                                       |
| `src-tauri/src/desktop/`           | Tray + its menu (`tray.rs`), window life cycle (`window.rs`), login item (`autostart.rs`) — app-level, not services                                                                                                        |
| `src-tauri/catalog/builtin/*.toml` | One manifest per agent — the whole support matrix                                                                                                                                                                          |
| `src-tauri/catalog/project.toml`   | The **project surface**: the relative locations a project keeps skills, MCP servers and documents in                                                                                                                       |
| `src-tauri/catalog/shared.toml`    | The agent-neutral (`~/.agents/...`) surface the Library shows next to the agents' own resources                                                                                                                            |
| `src-tauri/catalog/SCHEMA.md`      | Manifest reference (authoritative alongside `domain/manifest.rs`)                                                                                                                                                          |
| `src-tauri/catalog/hub/*.toml`     | One **hub source** per collection the Hub reads — the whole support matrix of the library, embedded at compile time                                                                                                        |
| `src-tauri/catalog/HUB.md`         | Hub source reference: the three kinds, the index document format, and what the Hub will and will not fetch                                                                                                                 |
| `src-tauri/src/services/hub/`      | `mod.rs` (fetch, cache, paging) + `parse.rs` (the three formats, pure) + `installed.rs` (what this machine already has)                                                                                                    |
| `src-tauri/src/services/sync/`     | `mod.rs` (the service, the `SyncProvider`/`SyncTarget` seams, the automatic loop) + `plan.rs` (item derivation, payload, description, pure) + `gist.rs` (the GitHub Gist provider) + `store.rs` (push state + credentials) |
| `src-tauri/src/domain/sync.rs`     | Every cloud sync model, the payload document included                                                                                                                                                                      |
| `src/features/sync/`               | The cloud library: hooks, the item/remote rows, the restore preview, and the per-card surface (`CloudActions`) an agent's and a project's tabs wear                                                                        |
| `src/features/hub/`                | The Hub screen: one section per source, the entry card with its owners and installed state, the preview, the install dialog                                                                                                |
| `src-tauri/tests/pipeline.rs`      | End-to-end backend read/write pipeline tests                                                                                                                                                                               |
| `.github/workflows/ci.yml`         | The only CI workflow                                                                                                                                                                                                       |

## Development Commands

```bash
npm install
npm run tauri dev                 # full desktop app (Vite dev server is started for you)
npm run dev                       # Vite only (pure UI work in a browser; IPC calls will fail)

npm run build                     # typecheck + production bundle
npm run tauri build               # desktop binaries/installers
npm run typecheck                 # tsc --noEmit
npm run lint                      # eslint . (type-aware)
npm run format                    # prettier --write .
npm run format:check

npm test                          # vitest run
npm run test:watch
cargo test --manifest-path src-tauri/Cargo.toml              # all Rust tests
cargo test --manifest-path src-tauri/Cargo.toml catalog::     # manifest validation only
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check

npm run bindings                  # regenerate src/shared/bindings (cargo test export_bindings)
cargo run --manifest-path src-tauri/Cargo.toml --example scan         # validate catalog vs this machine
cargo run --manifest-path src-tauri/Cargo.toml --example scan -- --json
cargo run --manifest-path src-tauri/Cargo.toml --example scan -- --sync-items   # what cloud sync would offer to save
cargo run --manifest-path src-tauri/Cargo.toml --example hub          # validate the hub sources vs the live APIs
cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --query pdf --payload
```

Before pushing, run: `npm run format && npm run lint && npm run typecheck && npm test` plus `cargo fmt --all -- --check && cargo clippy … -D warnings && cargo test`. CI also fails if `src/shared/bindings/**` differs after regeneration. Commit messages are validated by the `.githooks/commit-msg` hook and by `npm run check:commits` in CI.

## Code Conventions & Common Patterns

### Formatting & linting (enforced by CI)

- Prettier: no semicolons, single quotes, `printWidth: 100`, `trailingComma: "all"`, LF. The
  `prettier-plugin-tailwindcss` plugin sorts utility classes — let it.
- ESLint flat config, type-aware (`recommendedTypeChecked`). Notable rules: `consistent-type-imports`
  (use `import type` / inline `type`), `no-unused-vars` allows `_`-prefixed, `eqeqeq: always`. Ignores
  `src/shared/bindings/**`.
- TypeScript strictness: `strict`, `noUnusedLocals/Parameters`, `noImplicitOverride`,
  **`noUncheckedIndexedAccess`** (indexing yields `T | undefined`), **`verbatimModuleSyntax`**.
- Alias: `@/* → src/*` (mirrored in `tsconfig.json` and `vite.config.ts`). Group imports:
  react/builtins → third-party → `@/shared/*` → feature-relative.

### Commits (enforced by the `.githooks` hook and CI)

- Conventional Commits: `<type>(<scope>)!: <description>`; types `feat fix docs style refactor perf test
build ci chore revert`; lowercase scope; imperative description without a trailing period; subject ≤ 100
  characters. One logical change per commit.
- Hooks live in `.githooks/` (`core.hooksPath`, installed by `npm install` → `prepare`): `commit-msg` validates
  the message, `pre-commit` runs Prettier + ESLint on staged files, `pre-push` runs `npm run check:versions`.
- CI re-validates every PR commit with `npm run check:commits <base>..<head>`, so `--no-verify` only defers
  the failure. Rules live in `scripts/lib/commits.mjs`; keep `.cursor/rules/commits.mdc` in sync.
- **A request to push is only a request to push.** `залей изменения` means: commit what is pending, push it,
  and report the result — no CI triage, no fixing an unrelated failing test, no extra checks beyond what the
  change itself needs. A pre-existing failure that surfaces on the way is worth _reporting_, never acting on
  unless it was asked for.

### Naming

- Components/pages: PascalCase `.tsx` (`AgentCard.tsx`, `AgentsPage.tsx`), named exports (convention;
  `CodeViewerImpl` and the i18n default export are exceptions).
- Data/api modules: lowercase (`queries.ts`, `hooks.ts`, `mutations.ts`, `keys.ts`, `store.ts`).
- Tests colocated as `<Name>.test.tsx` (must match `src/**/*.test.{ts,tsx}`).

### Frontend patterns

- **Server state**: a `useQuery`/`useMutation` hook per operation in the owning feature's `api/` module,
  using the `queryKeys` factory. Never call `invoke` outside `shared/api/ipc.ts`.
- **Error handling**: the backend error serializes as `{ code, message }` only (14 stable codes:
  `not_found, io, invalid_format, stale_file, command_not_allowed, manager_unavailable, no_install_method,
not_supported, network, job_not_found, invalid_input, invalid_manifest, timeout, other`). Normalize with
  `toAppError` and branch on `code`, never on prose. Show errors via `toastAppError(error)` or
  `<ErrorState error onRetry>`; titles resolve to `errors.<code>` i18n keys.
- **UI kit**: reuse `src/shared/ui/*` (Radix primitives wrapped, never imported raw in features). Variants via
  CVA + `cn()` (`twMerge(clsx(...))`). Use design tokens only — `bg-surface`, `bg-surface-2/3`, `text-muted`,
  `text-faint`, `border-border`, `border-border-strong`, `text-accent-strong`, `bg-accent`, `outline-ring`,
  `rounded-lg`, `shadow-popover`, `duration-150 ease-warm`. There is no `bg-surface-1`, `text-fg` or
  `*-primary`. A `Select` option may carry an `icon` (the agent tile of a picker) and a `description`
  (a dimmed trailing note such as a count) — see the Icons bullet. Every screen needs loading
  (skeleton), empty (hint) and error (code + retry) states.
- **A tab row inside another tab row is a `secondary` `TabsList`.** The two appearances are not
  interchangeable: `primary` is a page's own tabs (a bottom rule with an accent underline gliding under the
  active tab), `secondary` is a segmented control on an inset surface whose active tab is a raised pill —
  and the secondary list carries that pill on the trigger itself, so a row that scrolls or wraps can never
  clip it. Nested tabs are `secondary`: the owner-kind sub-tabs of Settings → Cloud sync. A level that is
  _not_ tabs — the labelled chip groups and `Select`s of the Library and Hub toolbars, the enabled/disabled
  chips of a list — is a filter and stays a chip row. `shadow-popover` belongs to overlays (dialogs,
  menus, tooltips); a selected pill uses `bg-surface` + `border-border`, never it.
- **Dialogs** are conditionally mounted with a `key` for state reset and an `onOpenChange` that unmounts —
  not always-present with an `open` prop. A dialog that stays mounted while `open` flips (e.g. `ConfirmDialog`)
  plays the exit animation; an unmounting one only animates in.
- **Right click**: the WebView's own menu is cancelled app-wide by `src/app/nativeMenu.ts` (wired in
  `main.tsx`), except inside text entry, where it is the only clipboard UI — a surface with actions of its
  own uses `src/shared/ui/ContextMenu.tsx`, whose content is never given an exit animation so Radix restores
  focus before a dialog opens. The card's trigger is the whole card, so the keyboard context-menu key works.
- **Text selection**: `body` is `user-select: none` (see `globals.css`) — form fields, `.cm-editor`, `code`,
  `pre`, `.ah-prose` and anything marked `.select-text` opt back in. Add a `ContextMenu` action instead of a
  selectable region when a value is meant to be copied.
- **Motion**: JS-driven animation goes through `motion` (import from `motion/react`) with the tokens in
  `src/shared/lib/motion.ts`; CSS-driven animation uses the keyframes in `globals.css` and Tailwind's
  `animate-[…]`. **A list of items is an `AnimatedList`** — one stack, grid or chip row of keyed rows that
  eases each row in, animates a removed row out where it stood (`AnimatePresence` with `mode="popLayout"`,
  `layout="position"`) and slides the rest into the gap; pass `grouped={false}` when `className` already
  describes the layout, and `as="ul"` when the rows are a real list. `Reveal` is for disclosure content, and
  a surface that slides into place is built on `useSoftSlide` — `reducedMotion="user"` (set in
  `providers.tsx`) stops layout animation and instant-jumps transforms, but it would still hold a slide
  offset for the whole tween, which is why `useSoftSlide` falls back to a plain fade itself.
- **Document edits** go through `features/editor` — one `DocumentEditorDialog` for every addressable file
  (configs, MCP source files, `SKILL.md`, instructions/commands/hooks/rules), described by an
  `EditorDocument`. The order is fixed: edit → `previewConfigSave` (diff + validation + hash) → `saveConfig`,
  and the preview re-runs on a debounce so the banner and the Save button always describe the text on screen.
  Stale-file errors are detected via `isStaleFileError` and turn into the reload banner; `editable` is never
  raised on the frontend — a read-only document stays read-only in the UI and the backend refuses it anyway.
  The dialog expands to the whole window, and every write leaves a timestamped backup: the backups panel
  compares a copy against the text on screen in `BackupDiff` (`diff`/jsdiff, split or unified), restores it
  or deletes it — deletion is a `ConfirmDialog` because the command refuses a call without `confirm`.
- **CodeMirror** (`shared/ui/CodeViewer`, lazy-loaded) is themed by `shared/ui/code/editorTheme.ts` from
  design tokens only, and the wrapper passes `theme="none"` so CodeMirror's own light/dark palettes cannot
  paint over them. Adding a language means extending `extensionsFor`; `Ctrl+F` needs the `search()` extension
  (the basic setup only binds the keymap).
- **Theme**: `src/app/theme.ts` owns the only `prefers-color-scheme` subscription (through the app-wide
  `themeApplier`) and pushes the resolved palette to the native title bar. Always apply themes through
  that applier — a stale subscription re-applies a theme the user has already left.
- **Appearance**: `src/app/appearance.ts` maps the accent/size/font settings onto root CSS custom properties
  (`--ah-accent*`, `--ah-ui-scale`, `--ah-font-scale`, `--ah-font-*`) and is applied at boot and on save;
  the Settings page previews an unsaved draft live and restores the saved values on unmount. `--ah-ui-scale`
  is what resizes the layout (it multiplies Tailwind's `--spacing` and the radii), `--ah-font-scale` resizes
  type — keep that split when adding tokens.
- **i18n**: add every new string to **both** `en.json` and `ru.json`; parity is enforced by
  `src/shared/i18n/locales.test.ts`. Plurals use i18next `_one`/`_other`.
- **Icons**: `AgentIcon` paints the manifest `icon` key with the brand palette from
  `src/shared/ui/agentBrands.ts` (background + contrasting mark, from `@lobehub/icons` `AVATAR_*`
  constants for the brands it ships, verified brand hexes with a `# SOURCE:` comment otherwise).
  Unmapped keys get a neutral monogram. Deep-import leaf components
  (`@lobehub/icons/es/<Brand>/components/{Color,Mono,Inner}`), never the per-brand index — that
  index also pulls the library's `Avatar` wrapper, dragging `@lobehub/ui` and `antd` into the bundle.
  Every select that chooses an agent builds its rows with `agentOptions.tsx` (`agentOption`/`ownerOption`,
  plus `anyAgentOption` for the "no filter" row, whose `NeutralTile` keeps the logo column straight), so a
  picker shows the brand tile in the closed trigger and in every row. **The agent rows of every picker are
  ordered favourite-first** (`orderByFavorite` / `installedAgents`, read with `useFavoriteAgents`), so the
  select of a new terminal, the agents list, the Library's agent filter and the "run an agent here" picker
  open on the agent the user pinned; a non-agent row a caller mixes in — the agent-neutral shared surface,
  a project — keeps the place the caller gave it, which is why the owner pickers still open on the shared
  surface. Radix drops the `className` given to
  `Select.Value` and `SelectItemText`, which is why the trigger paints the selected option itself and a row
  keeps its spacing in a wrapper of its own. `ManagerIcon` gives a package manager the same treatment from
  `src/shared/ui/managerBrands.ts` (`simple-icons`, CC0, for the managers that publish a mark, and two paths
  Ahabby draws itself for WinGet and Scoop, which publish none; `script`/`manual` are not products and keep
  the neutral tile). It is used as a bigger tile where a manager is the subject (a method picker, the
  managers list of Settings → About) and through `ManagerBadge` — the same tile in a chip next to the name —
  where a manager is metadata of something else (an install method of an overview, the detected install of a
  card). Both take the manager's name from `managers.*` in the locales, so a manager is never shown as the
  raw id its manifest happens to use.
- **Terminal**: `src/features/terminal` renders PTY sessions with xterm.js inside `TerminalDock`, a footer the
  shell owns (`AppShell` lazy-loads it the first time a terminal exists — xterm is the one heavy dependency the
  other screens should not pay for). The dock's tab strip is always on screen; collapsing it sets the body to
  zero height instead of unmounting it, so a background agent goes on painting into its own scrollback, and
  `focusable={false}` is what stops a hidden terminal from keeping the keyboard. The tab store is the source of
  truth for the backend sessions (anything it does not know is closed on startup, and a tab whose session is
  gone is finished rather than left swallowing keystrokes), and `app/providers.tsx` routes `terminal://output`
  into `lib/session.ts`, which buffers the bytes of a tab whose emulator is not attached yet. **The emulator is
  the session's, not the component's**: `lib/terminals.ts` (loaded with the dock, never with the shell) creates
  one xterm per session and re-homes its element on every attach, so a remount — which React does twice per
  mount in development — shows the same scrollback instead of a blank terminal, and only a tab the store has
  forgotten disposes it; the same module owns the keystroke, resize and link handlers, because those belong to
  the session too. The xterm theme is read from the design tokens (`lib/theme.ts`) because a canvas cannot use
  `var(--…)`; ANSI colours come from the token palette with a light and a dark variant. `Settings::terminal_theme`
  can replace that with a fixed scheme (`lib/themes.ts` holds the palettes, keyed by the ids the Rust enum
  validates): `paintTerminal` repaints an attached terminal, the settings query is what tells it to, so a save
  repaints every open tab, and the same resolver paints the Settings preview.
- **Run in terminal**: every entry point (agent page, card, context menu, and the sidebar's favourite rows —
  a hover action beside the agent, plus a one-item menu on the row itself so the collapsed rail has it too)
  calls the same `useRunAgentInTerminal` hook, which follows `Settings::terminal`: the built-in terminal opens
  a tab in the dock (expanding it, without navigating) and an external one is launched as its own window.
- **The tray is native UI, so its entries are split by who can finish them.** `desktop::tray` (Rust) owns the
  icon and the whole menu — the status line, `Open Ahabby`, `Go to ▸`, `Run in terminal ▸`, `Scan again`,
  `Quit Ahabby` — and shows the window itself; the two entries that need a screen the window owns come back
  over the event bus (`tray://navigate`, `tray://run-agent`) and are carried out by `app/layouts/TrayBridge`,
  which lives in the shell (it needs the router) and calls the very hooks the buttons use, so a session
  started from the tray is a session like any other. The menu is planned as plain data in Rust (labels,
  items, which agents are runnable) and only then turned into native items, which is what makes it testable
  without a running application; the "Go to" labels are compared against `nav.*` by a unit test, so the tray
  and the sidebar cannot describe one screen differently.
- **A link never takes the window with it.** Every external link in the app is caught by one capture-phase
  listener in `features/browser/context.tsx` (`BrowserProvider`, mounted above the router) and opened in
  Ahabby's own browser: a modal with its own history, an address bar, back/forward/reload, copy and **Open in
  your browser**. The listener decides on the _attribute_, never on `anchor.href` (a resolved href already
  points at Ahabby's own origin), and `shared/lib/links.ts` is the one place that says what an href means —
  `reader` for `http(s)` and a bare host, `block` for a scheme no desktop app honours, `inline` for the hash
  the router owns and for a relative path. `Markdown` renders a link the reader cannot open as its own text
  (the `<a>` goes, so a document's `#…` or `./file.md` link cannot navigate either), and every button that
  means "open the website" (an agent's, a hub entry's, the install docs, the terminal's own hyperlinks) calls
  `useBrowser().open`: the OS browser is what the reader _offers_, not what a link does.
- **The window opens where the user left it.** `Settings::sidebar_collapsed` and `Settings::last_route` are
  the shell's own state: they are written by `set_sidebar_collapsed` / `set_last_route` (never by the
  Settings page, whose whole-document save the backend makes ignore them) and read back in `main.tsx`
  before the first render — the route into `window.location.hash` before `AppRouter` builds the router
  (`app/routeMemory.ts`) and the settings straight into a query cache primed for `AppShell`. The rail is
  therefore already collapsed and the right screen is the first thing painted; a hash the app was started
  with wins over the remembered route.
- **A filter outlives the screen that set it.** Leaving a screen unmounts it, so the search box, the facet
  chips, the Hub's kind/source/tags and the Library's tab, owner, origin, sort and activity are held in
  `shared/lib/sessionState.ts` — a process-lifetime map read and written by `useSessionState`, which is a
  `useState` that survives its component (the test setup clears it per case, so one case's filters cannot
  leak into the next). Navigating away and back, or from one agent's skills tab to another agent's, finds the
  list as it was left; nothing goes to disk, because a filter is a way of looking at a list, not a preference.
- **Cloud sync has two surfaces and one library, grouped by owner.** `features/sync/api/hooks.ts` is the
  only place the sync commands are called from; `SyncLibrary` (a two-tab list of what this machine holds and
  what the account holds) is rendered by Settings → Cloud sync and owns the full set of rows
  (`SyncItemRow` / `RemoteItemRow`), the owner groups (`SyncOwnerGroup`) and the restore preview
  (`SyncPreviewDialog`). An agent's and a project's page carry the **per-card** surface instead:
  `CloudActionsProvider` — mounted once around their tabs — runs the owner's one status, item and listing
  query and owns the one set of dialogs, `CloudItemAction` is the chip a config, skill or MCP card wears in
  its footer — the state, View, Compare, Save, Restore, where Compare needs a copy to exist and an MCP card
  acts on the file its entry lives in, since the sync unit is the file — `CloudOnlyCard` is a copy this
  machine has no file for — shown on its own tab, Restore being all there is to do with it — and
  `CloudSummaryCard` is the Overview's counts, a "save all", the copy list, and behind `sync.showFiles` a
  disclosure listing what can be uploaded and what can be restored as `SyncItemRow` / `RemoteItemRow` rows
  with checkboxes, each group with a select-all and a bulk action (`RemoteItemRow` grew the optional
  selection for it; a bulk restore goes through one `ConfirmDialog` and then the same `pull`).
  A restore is still always a preview, on every path. The library's each half is cut
  twice: the main tabs say _where_ a copy lives, the **owner-kind sub-tabs** say _whose_ it is (`agents` /
  `projects` / `shared`, from `ownerFacetMatches` — a kind that half holds none of is not offered, and
  picking one the other half lacks falls back to "all"), and inside one it is one foldable group per owner —
  the brand tile and name come from `useSyncOwners` (`lib/owners.ts`), which orders agents favourite-first
  exactly like the agent list — with its own counts ("2 not saved", "2 changed"), a session fold
  (`sync.collapsed.<tab>.<owner>`) and the quick actions that apply to the whole group: select it, save it,
  restore it (behind a `ConfirmDialog` naming the owner and how many copies it covers). A row carries
  the two things its own width has no room for in a `SyncItemContextMenu` / `SyncRemoteContextMenu` —
  preview, open on GitHub, copy path, reveal in the file manager, delete the cloud copy — so both surfaces
  offer the same actions, and `useRefreshRemoteSync` is the one control that asks the provider again
  instead of taking the listing's minute of cache. A row also opens the **reader** (`SyncContentDialog`:
  the item's files, one shown with `CodeViewer` and `lib/fileFormat`, the two sides behind a secondary tab
  switch when both exist) and, when a copy exists, the **comparison** (`SyncCompareDialog`: the per-file
  verdicts and `BackupDiff` from `features/editor`, with Restore in the footer — the diff _is_ its review,
  the way the editor's backup comparison works, so no second dialog). Saving is per item, per group or everything at once;
  restoring always goes through
  the preview or a confirmation, never straight from a click. The tab, search box and kind filter (chips with
  per-kind counts) live in the session store like every other filter. A run that finishes on its own is
  painted from `sync://done` (`app/providers.tsx` invalidates the status, item and library keys), so an
  automatic save is on screen without a refresh.

### Backend patterns

- **Every disk write goes through `platform::write_atomic`** (temp file → fsync → rename, timestamped
  backup first, Unix permissions preserved). Do not open a config file for writing anywhere else.
- The native title bar is painted by `set_window_theme` → `platform::set_window_chrome`. On Windows it
  must go through DWM, not `Window::set_theme`: tao turns that into a theme change that reaches our own
  webview and flips the `prefers-color-scheme` a `system` theme is resolved from. The window is created
  hidden (`visible: false`) and `run()`'s setup paints the chrome from the settings file and only then shows
  it: the webview cannot colour the caption before its bundle, stylesheet and settings round-trip exist, and
  our own setup runs only after WebView2 is up — so a window shown at creation would wear the OS caption for
  the whole splash. The palette is the one copy of the `--ah-background`/`--ah-foreground` tokens in
  `platform::chrome_tokens` (a unit test reads `globals.css` and fails if the two drift).
- Services take a `PlatformContext` and must not depend on `AppHandle` (except where a `JobSink` is needed).
  The tray, the window and the login item need one, which is why they live in `desktop/` and not in a service.
- **The reader fetches, the frontend sanitizes.** `services::web` reads one page — `http(s)` only, host
  required, credentials dropped, 3 MiB cap, 20 s timeout, 5 redirects — and answers with the document as the
  server sent it, decoded with the charset the header or a `<meta>` declares;
  `features/browser/lib/readable.ts` then parses it inert, drops the page's chrome, sanitizes the rest against
  an allow-list and rewrites every link and image, with the images coming back through `fetch_web_image` as
  base64 — which is what keeps `img-src 'self' data:` true and a third-party page out of the process that
  holds the IPC bridge. A document it cannot render (a PDF, an image, an unexpected type) is a `not_supported`
  error the dialog turns into "open it in your browser", never an empty page. The Hub's, the version checker's
  and the reader's HTTP clients all come from `services::http::client(proxy, timeout, redirects)`, so a proxy
  change is one rebuild per service and no service can quietly ignore the setting.
- **The tray menu is replaced, never patched, and `desktop::sync` is the only way in.** It is called at
  startup, on every settings save and from the scan sink the moment a report lands (that is how the status
  line and the list of runnable agents stay current), it does its work on the main thread (menus belong
  there), and it creates the icon, hands it a freshly built menu or removes it according to
  `Settings::tray_icon` — one call, three outcomes. `desktop::window::close_to_tray` checks the tray icon
  _exists_ and not only that the setting is on: a hidden window with no tray icon would have no way back.
  `Settings::start_minimized` is honoured under the same guard, so a platform that cannot create a tray
  never leaves a process with no surface at all.
- **`launch_at_login` is reconciled with the OS around every save, and the OS wins whenever the switch did
  not move.** `commands::settings::save_settings` reads the login item first: if the user moved the switch,
  the OS is told and a refusal comes back as an error (nothing is written, so the document cannot claim
  something the machine does not do); if the switch did not move but the machine disagrees — a login item
  removed in the OS's own startup settings, say — the _document_ is corrected, never the OS. `run()`'s setup
  applies the same rule at launch, so a login item the user took away is not silently put back. The plugin is
  used from Rust only — the webview has none of its permissions, exactly like the folder picker.
- Commands resolve inputs through `AppState` (`document_target(agent_id, path)` is the security seam: the path
  must exactly match a config declared by the manifest, a scanned resource file, or a skill's entry file —
  see `state::resolve_document` — else `CommandNotAllowed`; a document the manifest marks read-only, or a
  plugin-managed skill, is refused by `preview_config_save` / `save_config` even if the UI asks). `remove_skill` /
  `remove_mcp_server` / `run_install` all take `confirm` and go through `commands::require_confirmation`, so a
  UI that skips its dialog is refused instead of deleting or executing something.
- **A project is an owner, not a special case.** The folders the user adds live in
  `Settings::project_folders`; `services::project` finds the projects inside each one — a marker of
  `catalog/project.toml` or a `.git`, three levels deep, stopping at every project it finds, and the folder
  itself when it holds none — and reads each project through `adapters::ProjectAdapter`. That adapter owns its
  root and re-roots every call, so the _relative_ paths of the surface manifest can only ever resolve inside
  that project: a forged path from the webview has nowhere to go. It stamps everything it yields with
  `project:<hash>` as the owner and `Scope::Project`, including what `create_skill` / `create_mcp_server`
  return; `ManifestAdapter::owned_by` is what tells the inner adapter's ownership guard which id its resources
  carry.
- Project discovery is derived from the manifest, never listed twice: `services::project::markers()` takes the
  first path segment of every relative location in `catalog/project.toml` (plus `.git`, and the full path for
  markers too common to mean anything on their own — `.github`), so declaring a new tool's location also makes
  a folder holding it a project.
- Commands are never trusted from the UI: the UI sends an agent id + method id; `plan_for()` resolves the
  command from the manifest and `validate_command` enforces the first token (manager binary, allow-listed
  installer for `script`, or the agent's own binary) and rejects newlines/backticks/`$(…)`. Non-script commands
  run as program + args (no shell).
- Secrets (`env`/`headers` keys that look secret) are masked **in the backend** (`domain::secrets`); the
  frontend mirror `src/shared/lib/mask.ts` must stay in sync with it.
- **A skill or MCP server is switched off by moving what makes it visible, never by rewriting it.** A skill's
  entry file is renamed to `<name>.disabled` (`ManifestAdapter::set_skill_enabled`) — agents look a skill up by
  the exact file name — and an MCP entry is moved into the sibling `<container>Disabled` object of its own
  config file (`doc_edit::move_entry`, byte-preserving for JSON/JSONC). Both stay in the scan with
  `enabled = false`, and an MCP server's `key_path` always addresses its _enabled_ position, so every reader of
  a single entry has to go through `adapters::mcp_entry_location`.
- **An extension is one row whatever its origin, and only a local one is Ahabby's to touch.** `[[extensions]]`
  declares the surface (`format = "pi"`, the extensions directory, the settings document that holds the
  `packages` list and the built-in names); `adapters::extensions` reads Pi's own layout — a package resolved to
  `<agent dir>/npm/node_modules/<name>`, `<agent dir>/git/<host>/<path>` or a path, with its metadata from the
  installed `package.json`, plus the `.ts`/`.js` modules of the directory — and every row carries the `surface`
  id it was read from, because a package's files live wherever the agent put them. A local module is switched
  off by renaming its entry file to `<entry>.disabled` (the skill convention; the id is derived from the
  un-suffixed path, so it survives the switch) and removed to the OS trash. A package is only ever updated or
  removed through the agent's own CLI: `extension_plan` resolves `pi update|remove <source>` from the detected
  binary and the source the last scan reported, and the result runs as an ordinary job — `plan` → confirm → the
  same console, cancellation and rescan an install uses. The tab opens on the packages alone: the modules of the
  directory and the agent's own built-ins are behind a type filter with their counts (kept for the session like
  every other filter), so the list starts with what the user actually installed.
- **A terminal session is derived, never dictated.** `commands/terminal.rs` resolves the agent id through
  `AppState::agent` (installed + `binary_path` from the scan) and hands it to `services::terminal`, which
  starts the user's own shell in a PTY (`native_pty_system`) and _types_ the quoted executable into it — that
  is what makes npm's `.cmd`/`.ps1` shims work on Windows. Output crosses the boundary base64-encoded (a read
  can split a UTF-8 sequence) on `terminal://output`; closing a tab drops the master, which closes the console
  and takes the agent down with the shell. Three rules keep that startup reliable: the line is typed only after
  the shell's own first output (a shell that has not finished starting is not reading its console yet, and a
  line handed to it too early is an agent that never appears) with a bounded wait, so a silent shell is typed
  to anyway; the session is published to the manager only once the reader, the starter and the waiter threads
  are all running, so a half-built session can never leave an orphaned console; and the PTY is given the `TERM`
  and `COLORTERM` a desktop launch does not inherit (`platform::shell::terminal_env`), without which a
  full-screen agent drops its colours or refuses to start. Two consequences worth remembering: ConPTY asks the
  terminal for its cursor position (`ESC[6n`) and holds output back until it is answered (xterm does; the backend
  tests answer it themselves), and `ChildKiller::kill()` in portable-pty 0.9 reports failure even on success, so
  it is best-effort and closing the console is what actually ends the session.
- **External terminals are a table, not a guess.** `platform/terminals.rs` holds every supported terminal with
  its per-OS detection candidates and its documented launch contract (`-e`, Windows Terminal's `-w 0 nt -d`,
  AppleScript `do script`, or Warp's URI, which is why Warp is offered as `opensDirectory` — it cannot be told
  to run a command). A terminal is only offered after `detect()` found it on this machine.
- **Opening a file in the user's own editor is a table too.** `platform/editors.rs` lists VS Code, Cursor, Zed,
  Windsurf, VSCodium, Sublime Text, Notepad++ and the JetBrains IDEs with their per-OS detection candidates (the
  command-line shim on `PATH` first, then the documented install location) and one launch contract that follows
  what was resolved: a macOS `.app` bundle through `open -a`, a Windows `.cmd` shim through `cmd /C` — handed over
  with `raw_arg` and wrapped in a _second_ pair of quotes, because `cmd` strips the outermost ones itself and a
  line that opens with the already-quoted program then splits the shim at its first space — and everything else
  directly. `commands::editors` resolves the document through `document_target` like every other document command
  (read-only ones included: nothing is written here), and the dialog's toolbar picker offers only what `detect()`
  found, one row per editor with the brand tile from `shared/ui/editorBrands.ts`; Visual Studio Code's mark is
  Ahabby's own copy of the official logo, since simple-icons no longer ships it.
- **The Hub installs through the adapters, not around them.** `services::hub` only _reads_ third-party
  collections (one request per source, cached in memory, with every limit explicit: 25 s per request, 64 MiB
  per body read while streaming, 8 MiB per file, 48 MiB per repository, oldest-first eviction); the write is
  `AgentAdapter::install_skill` / `create_mcp_server` on the resolved owner, so a hub skill lands in the
  skills directory its manifest declares and a hub server in the config file its manifest declares, with the
  same path checks, backups and entry shapes as the manual forms. `install_skill` writes the payload into a
  fresh `.<slug>.ahabby-installing` directory with `SKILL.md` last and renames it into place, so an
  interrupted install leaves nothing an agent would load — and a payload path that is not a plain relative
  one, or a set where one file is the parent of another, is refused before a byte is written.
- **“Already installed” is the scan's answer, never the Hub's memory.** `services::hub::installed` reads the
  last `ScanReport` directly (applying the Library's ownership rule — a path an agent also declares inside a
  shared root counts once, as global — so an agent, the shared surface and a project are owners exactly as the
  Library sees them) and `commands::hub` annotates every entry it answers with, on `search_hub` and
  `get_hub_entry` alike, which is why installing anywhere, in the Library or by hand, shows up on the Hub's
  cards. The name is only the index key; whether a copy _is_ the published one is compared by content, where
  the payload is at hand and without a request: a skill by the SHA-256 of its `SKILL.md` (`HubEntry.identity`,
  `sha256:`), a server by its canonical launch recipe (command + args, or URL — the protocol spelling is not
  part of it). An `index` entry's skill is fetched only when it is opened, so its card names the owners and
  claims nothing more.
- **A hub entry's tags are declared, never guessed.** `HubEntry.tags` carries, in this order, what the entry
  itself declares (an index document's `tags`, a skill's frontmatter `tags`/`keywords`), what its source
  declares for it (`tags` source-wide, `[[tag_rules]]` by prefix of the name the source uses — a skill's
  repository directory, an index id, a registry name) and the plugin group a skill sits in
  (`plugins/<group>/skills/<skill>`) — normalized to 12 tags of 40 characters, deduplicated
  case-insensitively. `HubQuery::tags` keeps entries carrying _any_ of them: a GitHub collection and an
  `index` document are filtered before the page is cut, the registry — which pages server-side and gives its
  records no tags of their own — only from the page it answered, and a filter its vocabulary cannot answer is
  answered from the source file without a request at all.
- **A hub tag's colour is hashed out of its name, and the theme decides the rest.** `shared/lib/tagColor.ts`
  turns the name into `--ah-tag-hue` and `--ah-tag-tone` (an inline style on the chip or the badge), and the
  unlayered `.ah-tag` in `globals.css` paints `oklch()` from those plus the theme's `--ah-tag-l` / `--ah-tag-c`
  — so one tag keeps one colour in every theme and in every place it appears (the filter row, a card, a
  dialog), and no component ever carries a hex of its own. The filter row shows the first few tags and folds
  the rest behind a button, but never hides a tag that is switched on; its chips are coloured only while they
  are on (`globals.css` colours `.ah-tag` except `[aria-pressed='false']`, so a badge — which has no pressed
  state — is always coloured and an unselected filter stays quiet).
- `services::hub` is rebuilt on a settings save (`HubService::set_proxy`) the way the version checker is: a
  proxy change is about the connection, not the cached data. Its HTTP client follows `Settings::proxy` exactly
  like the version checker's (`None` → `no_proxy`, `System` → environment, `Manual` → one URL).
- **Cloud sync reads the scan and writes through it.** `services::sync` derives its items from the last
  `ScanReport` (`plan::items_of`) — only the kinds an agent page shows as a file (`SyncKind::SYNCABLE`: a
  config, a `.env`, a skill and an MCP config file), so the documents a manifest declares (instructions,
  commands, sub-agents, hooks, rules, prompts, memory) and a local extension never leave the machine; an MCP
  config file a manifest also declares as a config is one item, and `SyncSettings::default().auto_kinds` is
  exactly that set. The frontend addresses an item by `(ownerId, itemId)` only; a path is never accepted from
  it. A **push** builds one document per item (`SyncPayload`: metadata plus every file, text as text and
  anything else base64) and stores it as the single file of one gist, whose **description** carries the same
  facts in a parseable form, so a listing costs one request per page instead of one per item. A **pull** is
  always manual, always `confirm`-guarded, resolves its destination from the _current_ scan
  (`AppState::document_target` for a file, `AgentAdapter::install_skill` for a skill) and refuses a copy whose
  name the target owner does not declare — a cloud payload can never invent a path.
- **Automatic saving is a content-hash reconciliation, not a change feed.** `SyncService::run_auto` re-derives
  the items, hashes what is on disk and uploads only what differs from `<app data>/sync/state.json`, which is
  also why a file edited outside Ahabby is picked up. It runs on a timer (`autoIntervalMinutes`) and, when
  `autoOnScan` is on, right after a scan (`TauriScanSink::finished` → `observe` + `request_auto`). An
  `AtomicBool` keeps two runs apart, an item carrying secrets is never touched unless `includeSecrets` says
  so, and a failure is recorded as `lastError` and reported on `sync://done` — an automatic run is never a
  failed command. The provider is rebuilt from the settings on every run, so a proxy change is one client.
- **Reading is a third command family, and it never takes a path.** `read_sync_item(ownerId, itemId)`
  resolves an item out of the last scan (the frontend sends ids, exactly as it does for a push),
  `read_remote_sync_item(remoteId)` reads the stored document back, and `compare_sync_item(remoteId, ownerId)`
  answers both sides plus, per file, whether it is the same, changed, only here or only in the cloud. Both
  sides are read into the _same_ shape (`SyncFileContent`: text within `plan::MAX_VIEW_BYTES`, the file's real
  size, and the sha256 of the whole thing) — which is what makes "identical" a claim and not a guess, binary
  files included. A file above `MAX_READ_FILE_BYTES` is reported by size with no hash and the comparison calls
  it uncomparable instead of inventing an answer; a file whose read cut a multi-byte character in half is
  still text (`plan::text_of` drops that one character rather than the file).
- **The token is the one thing the settings document does not hold.** `Settings::sync` is non-secret by
  construction; the token lives in `<app config>/sync/credentials.json`, written only by `set_sync_token` and
  never read back to the frontend, which sees `SyncStatus::token_hint` instead. That is what keeps a
  whole-document `save_settings` from ever touching a credential.
- New Tauri command = 4 edits: service fn → thin `#[tauri::command]` → add to the `handlers!()` macro in
  `src-tauri/src/lib.rs` → typed wrapper in `src/shared/api/ipc.ts` (+ a feature hook). Arg names are
  camelCase on the TS side.
- Add a manifest field = update `domain/manifest.rs` + `validate()` + `SCHEMA.md` (+ `CONTRIBUTING.md` example
  if user-facing), then `npm run bindings`.

### Manifest conventions

- Manifests live in `src-tauri/catalog/builtin/*.toml`; `id` is the file stem and also authoritative inside
  the file. `deny_unknown_fields` is on, so typos fail loudly. Unknown keys are removed; field names use TOML
  `snake_case`.
- **Hub sources** are the same idea one level out: `src-tauri/catalog/hub/*.toml` declares where the Hub reads
  a library from (`mcpRegistry`, `githubSkills` or `index`), embedded at compile time by the same `build.rs`
  pass, with the user's own in `<app config>/hub/` overriding by `id`. `catalog/HUB.md` documents every field
  and the index document format; a source file that does not validate is skipped and reported, never fatal.
- Every path group carries a `# SOURCE: <url> (checked <date>)` comment. Anything unconfirmed goes into
  `unverified = ["dotted.path"]` (prefix-tolerant matching; UI shows a "needs verification" badge).
- `skills` and `mcp` are **lists**: `[[skills]]` / `[[mcp]]`, because a tool may keep skills in more than one
  directory and servers in more than one file (`catalog/project.toml` declares three skills directories and
  five MCP sources). A manifest written before that — `[skills]` as a single table — still parses
  (`domain::manifest::one_or_many`), so existing user overrides keep working. The **first** entry of each list
  is what a new skill or server is written into.
- `[[extensions]]` is **opt-in**: an agent whose manifest declares none has no extensions surface, and its page
  says exactly that instead of showing an empty list. The only `format` so far is `pi`, which reads the
  conventional extensions directory plus the `packages` list of a settings JSON document — hence `settings` is
  required with it. Like the other surfaces it is a list, parsed through `one_or_many`.
- `catalog/project.toml` and `catalog/shared.toml` describe a surface rather than an agent. Every path in the
  project surface is _relative_ and is resolved against the project being read; both files live outside
  `catalog/builtin/`, so `build.rs` never embeds them, and their ids (`project`, `shared`) are reserved in
  `catalog::loader`.
- Top-level keys: `id, name, description, tagline, website, docs, icon, category, popular, vendor, features,
github, adapter, binaries, search_paths, configs, skills, mcp, extensions, other, methods, unverified, notes, source`.
  `claude-code.toml` is the fullest example; `SCHEMA.md` has a complete minimal example.

## Important Files

- Entry points: `index.html` (carries the boot splash markup and its inline styles, which only
  `src/app/splash.ts` takes down), `src/main.tsx`, `src/app/router.tsx`, `src/app/providers.tsx`;
  `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` (`run()` + `handlers!()` macro), `src-tauri/src/state.rs`
  (`AppState`).
- Config/build: `package.json`, `tsconfig.json`, `vite.config.ts` (aliases + test block), `eslint.config.js`,
  `.prettierrc`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` (CSP + window + bundle),
  `src-tauri/build.rs` (embeds builtin manifests), `src-tauri/capabilities/default.json`,
  `.github/workflows/ci.yml`.
- Key modules: `src/shared/api/ipc.ts`, `src/shared/api/keys.ts`, `src/shared/api/errors.ts`,
  `src/shared/i18n/index.ts`, `src/styles/globals.css`, `src-tauri/src/error.rs` (`AppError` codes),
  `src-tauri/src/domain/manifest.rs`, `src-tauri/src/services/scanner.rs`.

## Runtime/Tooling Preferences

- **Node 20+** (CI uses Node 24) and **npm** (lockfile v3). Do not switch package managers.
- **Rust**: edition 2021, MSRV **1.82**; CI uses stable. Release profile is `lto`/`codegen-units=1`/`strip`.
- **TypeScript ~5.9.3** (pinned with `~`). No new runtime dependency without a reason in the change
  description; the frontend intentionally uses only React Query + two Zustand stores for state.
- **Tauri**: capabilities grant exactly `core:event:default`; there is **no** `fs`, `shell` or `http` plugin —
  all I/O/process/network is in Rust. `tauri-plugin-dialog` is registered for one job and used **from Rust
  only**: `commands::projects::pick_project_folder` opens the OS folder picker and returns a path, so the
  webview still has no permission to open a dialog of its own (and there is no `@tauri-apps/plugin-dialog`
  dependency in the frontend). `tauri-plugin-autostart` is registered on the same terms: `desktop::autostart`
  drives it, the webview is given none of its permissions either. The `tauri` crate is built with the
  `tray-icon` feature — the only optional feature Ahabby turns on, and the only reason `libayatana-appindicator`
  is among the Linux packages CI installs. The production CSP is strict (`script-src 'self'`, no eval,
  `connect-src ipc: http://ipc.localhost`); do not add remote scripts/fonts. `withGlobalTauri: false`.
- App version lives in three places — `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` —
  bump them together (the UI reads the injected `__APP_VERSION__`).

## Testing & QA

- **Frontend**: Vitest (`vitest run`) with jsdom; config is inline in `vite.config.ts`. Use
  `renderWithProviders(ui, { route })` from `src/test/render.tsx` (wraps I18next en, TooltipProvider,
  MemoryRouter). **RTL auto-cleanup is not configured** (`setup.ts` only imports jest-dom, no `globals`), so
  the DOM accumulates across `it` blocks in a file: scope queries with `within(container)`, call `unmount()` /
  `cleanup()`, or avoid duplicated accessible text.
- Tests currently cover: locale key parity + no-empty strings, IPC error normalization, formatting/masking
  helpers, `AgentCard` (render, install gating, badges, click-to-navigate), the Projects page (folders,
  projects, the empty state, adding a folder), the Hub page (a section per source, a kind filter that asks
  only the sources it includes, the read-only preview, the reviewed install request with `confirm: true`, a
  required value gating it, the tags on a card and the tag filter that reaches the backend, the owners an
  entry is already installed for with the name a chosen owner already holds refused, and the entry
  context menu), the terminal tab store (buffered output, finishing and closing a tab, an exit that beat its
  tab, and reconciling with the backend in both directions), `TerminalView` (the scheme it paints the panel
  with, and that a remount shows the session's own emulator again rather than a fresh, blank one), the animated
  list (the row order it renders, and a removed row staying in
  the tree for its exit before it goes), `useSessionState` (a value handed to the next mount, an updater
  composed within one tick, and one key not leaking into another), the Settings areas (appearance,
  window & tray: what the document says, and that a hidden window needs the tray icon, and Cloud sync:
  a token that connects without touching the settings file, the account a verification names, the sync
  block carried through the one Save button, and a restore that previews before it confirms), the per-card
  cloud surface (`CloudActions`: a chip's Save addressing an item by id, its View and Compare reaching the
  reader and the diff, a cloud-only card that restores through its preview, and a chip that renders nothing
  before sync is on; `CloudSummaryCard`: the disclosure listing what can be uploaded and restored, and a
  ticked row reaching its bulk action), and Ahabby's own
  browser: what an href means (`shared/lib/links.ts` — opened, completed, refused, or left to the router), what
  the markdown renderer keeps as a link and what it turns into text, the reader's sanitizer (the article it
  takes, the chrome it drops, the ids it renames, the images it hands to the proxy), the image proxy's
  deduplication and its concurrency limit, and the modal end to end (a link of a document opening it, a link
  inside it navigating in the same window, Back, an address typed into the bar, and the images arriving from
  the backend). Feature hooks are not tested otherwise.
- **Backend**: std libtest via `cargo test`; async with `#[tokio::test]`; `tempfile` is the only dev-dep.
  Use `PlatformContext::for_tests(os, home, app_data, app_config)` with a `tempfile::tempdir()` — never touch
  the real environment or network. Manifest fixtures use `catalog::parse_manifest(toml, "test")`.
  `src-tauri/tests/pipeline.rs` exercises the full read path, install-plan resolution, config edit
  backup/stale/restore, MCP removal (JSONC comment preservation), refusal to write outside declared paths, and
  the project surface end to end (discovery, reading, a skill created inside the project root, switched off and
  on again, and an MCP server added to the project's `.mcp.json`). `services::project` and `adapters::project`
  hold the unit tests around discovery, markers, the reserved owner ids and the re-rooted reads.
  `services::terminal` tests are the only ones that spawn a real process (a PTY is the product): they run the
  user's own shell, answer ConPTY's cursor query themselves, and cover output, input, resize and closing —
  plus the rules that make that startup reliable: the wait for the shell's first prompt (and that a session
  whose console is gone, or that says nothing at all, is not waited out), and that a program which cannot be
  started leaves no session behind. `platform::shell` covers the invocation and quoting per shell kind and the
  terminal environment a GUI launch has to supply.
  `services::web` is tested on its pure parts only — which URLs it refuses (`file:`, a bare path, a URL with
  credentials in it), what a `Content-Type` means, and the charset it decodes with, header or `<meta>` — since
  no test in the suite touches the network.
  `services::hub::installed` builds its index from a fixture report and asserts what a card is told: the owners
  a name is found for (a project and the shared surface included), a skill compared by the hash of a real
  `SKILL.md` written into a `tempdir`, a server by its recipe, and that a different name or a different kind
  matches nothing.
  `services::sync` is proven end to end in `src-tauri/tests/pipeline.rs` against the fixture agent: items are
  derived from a real scan, a push into an in-memory `SyncProvider` records what a listing then reports, a
  second push of unchanged content uploads nothing, an item holding a token is refused until `includeSecrets`
  is on, an automatic run uploads only what changed, and a restore — refused without `confirm` — writes back
  through a fake `SyncTarget` while a copy whose name the owner does not declare is skipped before any write.
  The readers are exercised there too: a file's text and hash, a skill directory read as it is now (a binary
  asset added after the scan included), the same item read back from the cloud as identical, an edited file
  coming back `changed` with both texts for the diff, and a copy this machine has nowhere to put reported as
  cloud-only.
  `desktop::tray` plans its menu as plain data and asserts the plan (the status line, the two submenus, that
  only installed agents are offered), including a test that reads `src/shared/i18n/locales/*.json` and fails
  when the tray's screen names drift from the sidebar's — the same trick `platform::chrome_tokens` uses on
  `globals.css`. The tray _icon_ itself needs a running application and is not unit-tested.
- **QA expectations**: prove the _refusal_ of dangerous write paths, not just happy paths; keep cross-boundary
  invariants tested (event-name strings, locale parity, Rust↔TS secret masking); prefer deterministic,
  isolated tests. No coverage thresholds are configured (`npx vitest run --coverage` is available).
- CI (`.github/workflows/ci.yml`): `frontend` job runs prettier check, lint, typecheck, vitest, vite build;
  `backend` job runs `cargo fmt --check`, `clippy -D warnings`, `cargo test`, and a bindings drift check; a
  `build` job produces bundles on Windows/macOS/Ubuntu.
