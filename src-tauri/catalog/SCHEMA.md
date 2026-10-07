# Agent manifest schema

A manifest is a TOML file in `src-tauri/catalog/builtin/` (shipped with Ahabby) or in
`<app config dir>/catalog/` (user overrides, same id wins).

A second, non-agent manifest lives in `src-tauri/catalog/shared.toml`: it describes the
**shared surface** — skills, MCP servers and documents in agent-neutral locations
(`~/.agents/skills`, `~/.agents/mcp.json`, `~/.agents/AGENTS.md`) that belong to no single
agent. It uses the schema below, but lives outside `builtin/` so it is never scanned as an
agent, and its id (`shared`) is reserved: a user manifest claiming it is reported as a
catalog error. Shared resources are shown in the Library under the "Shared" owner and can be
opened, edited and deleted through the same path checks as an agent's own files.

A third one, `src-tauri/catalog/project.toml`, describes the **project surface**: the same
kinds of resources, but as the user's own projects keep them. Every path in it is _relative_
and is resolved against the project being read (`.claude/skills`, `.mcp.json`, `AGENTS.md`, …),
which is how one declarative file covers every project on the machine. Its id (`project`) is
reserved the same way, and the relative locations it declares are also what Ahabby uses to
recognise a folder as a project.

**Adding support for a new agent means adding one file here — no Rust, no TypeScript.** A new
project-level location (a tool that keeps its skills somewhere else) is one entry in
`catalog/project.toml`.

Field names may be written in `snake_case` (idiomatic TOML, recommended) or `camelCase`;
both are accepted. Unknown fields are rejected on purpose, so typos fail loudly in the test
suite instead of silently disabling half of an agent's functionality.

Every path must carry a `# SOURCE:` comment pointing at the official documentation page it
was taken from. Paths that could not be confirmed must be listed in `unverified` — Ahabby
shows them to the user with a "needs verification" badge instead of pretending to be sure.

## Top level

| key           | type             | notes                                                                                                                                           |
| ------------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string, required | `[a-z0-9_-]+`, stable, used as the primary key                                                                                                  |
| `name`        | string, required | display name                                                                                                                                    |
| `description` | string, required | one sentence for the card                                                                                                                       |
| `tagline`     | string           | short marketing-free summary                                                                                                                    |
| `website`     | string           | product page                                                                                                                                    |
| `docs`        | string           | documentation root                                                                                                                              |
| `icon`        | string           | brand key: `src/shared/ui/agentBrands.ts` maps it to the brand's tile colours and logo for `AgentIcon.tsx`; unmapped keys fall back to initials |
| `category`    | string           | free-form grouping (`cli`, `editor`, `extension`)                                                                                               |
| `popular`     | bool             | show in "available to install" even on a bare machine                                                                                           |
| `vendor`      | string           | who publishes the agent, shown on its own page                                                                                                  |
| `features`    | [string]         | short highlights, shown on the agent's own page                                                                                                 |
| `github`      | string           | `owner/repo`, used for the release check and the repository link                                                                                |
| `adapter`     | string           | `manifest` (default) or `claude`; see `ARCHITECTURE.md`                                                                                         |
| `unverified`  | [string]         | dotted paths that still need a docs check, e.g. `["skills.path"]`                                                                               |
| `notes`       | string           | provenance notes shown in the UI                                                                                                                |

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

## `[[skills]]` (optional, repeatable)

| key           | type                                                 | notes                                                                                                       |
| ------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `format`      | `skillMd` \| `directory` \| `markdownFile`, required | `skillMd` = `<dir>/**/SKILL.md` with YAML frontmatter                                                       |
| `path`        | per-OS map, required                                 | directory (`skillMd`, `directory`) or file (`markdownFile`)                                                 |
| `glob`        | string                                               | default `**/SKILL.md` for `skillMd`, `*` for `directory`; braces work (`{skills,skills-cursor}/*/SKILL.md`) |
| `description` | string                                               |                                                                                                             |

Repeatable because a tool can keep skills in more than one directory (Claude Code reads both
`.claude/skills` and the cross-tool `.agents/skills`; `catalog/project.toml` declares three). A new skill is
written into the **first** entry that can hold one. The older single-table form (`[skills]`) still parses and
is simply one entry.

## `[[mcp]]` (optional, repeatable)

| key                  | type                                            | notes                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `format`             | `json` \| `jsonc` \| `toml` \| `yaml`, required |                                                                                                                                                                                                                                                                                                                                                                                |
| `path`               | per-OS map, required                            | the file holding the servers                                                                                                                                                                                                                                                                                                                                                   |
| `key_path`           | [string], required                              | path inside the document to the `name -> server` map, e.g. `["mcpServers"]` or `["mcp_servers"]`                                                                                                                                                                                                                                                                               |
| `entry_shape`        | `command` \| `local` \| `vscode` \| `list`      | shape of one entry when Ahabby writes a new server: `command` (default) = `{command, args, env}` / `{type: http, url, headers}`, `local` = opencode's `{type: local, command: [...], environment}` / `{type: remote, url, headers}`, `vscode` = the shared keys plus the `type` VS Code validates (`stdio` / `http`), `list` = the servers live in a list Ahabby can only read |
| `glob`               | string                                          | when the file name varies (`opencode.json*` matches `opencode.json` and `opencode.jsonc`) `path` points at the directory and this glob selects the file(s)                                                                                                                                                                                                                     |
| `description`        | string                                          |                                                                                                                                                                                                                                                                                                                                                                                |
| `shared_with_config` | bool                                            | `true` when the same file also appears in `[[configs]]` (recommended: declare it in both places — that is what makes the file addressable in the editor)                                                                                                                                                                                                                       |

