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

## Commits

Every commit uses [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/):

```
<type>(<scope>)!: <description>
```

- **type** — one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`, `ci`, `chore`, `revert`.
- **scope** — optional and lowercase; recommended: `agents`, `catalog`, `configs`, `skills`, `mcp`, `library`,
  `install`, `settings`, `ui`, `i18n`, `api`, `ci`, `deps`, `release`.
- **!** — mark a breaking change.
- **description** — imperative, no trailing period, whole subject within 100 characters.

```
feat(agents): show the detected version on the card
fix(api): reject config paths the manifest does not declare
ci: cache the Rust build between jobs
chore(deps): bump vite to 8.3
```

One logical change per commit. Merge, revert, `fixup!`, `squash!` and Dependabot (`Bump ...`) commits are
accepted as-is, so rebases and bot PRs are never blocked.

`npm install` enables the hooks (`prepare` → `scripts/setup-hooks.mjs`, `core.hooksPath=.githooks`):

| Hook         | Runs                                               |
| ------------ | -------------------------------------------------- |
| `commit-msg` | Rejects a message that is not Conventional Commits |
| `pre-commit` | Prettier check and ESLint on the staged files      |
| `pre-push`   | `npm run check:versions`                           |

Bypass a hook once with `git commit --no-verify` / `git push --no-verify`. CI re-validates the whole PR with
`npm run check:commits <base>..<head>`, so a bypass only moves the failure.

## Before you push

```bash
npm run format && npm run lint && npm run typecheck && npm test
cargo fmt --manifest-path src-tauri/Cargo.toml --all
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
cargo test --manifest-path src-tauri/Cargo.toml
```

CI runs exactly these, plus version sync and the release-script tests. Installers for Windows, macOS and Linux
are built by the release workflow on a `v*.*.*` tag, not on every pull request.

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
vendor = "Example Inc."
features = ["What sets this agent apart"]
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
[[skills]]
format = "skillMd"
path = { windows = "${USERPROFILE}/.example/skills", macos = "${HOME}/.example/skills", linux = "${HOME}/.example/skills" }

# SOURCE: https://example.com/docs/mcp
[[mcp]]
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

`[[skills]]` and `[[mcp]]` are repeatable — a tool may keep skills in more than one directory and servers in
more than one file — and the **first** entry of each list is where Ahabby writes a new skill or server. The
older single-table form (`[skills]`, `[mcp]`) still parses, so existing manifests and user overrides need no
change.

If the agent also reads something _inside a project_ (a project-level skills directory, a workspace MCP file,
a rules folder), that belongs in `src-tauri/catalog/project.toml` rather than in your agent manifest: its
paths are relative and are resolved against the project being read, and the locations you declare there are
also what makes Ahabby recognise a folder as a project. Nothing else changes — the entry is read, edited,
switched off and deleted exactly like an agent's own.

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

Only do this when the manifest cannot describe the layout — see `ARCHITECTURE.md` §1 for the two that exist
today (a tool that reads MCP from two files, and the project surface). Try to make the general
`ManifestAdapter` handle the new shape first; MCP normalisation in `adapters/mcp_parse.rs` exists for precisely
that reason.

## How to add a hub source

The Hub reads _collections_, and a collection is one TOML file too. For a repository of `SKILL.md`
directories it is three fields:

```toml
# src-tauri/catalog/hub/example-skills.toml
# SOURCE: https://github.com/owner/repo (checked 2026-10-07) — skills/<name>/SKILL.md
id = "example-skills"
name = "Example Skills"
kind = "githubSkills"
repository = "owner/repo"
path = "skills"
exclude = ["skills/template"]
provides = ["skill"]
vendor = "Owner"
homepage = "https://github.com/owner/repo"
license = "MIT"
description = """One paragraph under the heading."""
```

`kind = "mcpRegistry"` takes a `url` instead and reads the official MCP registry (searched and paged
server side); `kind = "index"` takes a `url` pointing at a JSON document that lists entries explicitly.
Every field, the index format and the limits a source is held to are in
[`src-tauri/catalog/HUB.md`](src-tauri/catalog/HUB.md).

Verify it against the live API — this reads the collection, opens one entry of each kind and fetches one
skill's files, without launching the app and without writing anything:

```bash
cargo test --manifest-path src-tauri/Cargo.toml catalog::hub::
cargo run --manifest-path src-tauri/Cargo.toml --example hub -- --limit 3 --payload
```

Then open `npm run tauri dev` → **Hub**: the collection must appear as its own section, list the entries
with their descriptions, and install one of them into every kind of owner (shared, an agent, a project).
A user's own source goes into `<app config>/hub/` and replaces a built-in one with the same `id`.

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

Versions and the changelog are managed by scripts, not by hand. Every shipped change gets a SemVer bump and a
dated `CHANGELOG.md` section in the same commit — see [`.cursor/rules/versioning.mdc`](.cursor/rules/versioning.mdc).

```bash
npm run version:patch     # or version:minor / version:major
npm run check:versions    # confirm every version file and the changelog section agree
npm run release           # tag vX.Y.Z from package.json and push it
```

`version:*` updates `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`,
`src-tauri/tauri.conf.json` and the `Version:` line in [AGENTS.md](AGENTS.md), then inserts a `CHANGELOG.md`
stub. Edit the notes before committing.

Pushing a `v*.*.*` tag (or running the workflow manually) starts [`.github/workflows/release.yml`](.github/workflows/release.yml):
it re-runs CI, builds installers for macOS arm64/x64, Linux x64/arm64 and Windows x64, and attaches them to a
draft GitHub Release whose notes come from the matching `CHANGELOG.md` section. Signing is optional and uses
these repository secrets:

| Secret                                                                        | Purpose              |
| ----------------------------------------------------------------------------- | -------------------- |
| `APPLE_CERTIFICATE` / `APPLE_CERTIFICATE_PASSWORD` / `APPLE_SIGNING_IDENTITY` | macOS code signing   |
| `APPLE_ID` / `APPLE_PASSWORD` / `APPLE_TEAM_ID`                               | macOS notarization   |
| `WINDOWS_CERTIFICATE` / `WINDOWS_CERTIFICATE_PASSWORD`                        | Windows code signing |
