# Repository Guidelines

## Project Overview

Ahabby is a cross-platform (Windows/macOS/Linux) Tauri v2 desktop app that finds the AI coding agents
installed on the machine and puts them in one place: versions, config files, global skills, MCP servers,
rules/instructions/sub-agents/hooks, and safe install/update commands.

Core boundary: **the Rust backend owns every file, process and network operation; the React frontend only
renders what the backend reports.** Adding support for a new agent is adding one declarative TOML manifest —
no Rust, no TypeScript. UI is bilingual (English/Russian).

Version: `0.1.0`. Changelog: [CHANGELOG.md](CHANGELOG.md). Claude Code uses [CLAUDE.md](CLAUDE.md).

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
- `adapters` — `AgentAdapter` trait + `ManifestAdapter` (declarative). Only one specialised adapter exists:
  `ClaudeAdapter` (`adapter = "claude"`), because Claude Code reads MCP from two files and plugin-managed
  skills must never be deleted.
- `platform` — OS-specific: path expansion (`${VAR}`), binary lookup, package-manager detection, process
  execution with timeouts, atomic writes + backups.
- `services` — scanner, config editor, installer + job runner, version checker, settings, library.
- `commands` — thin Tauri command surface; validates input, calls a service.

Data flow:

```
manifests → AdapterRegistry → Scanner → ScanReport → commands → React Query → UI
                                  └→ services::aggregate → Library
```

- One scan, one source of truth; the last report is cached in memory so navigation is instant.
- Mutations that touch disk return `MutationResult<T> { data, report }`, and the frontend pushes the fresh
  `report` into the agents query cache.

Frontend boundaries (enforce them):

- **`src/shared/api/ipc.ts` is the only module that calls Tauri `invoke`.** No component or hook calls it.
- **`src/shared/api/events.ts` is the only module that calls `listen`** (`job://output`, `job://done`).
- Server state = React Query (per-feature `api/` hooks, keys in `src/shared/api/keys.ts`). Zustand is used in
  exactly two places: the install-job console store and the toast store.
- Routing is hash-based (`createHashRouter` in `src/app/router.tsx`) because the packaged app has no server SPA
  fallback. Routes: `/` (agents), `/agents/:agentId`, `/library`, `/settings`.

Type safety across the boundary: Rust types derive `TS` (`#[ts(export, export_to = "../../src/shared/bindings/")]`);
`src/shared/bindings/*.ts` is **generated, never hand-edited**. 64-bit ints need `#[ts(type = "number")]`.

## Key Directories

| Path                               | Purpose                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| `src/app/`                         | Providers (React Query, tooltips, toasts, job event bridge), hash router, theme, shell           |
| `src/features/<feature>/`          | `api/` hooks, `components/`, `pages/` — agents, configs, skills, mcp, library, install, settings |
| `src/shared/api/`                  | `ipc.ts` (typed `invoke` wrappers), `events.ts`, `keys.ts`, `errors.ts`                          |
| `src/shared/bindings/`             | ts-rs generated types (do not edit)                                                              |
| `src/shared/i18n/`                 | i18next init + `locales/{en,ru}.json` (single `translation` namespace)                           |
| `src/shared/lib/`                  | `cn`, formatting, secret masking, clipboard                                                      |
| `src/shared/ui/`                   | Design system: Button, Badge, Card, Tabs, Dialog, Toast, CodeViewer, Markdown, …                 |
| `src/styles/globals.css`           | CSS variables, `@theme inline` token mapping, base layer, keyframes                              |
| `src-tauri/src/`                   | Rust: `domain · catalog · adapters · platform · services · commands · state.rs · error.rs`       |
| `src-tauri/catalog/builtin/*.toml` | One manifest per agent — the whole support matrix                                                |
| `src-tauri/catalog/SCHEMA.md`      | Manifest reference (authoritative alongside `domain/manifest.rs`)                                |
| `src-tauri/tests/pipeline.rs`      | End-to-end backend read/write pipeline tests                                                     |
| `.github/workflows/ci.yml`         | The only CI workflow                                                                             |

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
  `*-primary`. Every screen needs loading (skeleton), empty (hint) and error (code + retry) states.
- **Dialogs** are conditionally mounted with a `key` for state reset and an `onOpenChange` that unmounts —
  not always-present with an `open` prop.
- **Config edits** must follow: edit → `previewConfigSave` (diff + validation + hash) → `saveConfig`.
  Stale-file errors are detected via `isStaleFileError`.
- **i18n**: add every new string to **both** `en.json` and `ru.json`; parity is enforced by
  `src/shared/i18n/locales.test.ts`. Plurals use i18next `_one`/`_other`.
- **Icons**: `AgentIcon` renders a deterministic monogram (no trademarked logos) — do not add brand assets.