Repeatable for the same reason as `[[skills]]`: one project keeps its servers in `.mcp.json` for one tool and
in `.vscode/mcp.json` for another, and every source is read, switchable and removable. A new server is written
into the **first** entry, in the shape that entry declares. The older single-table form (`[mcp]`) still parses.

Both the map shape (`name -> server`) and the array shape (each entry carrying its own `name`, as Continue
uses) are recognised. An entry can only be _removed_ when it is addressable by key, i.e. in the map shape.
The same holds for _adding_ one: a server can only be created in a map container, and an agent whose servers
live in a list declares `entry_shape = "list"` and stays read-only.

Both collection shapes are recognised without extra code: a map (`name -> server`) and an array where each
entry carries its own `name` (Continue). An entry can only be _removed_ when it is addressable by key, i.e. in
the map shape.

Server entry shapes recognised without extra code: `command` as string + `args`, `command` as
array, `env` / `environment`, `url` (+ `type` = `sse` / `http` / `remote` / `streamable-http`),
`headers`. Secret-looking keys (`*_TOKEN`, `*_KEY`, `Authorization`, …) are masked.

### Switching a server off

Ahabby can switch a server off without deleting it: the entry is moved into a sibling object
whose name is the container plus `Disabled` (`mcpServers` → `mcpServersDisabled`,
`mcp.servers` → `mcp.serversDisabled`, `mcp_servers` → `mcp_serversDisabled`), where no agent
looks for servers, and switching it on moves it back. The rest of the file is preserved —
byte for byte for JSON and JSONC (comments included) and through the format's own editor for
TOML and YAML — and a timestamped backup is taken first. A container left empty is not
removed, so comments inside it are never lost. Only entries addressable by key (the map shape)
can be switched, exactly like removal; the scan reports the rest as `enabled: false` so the UI
can offer the switch.

### Switching a skill off

A `SkillFormat` is switched off by renaming its entry file to `<name>.disabled`
(`SKILL.md` → `SKILL.md.disabled`) — every agent looks a skill up by the exact file name, so
the skill disappears from its view while the file itself is untouched; renaming it back is the
whole "switch on" operation. A switched-off skill is still scanned, with `enabled: false`, and
`entry_path` pointing at the renamed file so it can still be read and edited. Only skills
Ahabby could also delete are switchable.

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

## `[[extensions]]` (optional, repeatable)

Extensions an agent loads: small modules that add tools, commands or behaviour. This surface is
**opt-in** — an agent with no extension mechanism declares none, and its page says so instead of
showing an empty list. Today one `format` exists, `pi`, read from Pi's own layout.

| key           | type                 | notes                                                                                                                                          |
| ------------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | string, required     | unique inside the manifest                                                                                                                     |
| `format`      | `pi`, required       | how the agent stores and loads extensions                                                                                                      |
| `path`        | per-OS map, required | the extensions directory the agent discovers modules in                                                                                        |
| `settings`    | per-OS map           | the JSON document whose `packages` list declares installed packages and whose `extensions` list carries the on/off overrides. Required by `pi` |
| `builtins`    | [string]             | names of the extensions the agent ships itself; listed read-only                                                                               |
| `description` | string               |                                                                                                                                                |

What the `pi` reader reports: the packages the settings declare (`npm:`, `git:` and local paths,
with the version, description, author and links read from the installed `package.json` and the
resource counts of its `pi` manifest), the modules found in the extensions directory (a `.ts`/`.js`
file, or a directory with an `index.ts`/`index.js` or a `pi.extensions` manifest), and the
built-ins. A module is switched off by the same convention skills use — its entry file is renamed
to `<name>.disabled` — and a package is removed or updated through the agent's own CLI, with the
command resolved inside the backend. The tab opens on the packages: the modules of the directory
and the built-ins are listed behind a type filter (with their counts), never hidden for good.
Paths are read from the extensions directory and the settings
document only; the directory's own `.gitignore`/`.ignore` files are not applied, so a module Pi
skips at load time is still listed (and manageable) here.

## `[[methods]]` (optional, repeatable)

Install / update / uninstall recipes. **The UI can only ever run a command that exists here.**

| key                 | type                                                                                                                                        | notes                                                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                | string, required                                                                                                                            | stable, returned by the UI when the user picks this method (`npm`, `brew`, …)                                                                               |
| `manager`           | `npm` \| `pnpm` \| `yarn` \| `bun` \| `brew` \| `winget` \| `scoop` \| `pipx` \| `pip` \| `cargo` \| `go` \| `script` \| `manual`, required |                                                                                                                                                             |
| `os`                | [`windows`,`macos`,`linux`]                                                                                                                 | empty/omitted = every OS                                                                                                                                    |
| `command`           | string, required                                                                                                                            | must start with the manager's own binary; `script` methods must start with an allow-listed installer (`curl`, `wget`, `sh`, `powershell`, `irm`, `brew`, …) |
| `update_command`    | string                                                                                                                                      | defaults to `command`                                                                                                                                       |
| `uninstall_command` | string                                                                                                                                      | optional; must pass the same manager whitelist as `command`. Without one Ahabby refuses to offer "uninstall", and the agent can only be hidden              |
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
