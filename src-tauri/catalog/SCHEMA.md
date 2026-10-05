# Agent manifest schema

A manifest is a TOML file in `src-tauri/catalog/builtin/` (shipped with Ahabby) or in
`<app config dir>/catalog/` (user overrides, same id wins).

**Adding support for a new agent means adding one file here — no Rust, no TypeScript.**

Field names may be written in `snake_case` (idiomatic TOML, recommended) or `camelCase`;
both are accepted. Unknown fields are rejected on purpose, so typos fail loudly in the test
suite instead of silently disabling half of an agent's functionality.

Every path must carry a `# SOURCE:` comment pointing at the official documentation page it
was taken from. Paths that could not be confirmed must be listed in `unverified` — Ahabby
shows them to the user with a "needs verification" badge instead of pretending to be sure.

## Top level

| key           | type             | notes                                                                       |
| ------------- | ---------------- | --------------------------------------------------------------------------- |
| `id`          | string, required | `[a-z0-9_-]+`, stable, used as the primary key                              |
| `name`        | string, required | display name                                                                |
| `description` | string, required | one sentence for the card                                                   |
| `tagline`     | string           | short marketing-free summary                                                |
| `website`     | string           | product page                                                                |
| `docs`        | string           | documentation root                                                          |
| `icon`        | string           | icon key rendered by `src/shared/ui/AgentIcon.tsx` (falls back to initials) |
| `category`    | string           | free-form grouping (`cli`, `editor`, `extension`)                           |
| `popular`     | bool             | show in "available to install" even on a bare machine                       |
| `vendor`      | string           | who publishes the agent, shown on its own page                              |
| `features`    | [string]         | short highlights, shown on the agent's own page                             |
| `github`      | string           | `owner/repo`, used for the release check and the repository link            |
| `adapter`     | string           | `manifest` (default) or `claude`; see `ARCHITECTURE.md`                     |
| `unverified`  | [string]         | dotted paths that still need a docs check, e.g. `["skills.path"]`           |
| `notes`       | string           | provenance notes shown in the UI                                            |

## `[binaries]`

| key               | type                               | notes                                                            |
| ----------------- | ---------------------------------- | ---------------------------------------------------------------- |
| `names`           | [string], required                 | executable names tried in order, on `PATH` and in `search_paths` |
| `version_args`    | [string]                           | default `["--version"]`                                          |
| `version_extract` | `"semver"` \| `"line"` \| `"json"` | default `semver`: first semver-looking token in the output       |
| `help_args`       | [string]                           | optional, used for the "what is this" tooltip                    |

## `[[search_paths]]` (optional, repeatable)

Extra directories to look for the binary in, as a per-OS map:

```toml
[[search_paths]]
windows = ["${APPDATA}/npm"]
macos = ["/opt/homebrew/bin", "${HOME}/.local/bin"]
linux = ["${HOME}/.local/bin"]
```

Placeholders: `${HOME}`, `${USERPROFILE}`, `${APPDATA}`, `${LOCALAPPDATA}`, `${PROGRAMFILES}`,
`${XDG_CONFIG_HOME}`, `${XDG_DATA_HOME}`, `${XDG_STATE_HOME}`, `${XDG_CACHE_HOME}`, plus a
leading `~`. An unresolvable placeholder means "not applicable on this OS" — never invent a
path.

## `[[configs]]` (optional, repeatable)

| key           | type                                                                    | notes                                                                                                                                           |
| ------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string, required                                                        | unique inside the manifest                                                                                                                      |
| `label`       | string, required                                                        | shown in the UI                                                                                                                                 |
| `description` | string                                                                  | where this file comes from                                                                                                                      |
| `format`      | `json` \| `jsonc` \| `toml` \| `yaml` \| `markdown` \| `text`, required | drives validation + syntax highlighting. `jsonc` = JSON with comments and trailing commas; entries are removed by splicing, so comments survive |
| `scope`       | `global` (default) or `{ project = "..." }`                             | v1 only surfaces global                                                                                                                         |
| `path`        | per-OS map, required                                                    | a file, or a directory when `glob` is given                                                                                                     |
| `glob`        | string                                                                  | relative glob, e.g. `*.json`                                                                                                                    |
| `editable`    | bool, default `true`                                                    | set `false` for files Ahabby must never write                                                                                                   |

## `[skills]` (optional, single)

| key           | type                                                 | notes                                                                                                       |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `format`      | `skillMd` \| `directory` \| `markdownFile`, required | `skillMd` = `<dir>/**/SKILL.md` with YAML frontmatter                                                       |
| `path`        | per-OS map, required                                 | directory (`skillMd`, `directory`) or file (`markdownFile`)                                                 |
| `glob`        | string                                               | default `**/SKILL.md` for `skillMd`, `*` for `directory`; braces work (`{skills,skills-cursor}/*/SKILL.md`) |
| `description` | string                                               |                                                                                                             |

## `[mcp]` (optional, single)

| key                  | type                                            | notes                                                                                                                                                      |
| -------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `format`             | `json` \| `jsonc` \| `toml` \| `yaml`, required |                                                                                                                                                            |
| `path`               | per-OS map, required                            | the file holding the servers                                                                                                                               |
| `key_path`           | [string], required                              | path inside the document to the `name -> server` map, e.g. `["mcpServers"]` or `["mcp_servers"]`                                                           |
| `glob`               | string                                          | when the file name varies (`opencode.json*` matches `opencode.json` and `opencode.jsonc`) `path` points at the directory and this glob selects the file(s) |
| `description`        | string                                          |                                                                                                                                                            |
| `shared_with_config` | bool                                            | `true` when the same file also appears in `[[configs]]` (recommended: declare it in both places)                                                           |

