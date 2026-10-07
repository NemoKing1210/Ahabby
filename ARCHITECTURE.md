# Architecture

Ahabby is a Tauri v2 application: a Rust backend that owns every file, process and network operation, and a
React frontend that only renders what the backend reports. This document explains the boundaries, the data
flow, the safety model, and the assumptions that were made where the requirements left room.

## 1. Layers (backend)

Dependencies point in exactly one direction:

```
commands  →  services  →  adapters  →  catalog  →  domain
                  ↓           ↓
               platform  ─────┘
```

| Layer      | Responsibility                                                                                                                                                                                                                                | May depend on                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| `domain`   | Pure models, no I/O: `Agent`, `AgentManifest`, `Skill`, `McpServer`, `ConfigFile`, `Scope`, `Version`, … Serialized 1:1 into TypeScript.                                                                                                      | —                                |
| `catalog`  | Loads manifests: builtin TOML embedded into the binary at compile time (`build.rs` generates the list) merged with user manifests from `<app config>/catalog/`, which override by id. Validates them and reports problems instead of failing. | `domain`                         |
| `adapters` | The `AgentAdapter` trait and its implementations. This is the only place that knows an agent's file layout. A registry turns manifest ids into adapters.                                                                                      | `catalog`, `platform`, `domain`  |
| `platform` | Everything OS-specific: `${VAR}` path expansion, binary lookup, package-manager detection, process execution with timeouts, atomic writes and backups, opening the file manager.                                                              | `domain`                         |
| `services` | `scanner`, `config_editor`, `installer` + `JobRunner`, `version_checker`, `settings`, `library`, `terminal`. Business logic lives here.                                                                                                       | `adapters`, `platform`, `domain` |
| `commands` | The Tauri command surface: validate input, call a service, return data. No business logic.                                                                                                                                                    | services                         |
| `error`    | One `AppError` type (thiserror) serialized as `{ code, message }`, so the UI switches on a stable code and never parses prose.                                                                                                                | —                                |

### The adapter contract

```rust
#[async_trait]
pub trait AgentAdapter: Send + Sync {
    fn manifest(&self) -> &AgentManifest;
    async fn detect(&self, ctx: &PlatformContext) -> Result<Option<Detection>>;
    async fn version(&self, ctx: &PlatformContext, detection: &Detection) -> Option<Version>;
    async fn config_files(&self, ctx: &PlatformContext) -> Result<Vec<ConfigFile>>;
    async fn list_skills(&self, ctx: &PlatformContext) -> Result<Vec<Skill>>;
    async fn list_mcp_servers(&self, ctx: &PlatformContext) -> Result<Vec<McpServer>>;
    async fn list_other_resources(&self, ctx: &PlatformContext) -> Result<Vec<OtherResource>>;
    async fn remove_skill(&self, ctx: &PlatformContext, skill: &Skill) -> Result<()>;
    async fn remove_mcp_server(&self, ctx: &PlatformContext, server: &McpServer) -> Result<()>;
    async fn install_plan(&self, ctx: &PlatformContext, action: InstallAction, method_id: Option<&str>)
        -> Result<InstallPlan>;
}
```

`ManifestAdapter` implements all of it from the manifest alone. That covers JSON / TOML / YAML configs, MCP
maps under a configurable key path (including the array-shaped variant Continue uses), `SKILL.md` skills with
YAML frontmatter, and every install method. **One** specialised adapter exists today:

- `ClaudeAdapter` (opted into with `adapter = "claude"` in the manifest) because two of its behaviours are
  genuinely not declarative:
  1. Claude Code reads MCP servers from two files (`~/.claude.json` and `mcpServers` inside
     `~/.claude/settings.json`); only the declared one may ever be written, the other is surfaced read-only.
  2. Skills installed under `~/.claude/plugins/**` are owned by the plugin manager and are listed but never
     deleted.

The registry falls back to `ManifestAdapter` (with a warning) for an unknown adapter id, so a typo in a
manifest can never disable an agent.

Two more adapters do not come from the registry, because they read something that is not an agent:

- `ClaudeAdapter` (opted into with `adapter = "claude"` in the manifest) because two of its behaviours are
  genuinely not declarative:
  1. Claude Code reads MCP servers from two files (`~/.claude.json` and `mcpServers` inside
     `~/.claude/settings.json`); only the declared one may ever be written, the other is surfaced read-only.
  2. Skills installed under `~/.claude/plugins/**` are owned by the plugin manager and are listed but never
     deleted.
