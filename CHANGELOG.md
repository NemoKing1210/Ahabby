# Changelog

All notable changes to Ahabby are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.15.0] - 2026-10-06

### Added

- Agents can be pinned as favourites: the star on a card (or in its right-click menu) keeps the agent first
  in its list section and adds a shortcut to the sidebar, and the agent page offers the same toggle

## [0.14.0] - 2026-10-06

### Changed

- The Library page is rebuilt around the same cards the agents list uses: every skill, MCP server and other
  resource shows its name, description, path, size and the brand-marked agents it belongs to, with the file
  actions in their own column
- Library groupings are now predictable: by name, where one heading gathers a skill or server shared by
  several agents, or by agent, where each shared resource is listed under every agent that owns it — and the
  group header carries the agent's icon
- Filters moved into one row above the tabs: search, an agent picker that shows how many resources each agent
  contributes, a grouping toggle, and a reset button; the tab counters follow the filters

### Added

- The Library explains itself: a summary of the scanned agents and when the last scan ran, a rescan button
  and the catalog-problem banner the agents list shows, plus per-tab empty states that offer to clear the
  filters
- Skills can be opened in the editor straight from the Library card, like they already could inside an agent

## [0.13.0] - 2026-10-06

### Added

- Ahabby remembers the result of the last scan, so a restart opens straight into the real agent list instead
  of skeletons
- That remembered list is refreshed in the background right away, and every card reports its own progress: a
  light band crosses the top edge of each agent that is still being inspected and fades into a soft highlight
  the moment its fresh data arrives, while the sidebar shows how many agents are left

## [0.12.0] - 2026-10-05

### Changed

- Page headers stay pinned to the top of the scrolling area: the title and its actions remain visible on
  every screen instead of scrolling away, sitting on a blurred backdrop so content passes cleanly beneath

## [0.11.0] - 2026-10-05

### Added

- The file editor has a quick-action bar: undo/redo, revert to the saved version, clear, format
  JSON, find and replace, copy, line wrapping, the diff and the backup list — plus `Ctrl+S` to save
- MCP servers can be opened in the editor from their card, and skills (`SKILL.md`) and
  instructions/commands/hooks/rules files can now be viewed and edited too: any file the scan
  declared is editable, always with a timestamped backup first

### Fixed

- The editor finally follows the app theme: it is no longer painted with CodeMirror's own light
  palette (which made plain text invisible in dark mode), line indentation and gutter spacing are
  even, and searching with `Ctrl+F` opens a styled panel instead of doing nothing

### Changed

- Edits are validated automatically shortly after typing, so the error banner and the Save button
  always describe the text on screen; a file changed by someone else is still refused, not
  overwritten

## [0.10.0] - 2026-10-05

### Added

- The sidebar navigation shows how much is behind each section while it is expanded: the Agents item
  carries the number of installed agents, the Library item the total of skills, MCP servers and other
  resources. The badges are hidden in the collapsed icon rail

## [0.9.0] - 2026-10-05

### Added

- Appearance settings, so the app can be tuned to taste: an accent colour (nine presets or any custom
  `#rrggbb`), an interface size and a text size, plus the interface font (Inter, system or Lora) and the code
  font (JetBrains Mono or the system one). Everything is previewed live on the real interface and restored if
  you leave without saving, and a single button resets accent, sizes and fonts to their defaults
- The Appearance section carries a preview: heading, body text, button, badge and code chip, painted with the
  choices currently in the draft

### Changed

- Type sizes are expressed in rem, so the text-size setting reaches every label, badge, code block, rendered
  markdown and the config editor — not only the token-driven text
- Settings written or edited by hand are sanitized on load and on save: the two size scales are clamped and a
  custom accent that is not a colour falls back to the default preset

## [0.8.0] - 2026-10-05

### Added

- The sidebar can be collapsed to an icon-only rail with a button next to the navigation; collapsed
  items reveal their label on hover, and the scan status and rescan button tuck into icons

### Changed

- Sidebar navigation items are larger — bigger hit area, icon and label — so the rail reads at a
  glance and is easier to click