Both the map shape (`name -> server`) and the array shape (each entry carrying its own `name`, as Continue
uses) are recognised. An entry can only be _removed_ when it is addressable by key, i.e. in the map shape.

Both collection shapes are recognised without extra code: a map (`name -> server`) and an array where each
entry carries its own `name` (Continue). An entry can only be _removed_ when it is addressable by key, i.e. in
the map shape.

Server entry shapes recognised without extra code: `command` as string + `args`, `command` as
array, `env` / `environment`, `url` (+ `type` = `sse` / `http` / `remote` / `streamable-http`),
`headers`. Secret-looking keys (`*_TOKEN`, `*_KEY`, `Authorization`, …) are masked.

## `[[other]]` (optional, repeatable)

Non-config resources: instructions, slash commands, sub-agents, hooks, rules, prompts.

| key           | type                                                                                                 | notes                                                        |
| ------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `id`          | string, required                                                                                     | unique inside the manifest                                   |
| `kind`        | `instructions` \| `commands` \| `subagents` \| `hooks` \| `rules` \| `prompts` \| `memory`, required |                                                              |
| `label`       | string, required                                                                                     |                                                              |
| `path`        | per-OS map, required                                                                                 | file or directory                                            |
| `format`      | same as `configs.format`, default `markdown`                                                         |                                                              |
| `glob`        | string                                                                                               | when the path is a directory, one resource per matching file |
| `scope`       | scope, default `global`                                                                              |                                                              |
| `description` | string                                                                                               |                                                              |

## `[[methods]]` (optional, repeatable)

Install / update / uninstall recipes. **The UI can only ever run a command that exists here.**

| key                 | type                                                                                                                                        | notes                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | string, required                                                                                                                            | stable, returned by the UI when the user picks this method (`npm`, `brew`, …)                                                                               |
| `manager`           | `npm` \| `pnpm` \| `yarn` \| `bun` \| `brew` \| `winget` \| `scoop` \| `pipx` \| `pip` \| `cargo` \| `go` \| `script` \| `manual`, required |                                                                                                                                                             |
| `os`                | [`windows`,`macos`,`linux`]                                                                                                                 | empty/omitted = every OS                                                                                                                                    |
| `command`           | string, required                                                                                                                            | must start with the manager's own binary; `script` methods must start with an allow-listed installer (`curl`, `wget`, `sh`, `powershell`, `irm`, `brew`, …) |
| `update_command`    | string                                                                                                                                      | defaults to `command`                                                                                                                                       |
| `uninstall_command` | string                                                                                                                                      | optional; without it Ahabby refuses to offer "uninstall"                                                                                                    |
| `docs_url`          | string                                                                                                                                      | shown when nothing can be automated                                                                                                                         |
| `note`              | string                                                                                                                                      | displayed next to the command                                                                                                                               |
| `priority`          | integer, default 0                                                                                                                          | lower runs first                                                                                                                                            |
| `requires`          | [string]                                                                                                                                    | display only, e.g. `["node >= 18"]`                                                                                                                         |

Commands are executed **directly** (program + args, no shell) — except `script` methods, which
run through the platform shell because that is what official installers need. Never use
`$(...)`, backticks or newlines in a command; manifests with them are rejected.

## Complete example

```toml
id = "example-cli"
name = "Example CLI"
description = "An example agent, used as documentation."
website = "https://example.com"
docs = "https://example.com/docs"
icon = "example"
category = "cli"
popular = true
vendor = "Example Inc."
features = [
    "What the agent does best",
    "How it stores skills and MCP servers",
]
github = "example/example-cli"
unverified = []
notes = "All paths confirmed against https://example.com/docs/config on 2026-10-05."

[binaries]
names = ["example", "example-cli"]
version_args = ["--version"]

[[search_paths]]
windows = ["${APPDATA}/npm"]
macos = ["/opt/homebrew/bin"]
linux = ["${HOME}/.local/bin"]

[[configs]]
id = "settings"
label = "Settings"
description = "Main configuration file."
format = "json"
path = { windows = "${USERPROFILE}/.example/settings.json", macos = "${HOME}/.example/settings.json", linux = "${HOME}/.example/settings.json" }

[skills]
format = "skillMd"
path = { windows = "${USERPROFILE}/.example/skills", macos = "${HOME}/.example/skills", linux = "${HOME}/.example/skills" }

[mcp]
format = "json"
key_path = ["mcpServers"]
shared_with_config = true
path = { windows = "${USERPROFILE}/.example/settings.json", macos = "${HOME}/.example/settings.json", linux = "${HOME}/.example/settings.json" }

[[other]]
id = "instructions"
kind = "instructions"
label = "EXAMPLE.md"
format = "markdown"
path = { windows = "${USERPROFILE}/.example/EXAMPLE.md", macos = "${HOME}/.example/EXAMPLE.md", linux = "${HOME}/.example/EXAMPLE.md" }

[[methods]]
id = "npm"
manager = "npm"
command = "npm install -g example-cli"
update_command = "npm install -g example-cli@latest"
priority = 0

[[methods]]
id = "brew"
manager = "brew"
os = ["macos", "linux"]
command = "brew install example-cli"
docs_url = "https://example.com/docs/install"
priority = 1
```

Validate a manifest by running the backend test suite:

```bash
cargo test --manifest-path src-tauri/Cargo.toml catalog::
```
