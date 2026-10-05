# Changelog

All notable changes to Ahabby are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