- `ProjectAdapter` wraps `ManifestAdapter` to read **one project**: `catalog/project.toml` declares the
  project-level locations as _relative_ paths, and the adapter owns the project root, re-rooting every call
  (so a relative path can only ever resolve inside that project) and stamping everything it yields — including
  what `create_skill` / `create_mcp_server` return — with `project:<hash>` as the owner and `Scope::Project`.
  `ManifestAdapter::owned_by` tells the inner adapter's ownership guards which id its resources carry.

## 2. Data flow

```
manifests ──► AdapterRegistry ──► Scanner ──► ScanReport ──► commands ──► React Query ──► UI
                                     │
                                     ├──► services::aggregate ──► Library (skills, MCP, other)
                                     └──► services::project ──► the user's projects (per project root)

hub sources ──► services::hub ──► HubEntry ──► install_hub_resource ──► the *same* adapter as a manual
                (one request per source, cached in memory)              create: install_skill / create_mcp_server
```

- **One scan, one source of truth.** `list_agents` runs (or returns the cached) scan; the agent page, the
  sidebar counters, the library and the project screens all read from it. A rescan replaces it atomically.
- **Mutations return the new report.** `save_config`, `delete_skill`, `delete_mcp_server` and `remove_agent`
  respond with `MutationResult<T> { data, report }`, so the UI never shows a stale file list after a write.
- **A resource is addressed by its owner id.** An agent id, the reserved `shared` surface and a project's
  `project:<hash>` id all resolve through the same `AppState` lookups, so one command set serves all three.
- **Frontend state**: server state lives in React Query (`shared/api/ipc.ts` is the only module that calls
  `invoke`). Zustand is used for one thing only: the install-job console. No component calls `invoke`.

## 3. Safety model

Requirements: every write to someone else's file is validated, backed up and reversible; destructive actions
are confirmed; secrets stay masked; no arbitrary shell from the UI.