## [0.7.1] - 2026-10-05

### Changed

- Card lists are tighter and concentric: the cards sit close together, the corners at the exposed ends
  keep the full radius, and a corner facing a neighbouring card is rounded a step smaller
- The agent Overview tab uses the same grouped stack, so its panels sit close with matching corners
- Dropdown options follow the same rule: a menu item is rounded by the content radius minus its padding

## [0.7.0] - 2026-10-05

### Added

- Agent cards have a context menu: right-click a card (or press the keyboard's context-menu key while
  a control on it has focus) for open details, website and docs, copying the binary path, showing it in
  the file manager, install/update — with the version it would install — and removal. Entries whose
  action cannot run are not offered at all
- The app now opens on a splash instead of an empty window: the icon mark, the wordmark and a loading
  bar are painted with the first HTML frame, before the bundle and the stylesheet exist, follow the
  light/dark theme (including a pinned one) and cross-fade into the app once it has rendered

### Changed

- The window no longer answers a right click with the WebView's own menu (Back, Reload, Save as). Text
  entry keeps it, because that is the only clipboard UI available without a paste command
- Dragging across the interface no longer leaves a text selection behind. Code, rendered markdown and
  form fields stay selectable so they can still be copied

## [0.6.2] - 2026-10-05

### Fixed

- Every clickable control now shows a pointer cursor. Buttons (including the tab bar), filter
  chips, disclosure toggles and select options previously kept the operating system's default
  arrow because Tailwind v4 no longer styles native `<button>` elements

## [0.6.1] - 2026-10-05

### Fixed

- The highlight behind the active sidebar item is visible in the dark theme again; the pill and the
  item hover used a surface token that composited to the same shade as the translucent sidebar

## [0.6.0] - 2026-10-05

### Added

- The agents list now has a filter row next to the search box: an install-state scope (all,
  installed, available) and toggleable chips for the properties a card already shows — update
  available, needs verification, warnings, skills and MCP servers. A chip only appears while it
  can still match, and its number is what turning it on would leave, so a stack of filters can
  never quietly end in an empty page; one click on “Clear filters” resets everything
- Agents can be removed from Ahabby with a confirmation dialog. A manifest you dropped into your
  own catalog is deleted — the file is moved to the OS trash, never unlinked — while an agent
  whose manifest ships with Ahabby (or whose user manifest overrides one) is only hidden, because
  deleting the file would bring the builtin back. Hidden agents are listed in Settings, where
  they can be restored, and a removed agent disappears from the list, the counters and the Library

## [0.5.3] - 2026-10-05

### Added

- The update dialog now shows the version you have installed next to the one that would be
  installed, so the effect of the command is visible before it runs. When no newer version was
  found, it says so instead

## [0.5.2] - 2026-10-05

### Changed

- Avatar tiles now use each agent's own brand colour, with the mark drawn in the colour that stays legible
  on it, instead of the earlier neutral tile and per-agent tint. That applies to the agents the icon
  library ships (its own avatar colours) and to the ones it does not — Aider, Amazon Q, Augment, Codebuff,
  Continue, Crush, Factory Droid, Forge, gptme, omp, Open Interpreter, Plandex, ShellGPT, Tabby, Warp and
  Zed — whose colours were taken from the vendor's own site or logo. An icon key with neither entry still
  gets a plain neutral monogram instead of a made-up colour

## [0.5.1] - 2026-10-05

### Changed

- Cancelling a running install or update now asks for confirmation first, so an accidental click can no
  longer leave an agent half-installed

### Fixed

- The backend now refuses `run_install` unless the frontend explicitly confirms it, the same way it
  already refused a skill or MCP server deletion. Installing, updating and uninstalling an agent run a
  command from the manifest, and that command can no longer be executed without the confirmation dialog
  having been shown

## [0.5.0] - 2026-10-05

### Added

- Agent avatars now show the real product logo instead of initials: the cards and the agent's own page
  draw brand marks from `@lobehub/icons` (Claude Code, Codex, Cursor, Windsurf, Cline, GitHub Copilot,
  Gemini CLI, Qwen, OpenHands, Kiro, Goose, Amp, Junie, Kilo Code, OpenCode, OpenClaw, Pi and Hermes).
  Agents without a matching logo keep the deterministic monogram, and the logo follows the manifest's
  `icon` key, so a new agent picks it up by declaring the same key

