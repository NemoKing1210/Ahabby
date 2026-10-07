# Hub sources

The Hub is Ahabby's library of skills and MCP servers: a screen that reads large, published
collections and installs one entry of them into the owner you choose — globally for every agent
(`~/.agents`), into one installed agent, or inside one of your projects.

A **hub source** is the declarative description of one such collection. It is data, not code:
adding one is dropping a TOML file into Ahabby's config directory, exactly like adding support for
a new agent is dropping a manifest into the catalog. The sources Ahabby ships with live in
`catalog/hub/*.toml` and are embedded in the binary at compile time; a user source lives in
`<app config>/hub/*.toml` and **a file with the same id replaces the built-in one**.

```
<app config>/hub/my-collection.toml
```

`cargo run --manifest-path src-tauri/Cargo.toml --example hub` reads every source over the network
and prints what it answered — sources, a first page each, one detail of each kind and (with
`--payload`) the files of a skill — without launching the desktop app or writing anything.

## Fields

| Field         | Required               | Meaning                                                                                                                                      |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes                    | Lowercase letters, digits, `-` and `_`. It is the first half of every entry id (`<id>/<entry>`), so it is also what every command addresses. |
| `name`        | yes                    | Shown as the section heading.                                                                                                                |
| `kind`        | yes                    | `mcpRegistry`, `githubSkills` or `index` — see below.                                                                                        |
| `provides`    | yes                    | Which kinds of resource the source offers: `"skill"` and/or `"mcp"`. A source that offers a kind its `kind` cannot produce is refused.       |
| `description` | no                     | One paragraph under the heading.                                                                                                             |
| `homepage`    | no                     | Link on the heading.                                                                                                                         |
| `docs`        | no                     | Link shown inside the install dialog.                                                                                                        |
| `license`     | no                     | Shown on a card when the entry itself does not carry one.                                                                                    |
| `vendor`      | no                     | Who publishes the collection; used as a fallback for an entry's publisher.                                                                   |
| `url`         | `mcpRegistry`, `index` | Base URL of the API, or the URL of the JSON document. Must be `http(s)`.                                                                     |
| `repository`  | `githubSkills`         | `owner/repo`. Both halves must be plain enough to be a URL path segment.                                                                     |
| `git_ref`     | no                     | Branch, tag or commit to read. Defaults to `main`.                                                                                           |
| `path`        | `githubSkills`         | Only skills under this repository directory are offered.                                                                                     |
| `exclude`     | no                     | Repository paths that are never offered — a template skeleton, a vendored copy.                                                              |
| `tags`        | no                     | Tags every entry of this source carries.                                                                                                     |
| `tag_rules`   | no                     | `[[tag_rules]]` blocks (`prefix`, `tags`) for the entries a source addresses under that prefix — see [Tags](#tags).                          |

`deny_unknown_fields` is on, so a typo fails loudly instead of silently disabling half of a source.
A source that does not parse or validate is skipped and reported in the Hub screen (as a warning on
the section itself), never fatal.

## `mcpRegistry`

Reads the [official MCP registry](https://modelcontextprotocol.io/registry/):
`GET <url>/v0/servers?version=latest&limit=&search=&cursor=`. The registry does the searching and
the paging, so a library of thousands of servers is one request per page — and `version=latest` is
sent because a page of the default order would otherwise collapse into one entry once the older
versions of the same server are dropped.

Each record is turned into an entry with a launch recipe:

- a package with a `stdio` transport becomes a local server: `command` is the record's
  `runtimeHint` (or, without one, `npx` for npm, `uvx` for pypi, `docker` for oci, `dnx` for nuget),
  `args` are its `runtimeArguments`, then the package identifier (with `@version` for npm,
  `==version` for pypi), then its `packageArguments`;
- a record with a `remotes` entry (or a package whose transport carries a URL) becomes a remote
  server: its URL and its protocol (`streamable-http`, `sse`, …), which is what the config file
  gets as `type: http`;
- the `environmentVariables` (and a remote's `headers`) become the values the install dialog asks
  for, with `isRequired` and `isSecret` preserved;
- a record with neither a runnable package nor a remote URL is still listed, marked as not
  installable, with the reason the publisher's own record gives.

Ahabby does not verify a publisher's claim: the recipe is pre-filled into the form, shown with its
command line, and the user reviews (and may edit) it before anything is written.

## `githubSkills`

Reads one repository as a single `tar.gz` (`codeload.github.com/<repository>/tar.gz/<git_ref>`)
and offers every directory holding a `SKILL.md` as one entry. One request per repository means the
whole collection is available for browsing, describing and installing without a second fetch —
and without ever touching the GitHub API's rate limits.

- the **shallowest** directory holding a `SKILL.md` owns everything below it, so a skill that ships
  an example skill cannot make the same file part of two entries;
- an entry's name comes from the skill's own frontmatter (`name`), falling back to the directory;
  its description is the frontmatter's `description` (or the body's first paragraph);
- `path` narrows the collection (`path = "skills"`), `exclude` removes specific directories
  (`exclude = ["skills/template"]`);
- the file list — with each file's size and whether it is text, a script or a binary — comes from
  the same archive, so the install dialog can say exactly what will be written.

## `index`

Reads a JSON document published by anyone:

```json
{
  "entries": [
    {
      "id": "pdf",
      "kind": "skill",
      "name": "PDF toolkit",
      "description": "Read and fill PDF forms.",
      "version": "1.0.0",
      "vendor": "Anthropic",
      "homepage": "https://example.com/pdf",
      "repository": "https://github.com/anthropics/skills",
      "license": "MIT",
      "tags": ["documents"],
      "skill": { "repository": "anthropics/skills", "ref": "main", "path": "skills/pdf" }
    },
    {
      "id": "github",
      "kind": "mcp",
      "name": "GitHub",
      "mcp": {
        "command": "npx",
        "args": ["-y", "@modelcontextprotocol/server-github"],
        "env": [
          {
            "key": "GITHUB_TOKEN",
            "description": "A personal access token",
            "required": true,
            "secret": true
          }
        ]
      }
    },
    {
      "id": "linear",
      "kind": "mcp",
      "name": "Linear",
      "mcp": { "url": "https://mcp.linear.app/mcp", "protocol": "streamable-http" }
    }
  ]
}
```

- `skill` names a place in a repository (`repository`, optional `ref`, `path`); the files are read
  from that repository when the entry is installed, exactly as a `githubSkills` source reads them.
- `mcp` is either a local server (`command`, `args`, `env`) or a remote one (`url`, optional
  `protocol`, `headers`); a variable is `{ key, description?, required?, secret?, default? }`.
- an entry that cannot be installed — no `skill`, an unusable `mcp`, both blocks at once (an entry
  installs one thing), an id that repeats, a name that repeats, a `repository`, `ref` or `path` that
  is not plain — is skipped and the reason is reported under the source's heading: the document is
  the publisher's own file, so the message is what they fix.
- unknown fields are ignored, so a document may carry its own metadata.

## Tags

A tag says what an entry is _for_ — `documents`, `design`, `review` — so a library of hundreds of
entries can be browsed by subject instead of by repository layout. Every entry carries a list of
them: they are shown on its card and in the dialogs, they widen the free-text search, and the Hub
screen offers the ones the loaded sources declare as filters (asking for several keeps an entry
carrying _any_ of them).

Three things put a tag on an entry, in this order:

1. **the entry's own declaration** — an `index` document's `tags`, or a skill's frontmatter
   (`tags` or `keywords`, as a list or one comma-separated line: what the publisher wrote);
2. **what the source declares** — `tags` for every entry of the source, and `[[tag_rules]]` for
   the entries it names by prefix:

   ```toml
   tags = ["development"]

   [[tag_rules]]
   prefix = "skills/pdf"
   tags = ["documents", "pdf"]
   ```

   The `prefix` is compared with the name the _source_ uses for an entry: a skill's repository
   directory (`skills/pdf`), an `index` entry's id, a registry server's name. A rule covers that
   name and everything under it (`skills` covers `skills/pdf`, but not `skills-extra/pdf`), so one
   rule tags a whole directory of skills;

3. **the collection a skill sits in** — `plugins/<group>/skills/<skill>` gives every such skill
   `<group>` as a tag.

Tags are trimmed, deduplicated case-insensitively (the first spelling wins, so a publisher's own
casing survives), and kept to 12 tags of at most 40 characters per entry: a tag list is browsing
metadata, and a source is third-party input. A tag that cannot be used is reported as a warning
next to the source — it never fails the source.

Two things follow from where the tags come from. A `mcpRegistry` entry has no tags of its own (a
registry record declares none), so a tag filter the source does not declare returns an empty
section _without_ a request. And because the registry pages server-side, a tag filter there can
only drop entries from the page it answered, while a GitHub collection and an `index` document are
filtered before the page is cut — so their counts stay exact.

## What the Hub fetches, and what it will not

Everything a source publishes is third-party input:

- **one request per source per page**, with a 25-second timeout and a 64 MiB ceiling per body
  (read while streaming, so an announced length is never trusted);
- a repository is parsed once into memory and reused (a 48 MiB budget per repository, an 8 MiB
  limit per file); a collection that hits a limit is still shown, marked as incomplete;
- an entry is described from the collection it belongs to: a GitHub source has already read the
  whole repository, and an `index` entry's own repository is read when that entry is opened or
  installed (and then kept). Nothing is fetched twice, and details — the file list and the
  instructions themselves — come with the collection rather than from a second pass;
- a URL is built by the URL parser, and a repository/ref/path is validated before it becomes one,
  so nothing a source or an index document says can redirect a request or step outside the
  directory it is joined to;
- answers are cached for ten minutes per source; the Hub screen's Refresh asks again, and so does
  an entry's own "re-read from the collection".

## Installing

The install dialog is the review step. It lists the files a skill would write (naming the ones an
agent may run — `.py`, `.sh`, `.js`, `.ps1`, …) or the exact recipe a server would get, plus the
values the publisher says are required, and only then writes to the owner the user picked.

`install_hub_resource` refuses a request that did not come with `confirm: true`, and the write
itself goes through the same adapter a manual "create skill" / "add server" uses:

- a skill lands in the skills directory the owner's manifest declares (the **first** one, exactly
  like a hand-written skill), written into a fresh directory under `SKILL.md`-last and renamed into
  place — an interrupted install leaves nothing an agent would load, and an existing skill is
  refused rather than merged into;
- an MCP server lands in the MCP config file the owner already reads, in that agent's own entry
  shape, through the format-preserving editor that keeps every other byte of the file.