| Concern                           | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary command execution       | The UI sends an **agent id + method id**. `plan_for()` resolves the command from the manifest, and `domain::manifest::validate_command` rejects any command whose first token is not the manager's binary, an allow-listed installer (for `script` methods) or the agent's own binary. Commands containing newlines, backticks or `$(…)` are rejected.                                                                                                                                                                                                                                                      |
| Shell injection                   | Non-script commands are executed as `program + args` (no shell). Only `script` methods run through the platform shell, because official installers need it.                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Writing to unexpected paths       | `remove_skill` requires the target to live under a skills directory the manifest declared. `remove_mcp_server` requires the file to be one of the manifest's declared config/MCP files. `save_config` requires the path to be one of the scanned config files of that agent (checked in `AppState::config_target`). `remove_agent` only ever deletes a manifest that is a direct `*.toml` child of Ahabby's own user catalog directory (`AppState::user_manifest_path`).                                                                                                                                    |
| Corrupting a file                 | Content is validated per format before saving (JSON, TOML, YAML parse; markdown/text only UTF-8). TOML edits go through `toml_edit`, so comments and formatting survive; JSON uses `serde_json` with `preserve_order`.                                                                                                                                                                                                                                                                                                                                                                                      |
| Losing data                       | `platform::write_atomic` writes a temp file in the same directory, `fsync`s it, then renames over the original — and takes a timestamped backup first. Unix file permissions are preserved.                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Overwriting a concurrent change   | The editor sends the sha256 it read; the backend re-reads and refuses with `stale_file` if the file changed.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Irreversible deletion             | Skills and user manifests are moved to the OS trash (`trash` crate), never unlinked. Backups can be restored from the UI (and the restore itself is backed up).                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Secrets leaking to the UI         | MCP `env` and `headers` values whose key looks secret are masked **in the backend** (`domain::secrets`), and the raw JSON view is redacted too. `reveal_mcp_secret` returns one key at a time, on explicit request.                                                                                                                                                                                                                                                                                                                                                                                         |
| Destructive actions               | `delete_skill`, `delete_mcp_server` and `remove_agent` require `confirm: true`, which only the confirmation dialog sends. Removing an agent is an explicit choice: **hide** (Ahabby's settings only, reversible from Settings) or **delete**. "Uninstall" is offered only when the manifest declares an uninstall command whose package manager is available and which passes the same whitelist as install commands; a user-catalog manifest can be moved to the OS trash instead, while a shipped manifest can never be deleted.                                                                          |
| Excessive permissions             | `src-tauri/capabilities/default.json` grants exactly one capability (`core:event:default`) for the install console. There is no filesystem or shell plugin: all I/O happens in Rust. The webview CSP forbids remote script, frames and objects.                                                                                                                                                                                                                                                                                                                                                             |
| Opening links                     | `open_url` accepts only `http`/`https`; the file-manager command accepts only existing paths inside the user's home or Ahabby's own directories.                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Native dialogs                    | The dialog plugin is reachable from Rust only (`pick_project_folder`): the webview has no capability for it, so the frontend cannot open a dialog of its own, and the path it returns is validated like any other input.                                                                                                                                                                                                                                                                                                                                                                                    |
| Installing a third-party payload  | A Hub entry is content Ahabby did not write, so the write is the reviewed one: `install_hub_resource` refuses a request without `confirm: true` (the dialog lists every file, or the exact recipe, first), every payload path must be a plain relative one and a set where one file is the parent of another is refused, a skill is written into a fresh directory with `SKILL.md` last and renamed into place, and an existing skill is never merged into or overwritten. A repository/ref/path is re-validated before it becomes a URL, and an index document is held to the same rules as a source file. |
| Unbounded downloads from a source | A source is third-party input: one request per source per page, a 25 s timeout, a 64 MiB ceiling per body read while streaming (an announced length is never trusted), 8 MiB per file, a 48 MiB per-repository budget and a 96 MiB cache budget with oldest-first eviction. A collection that hits a limit is still shown, marked as incomplete.                                                                                                                                                                                                                                                            |

## 4. Manifest policy: verified paths

Agent file layouts change, and guessing one is worse than admitting uncertainty:

- every path group in a builtin manifest carries a `# SOURCE: <url> (checked <date>)` comment;
- anything that could not be confirmed in the official documentation is listed in the manifest's
  `unverified = [...]` (dotted paths), and the UI marks that agent with a "needs verification" badge and lists
  the fields in the Overview tab;
- `deny_unknown_fields` on the manifest structs means a typo in a manifest fails the catalog test loudly
  instead of silently disabling half of an agent.

## 5. Scanning

- Agents are scanned concurrently in chunks of 6 (`FuturesUnordered`, owned `Arc`s — a borrowed closure cannot
  satisfy the higher-ranked lifetime bounds of `buffer_unordered`).
- Every agent has a hard 45 s budget; version commands have 8 s. A timeout produces a skeleton agent with a
  warning, never a failed scan.
- A failing sub-step (unparsable config, missing directory) becomes a warning on that agent.
- Package-manager availability is detected once per scan and reused for every agent.
- Version checks are optional, cached for `version_cache_minutes`, run only for installed agents, and their
  failures are silent.
- The last report is cached in memory: navigation is instant, and `force = false` never rescans.
- Agents the user removed (`settings::hidden_agents`) are filtered out of the report and its counters
  before it is cached, so the list, the sidebar counters and the Library all agree they are gone.
- The user's own folders (`settings::project_folders`) are scanned **after** the agents, and their result
  travels in the same report (`ScanReport::projects`). Each added folder is walked breadth first, at most
  three levels deep and 20 000 directories, stopping at every directory that holds a marker
  (`services::project::markers()` derives them from `catalog/project.toml` plus `.git`, so declaring a new
  location also makes a folder holding it a project); a folder where nothing was found is one project of its
  own, because that is what the user said it was. Reading one project is bounded by its own 15 s timeout and a
  failure in one project never fails the scan — it becomes a warning on that project.

## 6. Frontend structure

```
src/
├─ app/         providers (React Query, tooltips, toasts, job event bridge), hash router, theme, shell
├─ features/
│  ├─ agents/   list, clickable card, agent page (about/overview/configs/skills/mcp/other), removal flow
│  ├─ configs/  snapshot hooks, editor dialog, diff view, backup restore
│  ├─ skills/   skill list + detail (rendered markdown), delete flow
│  ├─ mcp/      server cards, masked secret reveal, delete flow
│  ├─ library/  aggregated skills/MCP/other with search, agent filter, grouping
│  ├─ projects/ the added folders, the projects inside them, native folder dialog, run-agent-in-project
│  ├─ hub/      the collections of skills and MCP servers: one section per source with its own paging,
│  │            a preview that says what an entry *is* (rendered `SKILL.md`, file list, launch recipe),
│  │            the install dialog (target owner, values, confirm) and a per-entry right-click menu
│  ├─ install/  plan preview dialog, streamed job console, Zustand job store
│  ├─ terminal/ docked PTY tabs (xterm.js), new-tab dialog, run-in-terminal action, Zustand tab store
│  └─ settings/ language, theme, accent colour, interface/text size, fonts, scan paths, network
│              checks, backup dir, catalog dir, hidden agents, default terminal
└─ shared/
   ├─ api/      ipc.ts (typed invoke wrappers), events.ts, keys.ts, errors.ts
   ├─ bindings/ generated by ts-rs — do not edit
   ├─ i18n/     i18next + en/ru locales (key parity is enforced by a test)
   ├─ lib/      cn, formatting, secret masking, clipboard
   └─ ui/       design system: Button, Card, Badge, Tabs, Dialog, ConfirmDialog, Toast, Input,
                Switch, Select, Tooltip, EmptyState, ErrorState, Skeleton, Spinner, CodeViewer,
                Markdown, PathRow, AgentIcon
```

- Type safety across the boundary: `#[derive(TS)]` on the Rust models plus `npm run bindings` regenerates
  `src/shared/bindings/*`. CI fails if the committed bindings differ from the generated ones.
- `CodeViewer` (CodeMirror) is lazy-loaded: the initial bundle is ~730 kB, the editor arrives on demand. The
  terminal dock is loaded the same way, the first time a session exists, for xterm.js.
- The terminal is a real emulator over a real PTY: `services::terminal` starts the user's own shell in a
  ConPTY/`openpty` session, types the agent's quoted executable into it (so npm's `.cmd`/`.ps1` shims work on
  Windows) and streams raw bytes as base64 on `terminal://output`. xterm draws them, `terminal://exit` closes
  the loop, and closing a tab closes the console — which is what terminates the agent together with the shell.
  The dock belongs to the shell, not to a screen: its tab strip is always visible, collapsing it only sets the
  body to zero height (the terminals stay mounted, so nothing loses its scrollback), and the top edge is a drag
  handle. Which terminal a "run in terminal" button uses is `Settings::terminal`: the built-in one opens a tab in
  the dock, `platform::terminals` detects and launches the installed ones it knows how to (Warp is
  `opensDirectory` — it has no CLI to run a command).
