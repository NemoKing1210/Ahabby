<p align="center">
  <img src="src-tauri/icons/icon.png" width="96" height="96" alt="Ahabby">
</p>

<h1 align="center">Ahabby</h1>

<p align="center">
  <strong>One place for every AI coding agent on your machine.</strong><br>
  Versions, config files, global skills, MCP servers, sub-agents and instructions.
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-59d5cc?style=flat-square" alt="MIT License"></a>
  <a href="https://github.com/NemoKing1210/Ahabby/actions/workflows/ci.yml"><img src="https://github.com/NemoKing1210/Ahabby/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://github.com/NemoKing1210/Ahabby/releases/latest"><img src="https://img.shields.io/github/v/release/NemoKing1210/Ahabby?style=flat-square" alt="Latest release"></a>
  <img src="https://img.shields.io/badge/Tauri-2-24C8DB?style=flat-square&logo=tauri&logoColor=white" alt="Tauri 2">
  <img src="https://img.shields.io/badge/React-19-61DAFB?style=flat-square&logo=react&logoColor=white" alt="React 19">
  <img src="https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&logo=rust&logoColor=white" alt="Rust">
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#build">Build</a> ·
  <a href="#adding-an-agent">Adding an agent</a> ·
  <a href="CONTRIBUTING.md">Contributing</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

---

Ahabby finds the AI coding agents installed on your machine and puts them in one place: versions, config
files, global skills, MCP servers, sub-agents and instructions. You can read all of it, edit configs with a
diff and a backup, and install or update an agent with the exact command from its manifest.

Windows, macOS and Linux — built with Tauri v2 + React + TypeScript.

## What it does

- **Finds agents automatically.** Over 30 agents — Claude Code, Codex CLI, Gemini CLI, opencode, Copilot
  CLI, Cursor CLI, Amp, Kilo Code, Kiro, Goose, Crush, Droid, Junie, Hermes, OpenClaw, Pi, omp, Zed,
  Windsurf, Aider, Cline, Continue and more — one declarative manifest each, no code per agent.
- **Shows what is actually installed:** version, path, how it was installed, and whether a newer version
  exists (optional, uses the npm registry or GitHub releases).
- **Gives every agent its own page:** what the tool is, who publishes it, its key features, and tabs for its
  config files, skills, rules and other resources, and MCP servers.
- **Groups everything in a Library view:** every skill (with its `SKILL.md` frontmatter and rendered body),
  every MCP server (transport, command/URL, which agents use it) and every other resource.
- **Edits configs safely:** validate → diff → timestamped backup → atomic write, and a refusal to overwrite
  a file that changed on disk since you opened it.
- **Runs installs and updates with a visible command:** streamed output, cancellable, and only commands that
  come from a manifest — never from the interface.
- **Removes agents you do not use:** a manifest from your own catalog is moved to the trash, an agent that
  ships with Ahabby is hidden instead — both behind a confirmation dialog, and hidden agents can be brought
  back from Settings.
- **Keeps secrets masked**: MCP tokens and headers are masked in the backend, and revealed one value at a
  time when you ask for it.
- **Speaks English and Russian**, light and dark theme, warm editorial design.

## Requirements

|         |                                                                                         |
| ------- | --------------------------------------------------------------------------------------- |
| Node    | 20 or newer (24 LTS recommended)                                                        |
| Rust    | 1.82 or newer, with the MSVC toolchain on Windows                                       |
| Windows | WebView2 runtime (preinstalled on Windows 10/11)                                        |
| macOS   | 10.15 or newer                                                                          |
| Linux   | `webkit2gtk-4.1`, `libayatana-appindicator3`, `librsvg2`, `libssl` development packages |

## Quick start

```bash
npm install
npm run tauri dev
```

## Build

```bash
npm run tauri build            # installers for the current OS
npm run tauri build -- --no-bundle   # just the executable
```

## Scripts

| Script                                                                           | What it does                                                          |
| -------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `npm run dev`                                                                    | Vite dev server only (open it in a browser for pure UI work)          |
| `npm run tauri dev`                                                              | The whole desktop app                                                 |
| `npm run build`                                                                  | Typecheck + production frontend bundle                                |
| `npm run tauri build`                                                            | Desktop binaries and installers                                       |
| `npm run typecheck`                                                              | `tsc --noEmit`                                                        |
| `npm run lint`                                                                   | ESLint (type aware)                                                   |
| `npm run format`                                                                 | Prettier                                                              |
| `npm test`                                                                       | Vitest + Testing Library                                              |
| `npm run bindings`                                                               | Regenerate the Rust → TypeScript types (`cargo test export_bindings`) |
| `cargo test --manifest-path src-tauri/Cargo.toml`                                | Backend unit + integration tests                                      |
| `cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings` | Backend lints                                                         |

## Where things live

```
src/                     React app: app/ (shell) · features/ · shared/ (ui, api, i18n, lib)
src/shared/bindings/     TypeScript types generated from the Rust structs (do not edit)
src-tauri/src/           Rust: domain · catalog · adapters · platform · services · commands
src-tauri/catalog/builtin/*.toml   One file per agent — this is the whole "support matrix"
```

## Adding an agent

Drop a TOML file into `src-tauri/catalog/builtin/` (or into `<app config>/catalog/` at runtime) and run
`cargo test --manifest-path src-tauri/Cargo.toml catalog::`. No Rust, no TypeScript, no UI change.

The schema is documented in [`src-tauri/catalog/SCHEMA.md`](src-tauri/catalog/SCHEMA.md) and the walkthrough
is in [`CONTRIBUTING.md`](CONTRIBUTING.md#how-to-add-a-new-agent).

## Documentation

- [`ARCHITECTURE.md`](ARCHITECTURE.md) — layers, data flow, the safety model and the assumptions taken.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — development workflow and recipes (new agent, new command, new string).
- [`src-tauri/catalog/SCHEMA.md`](src-tauri/catalog/SCHEMA.md) — manifest reference.

## Licence

MIT.
