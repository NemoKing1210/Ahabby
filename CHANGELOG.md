# Changelog

All notable changes to Ahabby are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