- Theming: every colour, radius, font and easing lives in CSS variables that `@theme inline` maps into
  Tailwind utilities, so `bg-surface`, `text-muted`, `border-border` follow the automatic dark mode without
  `dark:` variants. Fonts (Inter, Lora, JetBrains Mono) are self-hosted; nothing is loaded from a CDN.
- Appearance (`src/app/appearance.ts`, tokens in `globals.css`): the user's accent colour becomes an injected
  stylesheet that repoints every accent token (`color-mix` derives hover/pressed/tint per theme), and two
  independent knobs resize the interface — `--ah-ui-scale` multiplies Tailwind's `--spacing` and the radii,
  `--ah-font-scale` multiplies the root font size, so type scales without moving the layout.
- Accessibility: Radix primitives for anything interactive, visible focus rings, `aria-live` job log,
  `prefers-reduced-motion` respected, and a monogram instead of trademarked agent logos.

## 7. Assumptions

Recorded here because the task intentionally left them open:

1. **TypeScript 5.9, not 7.** `typescript-eslint` supports TypeScript `<6.1`; the toolchain would otherwise be
   inconsistent. `tsc --noEmit` runs in CI and in `npm run build`.
2. **React 19 and Tailwind v4.** The task asks for "React 18+" and "Tailwind CSS"; v4's `@theme inline` is what
   makes the token set possible without a JS config file.
3. **Serif headings are Lora, not Newsreader.** Newsreader has no Cyrillic subset, and the UI ships Russian.
   Inter and JetBrains Mono both cover Cyrillic.
4. **Scope: global only.** `Scope::Project` exists in the model (`Scope::Project { root }`) and is serialized to
   the frontend, but no project-level entity is scanned in v1.
5. **Library rows are per agent and per path, not merged by name.** Two agents can ship a skill with the same
   name; merging them would make deletion ambiguous. Grouping by name happens in the UI, where it is only
   presentation.
6. **Skill deletion is trash-only.** `trash` moves directories to the OS trash; Ahabby never unlinks a skill.
   A standalone markdown file (`markdownFile` skills, e.g. instruction files) is not deletable at all.
7. **`~/.claude.json` is read-only in the editor.** It holds session state; structured MCP removal is allowed
   because it is a targeted, validated, backed-up edit, but hand-editing a whole state file is not offered.
8. **Linux package managers (apt/dnf/apk) for Claude Code are not automated** — they need `sudo` and several
   steps; Ahabby links to the official instructions instead of faking a one-liner.