## [0.4.3] - 2026-10-05

### Added

- Every agent card in the list now shows how many skills, MCP servers, config files and other
  resources that agent has, so the counts are visible without opening the agent's page

## [0.4.2] - 2026-10-05

### Changed

- The native window header is now painted in the theme's own colour instead of the Windows accent and
  the gradient it comes with, so it blends into the app

### Fixed

- Switching the theme no longer snaps back to the previous one: repainting the native header used to
  flip the webview's own `prefers-color-scheme`, and a leftover listener chased the app back to the
  theme it had just left

## [0.4.1] - 2026-10-05

### Removed

- The top bar showing the app name and tagline; the sidebar now starts at the very top of the window

## [0.4.0] - 2026-10-05

### Added

- Motion across the interface, tuned to stay quick and quiet: screens cross-fade as you navigate, the
  sidebar highlight glides between sections, tab underlines slide to the active tab, and card lists
  settle in with a short stagger. The first paint stays still — nothing animates on launch
- Resource and raw-JSON sections now grow open and close smoothly instead of appearing in one step

### Changed

- Dialogs, tooltips, selects and toasts ease in as they appear, and dialogs and toasts also animate out
  again (a toast can still be swiped away)
- Switching between the light and dark theme crossfades the palette instead of flipping in a single frame
- Anyone who asked their system for less motion gets plain fades: slides, layout movement and the
  growing height of collapsible sections are dropped instead of animated

## [0.3.0] - 2026-10-05

### Added

- Proxy settings with three modes: connect directly (the new default — `HTTP_PROXY` / `HTTPS_PROXY` are
  ignored and stripped from install commands), use the system proxy from the environment, or enter one
  custom `http://`/`https://` URL. The choice applies to the "newer version exists" checks and to every
  install, update and uninstall command (npm, pip, cargo, brew and `curl`-based install scripts)

### Changed

- The app shell has a full-width header in the theme colours (application name and tagline), and the
  sidebar no longer carries the logo — it starts straight with the navigation

## [0.2.0] - 2026-10-05

### Added

- 24 new agents, taking the catalog from 10 to 34: Hermes, OpenClaw, Pi, omp, Amp, Kilo Code, Kiro, Goose,
  Crush, Plandex, gptme, ShellGPT, Open Interpreter, Tabby, Forge, Factory Droid, OpenHands, Codebuff,
  JetBrains Junie, Augment Code, Warp, Zed, Windsurf and Amazon Q Developer CLI — each with its config
  files, skills, MCP servers, instructions, other resources and install/update commands
- `binaries.version_extract = "line"` for agents whose build numbers are not semver (Junie, Warp, Zed)

### Changed

- Every new manifest carries `# SOURCE:` comments pointing at the official documentation, and anything the
  docs do not confirm is listed under `unverified` instead of being guessed

## [0.1.1] - 2026-10-05

### Fixed

- Cancelling an install or update now stops the whole process tree on Linux, where the login shell
  forked the installer instead of exec'ing it and only the shell was killed

## [0.1.0] - 2026-10-05

Initial release.

### Added

- Scans the machine for installed AI coding agents (Claude Code, Codex CLI, Gemini CLI, opencode, GitHub
  Copilot CLI, Cursor CLI, Aider, Cline, Continue, Qwen Code) from declarative TOML manifests
- Agent pages with version, install path, install method, and an optional newer-version check
- Config file viewer/editor with validate → diff → timestamped backup → atomic write and stale-file detection
- Skill list with `SKILL.md` frontmatter and rendered body, plus trash-based deletion
- MCP server list with backend-side secret masking and per-value reveal
- Library view aggregating skills, MCP servers, and other resources across agents
- Install and update jobs with streamed output, cancellation, and manifest-only commands
- Settings for language, theme, scan paths, network checks, backup directory, and catalog directory
- English and Russian interface