### Backend patterns

- **Every disk write goes through `platform::write_atomic`** (temp file → fsync → rename, timestamped
  backup first, Unix permissions preserved). Do not open a config file for writing anywhere else.
- Services take a `PlatformContext` and must not depend on `AppHandle` (except where a `JobSink` is needed).
- Commands resolve inputs through `AppState` (e.g. `config_target(agent_id, path)` is the security seam: the
  path must exactly match a declared config of that agent, else `CommandNotAllowed`). `remove_skill` /
  `remove_mcp_server` require `confirm: true`.
- Commands are never trusted from the UI: the UI sends an agent id + method id; `plan_for()` resolves the
  command from the manifest and `validate_command` enforces the first token (manager binary, allow-listed
  installer for `script`, or the agent's own binary) and rejects newlines/backticks/`$(…)`. Non-script commands
  run as program + args (no shell).
- Secrets (`env`/`headers` keys that look secret) are masked **in the backend** (`domain::secrets`); the
  frontend mirror `src/shared/lib/mask.ts` must stay in sync with it.
- New Tauri command = 4 edits: service fn → thin `#[tauri::command]` → add to the `handlers!()` macro in
  `src-tauri/src/lib.rs` → typed wrapper in `src/shared/api/ipc.ts` (+ a feature hook). Arg names are
  camelCase on the TS side.
- Add a manifest field = update `domain/manifest.rs` + `validate()` + `SCHEMA.md` (+ `CONTRIBUTING.md` example
  if user-facing), then `npm run bindings`.

### Manifest conventions

- Manifests live in `src-tauri/catalog/builtin/*.toml`; `id` is the file stem and also authoritative inside
  the file. `deny_unknown_fields` is on, so typos fail loudly. Unknown keys are removed; field names use TOML
  `snake_case`.
- Every path group carries a `# SOURCE: <url> (checked <date>)` comment. Anything unconfirmed goes into
  `unverified = ["dotted.path"]` (prefix-tolerant matching; UI shows a "needs verification" badge).
- Top-level keys: `id, name, description, tagline, website, docs, icon, category, popular, vendor, features,
github, adapter, binaries, search_paths, configs, skills, mcp, other, methods, unverified, notes, source`.
  `claude-code.toml` is the fullest example; `SCHEMA.md` has a complete minimal example.

## Important Files

- Entry points: `index.html`, `src/main.tsx`, `src/app/router.tsx`, `src/app/providers.tsx`;
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
- **Tauri**: capabilities grant exactly `core:event:default`; there is **no** `fs`, `shell`, `dialog` or
  `http` plugin — all I/O/process/network is in Rust. The production CSP is strict (`script-src 'self'`,
  no eval, `connect-src ipc: http://ipc.localhost`); do not add remote scripts/fonts. `withGlobalTauri: false`.
- App version lives in three places — `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` —
  bump them together (the UI reads the injected `__APP_VERSION__`).

## Testing & QA

- **Frontend**: Vitest (`vitest run`) with jsdom; config is inline in `vite.config.ts`. Use
  `renderWithProviders(ui, { route })` from `src/test/render.tsx` (wraps I18next en, TooltipProvider,
  MemoryRouter). **RTL auto-cleanup is not configured** (`setup.ts` only imports jest-dom, no `globals`), so
  the DOM accumulates across `it` blocks in a file: scope queries with `within(container)`, call `unmount()` /
  `cleanup()`, or avoid duplicated accessible text.
- Tests currently cover: locale key parity + no-empty strings, IPC error normalization, formatting/masking
  helpers, and `AgentCard` (render, install gating, badges, click-to-navigate). Hooks/stores are not tested.
- **Backend**: std libtest via `cargo test`; async with `#[tokio::test]`; `tempfile` is the only dev-dep.
  Use `PlatformContext::for_tests(os, home, app_data, app_config)` with a `tempfile::tempdir()` — never touch
  the real environment or network. Manifest fixtures use `catalog::parse_manifest(toml, "test")`.
  `src-tauri/tests/pipeline.rs` exercises the full read path, install-plan resolution, config edit
  backup/stale/restore, MCP removal (JSONC comment preservation), and refusal to write outside declared paths.
- **QA expectations**: prove the _refusal_ of dangerous write paths, not just happy paths; keep cross-boundary
  invariants tested (event-name strings, locale parity, Rust↔TS secret masking); prefer deterministic,
  isolated tests. No coverage thresholds are configured (`npx vitest run --coverage` is available).
- CI (`.github/workflows/ci.yml`): `frontend` job runs prettier check, lint, typecheck, vitest, vite build;
  `backend` job runs `cargo fmt --check`, `clippy -D warnings`, `cargo test`, and a bindings drift check; a
  `build` job produces bundles on Windows/macOS/Ubuntu.
