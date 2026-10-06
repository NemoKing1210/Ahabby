# CLAUDE.md

Instructions for [Claude Code](https://code.claude.com/docs/en/claude-md) working in this repo. Full architecture map: [AGENTS.md](AGENTS.md). Human workflow: [CONTRIBUTING.md](CONTRIBUTING.md). Architecture rationale: [ARCHITECTURE.md](ARCHITECTURE.md).

## Project

Ahabby is a **Tauri 2** desktop app that finds the AI coding agents installed on the machine and puts them in one place: versions, config files, global skills, MCP servers, and rules/instructions/sub-agents/hooks. It does the same for the user's own projects: folders they add are searched for projects, and each project's local skills, MCP servers and documents are read and edited through the very same pipeline. It reads and edits configs with a diff and a backup, and runs install/update commands taken only from a manifest. It can also start an agent in a terminal — its own tabbed one, or one installed on the machine — but it stays a control panel: it never talks to a model and never invents what to execute.

Stack: React 19 + TypeScript + Vite + Tailwind v4 + React Query + xterm.js + three Zustand stores (install console, toasts, terminal tabs) + i18next (`en`/`ru`) + Radix UI + lucide-react. Native: Rust 2021, Tauri 2, `reqwest`, `toml_edit`, `portable-pty`. Identifier: `io.ahabby.app`. Alias `@/*` → `src/*`. Vite port **1420**.

`npm run dev` is UI-only (browser, IPC fails). Use `npm run tauri dev` for anything that touches files, processes, or the scanner.

## Commands

```bash
npm install
npm run tauri dev          # real desktop app
npm run lint
npm run format:check
npm run build              # tsc --noEmit + Vite
npm run check:versions     # SemVer files + changelog section
npm run version:patch      # bump every version file
npm run release            # tag vX.Y.Z and push
cargo test --manifest-path src-tauri/Cargo.toml
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
npm run bindings           # regenerate src/shared/bindings
npm run tauri build        # packaged binary
```

Before finishing a change: `npm run build` and `cargo check --manifest-path src-tauri/Cargo.toml`. Prettier: 100 width, single quotes, no semicolons (`.prettierrc`). Rust: default rustfmt.

## Architecture (short)

Rust dependencies point one way: `commands → services → adapters → catalog → domain`, with `platform` as a leaf. Business logic never lives in `commands/`. The frontend is render-only: `src/shared/api/ipc.ts` is the only module that calls `invoke`.

A terminal session is a real PTY (`services/terminal.rs` over `portable-pty`): the backend runs the user's own shell and types the agent's executable into it, the frontend renders the bytes with xterm and sends the keys back. It is asked for with an **agent id**, never a program or a command line.

```
src/app/                   providers (React Query, toasts, job + terminal bridges), hash router, theme, shell
                           (which owns the terminal dock and loads xterm.js on demand)
src/features/<feature>/    api/ hooks, components/, pages/
src/shared/api/            ipc.ts, events.ts, keys.ts, errors.ts
src/shared/bindings/       ts-rs generated types (do not edit)
src/shared/i18n/           i18next + locales/{en,ru}.json (parity enforced by a test)
src/shared/ui/             design system (Radix primitives wrapped)
src-tauri/src/             domain · catalog · adapters · platform · services · commands
src-tauri/catalog/builtin/*.toml   one manifest per agent — the whole support matrix
src-tauri/catalog/project.toml     the project surface — relative locations a project keeps resources in
```

Adding an agent = adding one TOML manifest. No Rust, no TypeScript. A project-level location is one entry in
`catalog/project.toml`; a tool with several skills directories or MCP files uses `[[skills]]` / `[[mcp]]`.

## Versioning

SemVer starts at **0.1.0**. Every shipped change must bump the version and add a dated section to [CHANGELOG.md](CHANGELOG.md). Do not defer this.

- **Patch** (`0.1.0` → `0.1.1`): small change — bugfix, copy, docs, tweak, translation, hardening.
- **Minor** (`0.1.1` → `0.2.0`): new user-visible capability, still compatible.
- **Major** (`0.2.0` → `1.0.0`): breaking change for users or persisted data.

Default to patch when unsure. Keep `package.json`, `package-lock.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock` (`ahabby`), `src-tauri/tauri.conf.json`, and the `Version:` line in [AGENTS.md](AGENTS.md) in sync. The UI reads the version from `package.json` via the Vite-injected `__APP_VERSION__`.

## Rules

1. Every disk write goes through `platform::write_atomic`. Do not open a config file for writing anywhere else.
2. The frontend never calls `invoke` directly — add a wrapper in `src/shared/api/ipc.ts` and a hook in the owning feature.
3. Commands resolve inputs through `AppState` (agent id + method id); a path must match a declared config exactly, and a terminal session is resolved from the agent id as well. `remove_skill` / `remove_mcp_server` require `confirm: true`.
4. Secrets (`env`/`headers` values that look secret) are masked **in the backend**; keep `src/shared/lib/mask.ts` in sync.
5. Every user-facing string goes in **both** `src/shared/i18n/locales/en.json` and `ru.json`.
6. New Tauri command = service fn → thin `#[tauri::command]` → `handlers!()` in `src-tauri/src/lib.rs` → typed wrapper in `src/shared/api/ipc.ts` (+ feature hook).
7. Use design tokens (`bg-surface`, `text-muted`, `border-border`), never raw hex. Every screen needs loading, empty, and error states.
8. Do not edit `src/shared/bindings/**` by hand — run `npm run bindings`.
9. Log every change in `CHANGELOG.md` and bump SemVer.
10. Write commit messages in [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/): `type(scope): description`. The `.githooks/commit-msg` hook and CI (`npm run check:commits`) reject anything else.

## Do not

- Add a second state library, a second i18n system, or raw Radix imports in features.
- Guess agent paths: every manifest path group needs a `# SOURCE:` comment, and unconfirmed fields go in `unverified`.
- Treat `npm run dev` as a substitute for `tauri dev` when touching native behavior.
