# TODO

What this repository has left to build, kept in one place. One item per unit of work, each one
small enough to land as a single commit and precise enough that someone else can pick it up.

## How this file works

- **`T-NNN` ids are permanent.** They are written once, never renumbered, never reused — even after
  an item is done, so a commit message or a review comment can point at one.
- **Status** is one of `todo`, `doing`, `blocked`, `done`. At most one item is `doing` at a time;
  an item that cannot move carries the reason under it, and when the blocker clears it goes back to
  `todo`.
- **The checkboxes under Acceptance are the definition of done.** An item is `done` only when every
  box is ticked, moved to [Done](#done) with the date and the commit that closed it. Nothing is
  "done except …" — an unfinished box keeps the item open.
- **An item ships like any other change.** Follow `AGENTS.md`: Conventional Commit, a SemVer bump
  and a `CHANGELOG.md` entry in the _same_ commit when the change is user-visible, and the
  `npm run format && npm run lint && npm run typecheck && npm test` + `cargo fmt/clippy/test` pass
  the change itself needs before it is pushed.
- **Verification is evidence, not intention.** Every item names the command or the screen that
  proves it; `cargo test` alone does not prove a Hub source reads the live collection.
- **Delete what is stale.** A `Done` item keeps only the date, the commit and the decision worth
  remembering; a superseded item is removed rather than left to rot.

Statuses: `[ ]` todo · `[~]` doing · `[!]` blocked · `[x]` done.

## In progress

Nothing in flight.

## Backlog

## Blocked

Nothing blocked.

## Done

### T-001 — Add the `anti-slop` collection to the Hub

**Done** 2026-10-08 · `a9f9234`. The core `antislop.md` stays in the repository: a `githubSkills`
entry owns only the directory holding its `SKILL.md`, so the root file ships with no entry. Rather
than file an upstream issue, the source `description` says so outright ("the core `antislop.md`
stays in the repository; open it there"), and each skill's own text already points there.

### T-002 — "Кратко о настройках" → "Быстрые настройки", and edit the values right there

**Done** 2026-10-08 · `574904d`, rename `5674b99`. The inline write is confirmed by the toast for
every kind, without a dialog: a value is one line, the toast names the file and the key, the diff it
offers is the very preview the write was checked against, the report it returns repaints the row
from the scan, and the timestamped backup is one click away — so a credential costs no more ceremony
than a model name. The patch is made from the file on disk in Rust (`doc_edit::set_value` behind
`preview_config_fact` / `save_config_fact`), so JSONC comments, key order, a TOML trailing comment
and the value's own type all survive; a config that is read-only or missing shows no pencil, and a
key the document no longer holds is a `not_found` refusal, never an insert.