9. **Version checks use npm and GitHub only.** A manifest declares `github = "owner/repo"`, and the npm package
   name is derived from an npm install command. Anything else (Homebrew's API, for instance) is not queried.
10. **Backups are Ahabby's own format** (`<backup root>/<hash>/<timestamp>__<name>`) rather than a per-agent
    convention, so every write path can share one implementation.
11. **`ConfigFormat::Yaml` edits are serialized by `serde_yaml`**, which loses YAML comments; the diff shown
    before saving makes that visible. TOML, JSON and JSONC preserve their structure (JSONC by surgical
    splicing, including its BOM).
12. **`jsonc` is a first-class config format.** Cursor and opencode ship commented JSON in the wild, so Ahabby
    parses it leniently and _removes entries by text splicing_ rather than reprinting the file — reprinting
    would silently delete the comments a user keeps commented-out servers in.
13. **Extra scan paths extend binary discovery, not config discovery.** Manifest paths are absolute templates;
    "additional scan paths" in Settings add more places to look for executables (that is what makes an
    unusual installation visible).
14. **The catalog ships with 10 agents.** The task asked for 8–9; Claude Code is included and is the reference
    implementation for the specialised adapter.
15. **Removing an agent is a deletion only when it has its own manifest.** A manifest in the user catalog is
    moved to the OS trash; an agent whose manifest ships with Ahabby (or whose user manifest overrides a
    builtin) is only hidden, because deleting the override would resurrect the builtin. Hidden ids live in
    `settings.json` and are filtered out of every scan, so the agent leaves the list, the counters and the
    Library together.
16. **A terminal session runs the user's own shell, not the agent binary directly.** Windows installs `.cmd`
    and `.ps1` shims that `CreateProcess` cannot start, and a shell is also what leaves the user at a prompt in
    the right directory once the agent exits — so the agent is handed to the shell as one typed line. The
    shell is `pwsh` → Windows PowerShell → `cmd.exe` on Windows and `$SHELL` (falling back to a POSIX shell)
    elsewhere; sessions are capped at 24 and finished ones are pruned after ten minutes.
17. **External terminals are a fixed, curated table, not a guess.** Every entry carries its own documented
    launch contract (`-e`/`--command`, Windows Terminal's `-w 0 nt -d`, macOS's AppleScript `do script`, or
    Warp's URI scheme), and it is offered only after `detect()` found it on this machine. A terminal that
    cannot be told to run a program (Warp) is marked `opensDirectory` and the UI says so rather than
    pretending the agent will start by itself.

## 8. Testing

| Level                    | What it covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rust unit tests (363)    | path expansion, version parsing, manifest validation and the command whitelist, hub source validation and the three hub formats (registry records, repository tarballs, index documents, and the preview read out of a skill's entry file), MCP normalisation, frontmatter parsing, document edits (comment preservation), secret masking, file_io backups/atomic writes/permissions, settings round-trips, process timeouts, scanner behaviour on temporary homes, install-job streaming and cancellation, version-check caching, and the terminal: shell selection/quoting, terminal detection and launch argvs, and PTY sessions (output, input, resize, close, exit) |
| `tests/pipeline.rs` (24) | the whole read path from a **user** manifest, library aggregation, install-plan resolution, config editing with backup/restore/stale detection, MCP removal that leaves the rest of the file untouched, refusal to write outside declared paths, and installing a hub payload: the whole directory inside the declared skills root, a path that would escape it refused, a payload without `SKILL.md` refused, the same name refused twice, and a project install landing inside the project                                                                                                                                                                             |
| Vitest (178)             | locale key parity, secret-masking parity with Rust, formatting helpers, error normalisation, `AgentCard` rendering and callbacks, the Projects screen, the Hub screen (one section per source, a kind filter that does not ask the sources it excludes, the preview of an entry beside it, the reviewed install request with `confirm: true`, a required value that gates it, and the entry's context menu), and the terminal tab store                                                                                                                                                                                                                                  |

```bash
cargo test --manifest-path src-tauri/Cargo.toml   # backend
npm test                                          # frontend
```

To check the catalog against a real machine (how the shipped manifests were validated — this is what caught
Cursor's JSONC `mcp.json` and opencode's `opencode.jsonc`):

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example scan
cargo run --manifest-path src-tauri/Cargo.toml --example scan -- --json
```

To check the Hub's sources against the live APIs — the built-in collections plus any source file of your own —
without launching the app (nothing is written; `--payload` also fetches one skill's files):

```bash
cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --limit 3
cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --query pdf --payload
```
