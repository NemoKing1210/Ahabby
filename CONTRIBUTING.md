# Contributing

Thanks for helping. Ahabby is small on purpose: a Rust backend that owns every file and process operation, and
a React frontend that renders it. Most contributions are one of three things — a new agent manifest, a new
command, or a new screen. All three have a recipe below.

## Setup

```bash
npm install
npm run tauri dev      # desktop app with hot reload
```

Requirements are in the [README](README.md#requirements).

## Before you push

```bash
npm run format && npm run lint && npm run typecheck && npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

CI runs exactly these, plus a build on Windows, macOS and Linux, and it fails if the generated TypeScript
bindings are out of date.

## Rules of the house

- **One direction of dependencies.** `commands → services → adapters → catalog → domain`, with `platform` as a
  leaf. If you need something from an upper layer, the design is wrong — say so in the PR instead of adding a
  cycle.
- **Business logic never lives in `commands/`.** A command validates its input, calls a service, and returns.
- **The frontend never calls `invoke` directly.** Add a wrapper in `src/shared/api/ipc.ts` and a hook in the
  owning feature. Components only talk to hooks.
- **All UI text goes through i18n.** Add the key to _both_ `src/shared/i18n/locales/en.json` and `ru.json`; a
  test fails if the key sets differ, and another fails on empty strings.
- **Every write to a file goes through `platform::write_atomic`.** It takes the backup and does the rename; do
  not open a config file for writing anywhere else.
- **No new dependency without a reason in the PR description.** The backend deliberately avoids `regex`,
  `uuid` and `chrono`-heavy types, and the frontend has no state library beyond React Query + one Zustand
  store.
- **Tests are part of the change.** A write path needs a test proving it refuses the dangerous case, not only
  the happy path.

## How to add a new agent

The whole point of the catalog: **adding an agent is adding a file**.

### 1. Gather facts from the official documentation

You need: the executable name(s), the version command, the user-scope config paths, where skills live, where
MCP servers are configured (file + key), instruction files, and the documented install commands.

Do not guess. Every path you write must have a `# SOURCE:` comment with the documentation URL and the date you
checked it. Anything you cannot confirm goes into the manifest's `unverified` list — the UI then shows a
"needs verification" badge and lists the fields, which is far better than a wrong path.

### 2. Write the manifest

Copy the complete example in [`src-tauri/catalog/SCHEMA.md`](src-tauri/catalog/SCHEMA.md) and adjust it. Keep
the `# SOURCE:` comments from step 1. A minimal but complete manifest:

```toml
id = "example-cli"
name = "Example CLI"
description = "An example agent."
website = "https://example.com"
docs = "https://example.com/docs"
icon = "example"
popular = true
github = "example/example-cli"
notes = "Paths confirmed against https://example.com/docs/config on 2026-10-05."

[binaries]
names = ["example"]
version_args = ["--version"]

# SOURCE: https://example.com/docs/config
[[configs]]
id = "settings"
label = "Settings"
format = "json"
path = { windows = "${USERPROFILE}/.example/settings.json", macos = "${HOME}/.example/settings.json", linux = "${HOME}/.example/settings.json" }

# SOURCE: https://example.com/docs/skills
[skills]
format = "skillMd"
path = { windows = "${USERPROFILE}/.example/skills", macos = "${HOME}/.example/skills", linux = "${HOME}/.example/skills" }

# SOURCE: https://example.com/docs/mcp
[mcp]
format = "json"
key_path = ["mcpServers"]
shared_with_config = true
path = { windows = "${USERPROFILE}/.example/settings.json", macos = "${HOME}/.example/settings.json", linux = "${HOME}/.example/settings.json" }

# SOURCE: https://example.com/docs/install
[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g example-cli"
update_command = "npm install -g example-cli@latest"
requires = ["node >= 18"]
```

Place it in `src-tauri/catalog/builtin/`. Nothing else changes: `build.rs` embeds every TOML file in that
directory, so the new agent appears in the UI, in the scanner, and in the library automatically.

Users can override your manifest without touching the repository by dropping a file with the same `id` into
`<app config directory>/catalog/`.

### 3. Verify

```bash
cargo test --manifest-path src-tauri/Cargo.toml catalog::
```

This parses and validates **every** shipped manifest: unknown keys, empty path maps, duplicate ids and
commands that do not start with an allowed program all fail the test. Then check it by eye:

```bash
npm run tauri dev
```

The agent must appear in "Installed" (if the binary is on your machine) or in "Available to install" with
either an install button whose command is present in the manifest, or a link to the official instructions.

### 4. When a manifest is not enough

If the agent's format cannot be expressed declaratively, add a specialised adapter:

1. create `src-tauri/src/adapters/<name>.rs` implementing `AgentAdapter` (delegate to `ManifestAdapter` and
   override only what differs);
2. add it to `create()` in `src-tauri/src/adapters/registry.rs`;
3. set `adapter = "<name>"` in the manifest.

Only do this when the manifest cannot describe the layout — see `ARCHITECTURE.md` §1 for why exactly one
specialisation exists today. Try to make the general `ManifestAdapter` handle the new shape first; MCP
normalisation in `adapters/mcp_parse.rs` exists for precisely that reason.

## Icons

`app-icon.png` in the repository root is the source of the platform icons. After changing it, run:

```bash
npx tauri icon app-icon.png && rm -rf src-tauri/icons/android src-tauri/icons/ios
```

(only the desktop icons are kept; the mobile ones are not used).

## How to add a Tauri command

1. Service function in `src-tauri/src/services/` (testable without Tauri, no `AppHandle` unless a
   `JobSink`-style trait is warranted).
2. Thin `#[tauri::command]` in the matching `src-tauri/src/commands/*.rs` — validate input, resolve ids through
   `AppState` so no arbitrary path or command can arrive from the webview.
3. Register it in the `handlers!` macro in `src-tauri/src/lib.rs`.
4. Add a typed wrapper to `src/shared/api/ipc.ts` and a hook in the owning feature.
5. If it can change something on disk, return `MutationResult<T>` so the UI gets a fresh `ScanReport`.

## How to change a shared type

Types that cross the IPC boundary derive `TS` and are exported:

```bash
npm run bindings     # cargo test export_bindings → src/shared/bindings/*.ts
```

Commit the regenerated files together with the Rust change; CI fails if they drift. 64-bit integers need
`#[ts(type = "number")]`, because serde serializes them as JSON numbers and the binding would otherwise claim
`bigint`.

## How to add a UI screen

1. `src/features/<feature>/` with `api/` (hooks), `components/`, `pages/`.
2. Reuse `shared/ui` primitives; if you need a new visual, add it there once instead of styling it twice.
3. Use design tokens (`bg-surface`, `text-muted`, `border-border`, `rounded-lg`, `duration-150 ease-warm`) —
   no raw hex values in components.
4. Every state needs a face: loading (skeleton), empty (with a hint), error (with the error code and a retry).

## Release

`Cargo.toml`, `package.json` and `tauri.conf.json` carry the same version; bump all three in one commit. Release
binaries are produced by the CI workflow (`tauri build` on each platform).
