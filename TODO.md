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

### T-002 — "Кратко о настройках" → "Быстрые настройки", and edit the values right there

- **Status:** `[ ]` todo
- **Depends on:** nothing
- **Where:** `src/features/agents/components/AgentFactsCard.tsx`,
  `src/shared/i18n/locales/{en,ru}.json` (`agent.facts`), `src-tauri/src/adapters/doc_edit.rs`,
  `src-tauri/src/services/config_editor.rs`, `src-tauri/src/commands/`, `src/shared/api/ipc.ts`,
  `src/features/agents/api/`

**Context.** The block is the "Quick info" card of `/agents/:agentId` — `AgentFactsCard`, headed by
`agent.facts.title`, which reads `Кратко о настройках` in Russian and `Quick info` in English. Its
rows are `ConfigFact { id, kind, key, value, masked, configId, configLabel, configPath }` — the
model, provider, endpoint, proxy and credentials `adapters::config_facts::extract` lifts out of the
agent's own config files during the scan — grouped by the file they came from. Today the card is
read-only: copy, open a link, reveal a masked value. Changing any of them means opening the config
in the editor and finding the key by hand.

**Deliverable, part 1 — the name.** `agent.facts.title` becomes `Быстрые настройки` (ru) and
`Quick settings` (en), and `agent.facts.hint` says in both languages that the values can be changed
here — not only read. Both locales change in the same commit (`shared/i18n/locales.test.ts` enforces
parity); the card is the only consumer of the key.

**Deliverable, part 2 — editing in place.** Each row gets an edit affordance that turns the value
into an input where it stands: `Enter` writes, `Esc` cancels, no dialog and no navigation — that is
the "quick" half of the ask. What it is not is a second write path:

- The write is done in Rust, never by the frontend re-serializing a document. New
  `doc_edit::set_value(format, text, dotted_key, value)` — byte-preserving for `Json`/`Jsonc`
  (comments and trailing commas survive), `Toml`, `Yaml`, and the one matching line for
  `ConfigFormat::Text` (a dotenv file) — beside the existing `move_entry`/`insert_entry`.
- A new command pair mirrors the existing one: `preview_config_fact(agentId, path, key, value,
baseSha256) → DiffPreview` (with the patched text) and `save_config_fact(…) →
MutationResult<SaveResult>`. Both resolve the path through the same security seam
  (`AppState::document_target`), both refuse a file whose manifest declares `editable = false`, both
  keep the `base_sha256` stale guard, and the write goes through `platform::write_atomic` (backup
  first), exactly like `preview_config_save` / `save_config`.
- The card decides whether a row is editable from the config the fact came from —
  `agent.configs[]` matched by `configId`, its `editable` and `exists` — so a read-only or missing
  file shows no affordance while the backend refuses the call anyway.
- A secret row stays masked: the editor types the **new** value and never reveals the old one; an
  empty value is refused before any IPC call.
- The write is one value, so the result is reported as such: the toast names the file and the key
  and offers the diff, the returned report replaces the cached one so the row repaints from the
  scan, and a full edit stays one click away (the group header opens the config in
  `features/editor`'s `DocumentEditorDialog`).

**Acceptance.**

- [ ] `agent.facts.title` is exactly `Быстрые настройки` (ru) and `Quick settings` (en), the hint in
      both says the values can be edited in place, and `src/shared/i18n/locales.test.ts` passes.
- [ ] `doc_edit::set_value` is unit-tested per format on a fixture: a JSONC document keeps every
      comment, key order and trailing comma with one scalar changed; TOML and YAML change only the
      target scalar, quoting and indentation of the rest untouched; a dotenv file replaces its line
      and nothing else.
- [ ] The type of the value node is preserved: a string stays a string (`"m"`), a number stays a
      number (`1`, not `"1"`), a boolean stays a boolean — tested, since the input is always text.
- [ ] A key that is no longer in the document returns an error instead of being inserted behind the
      user's back (the fact came from a scan; a vanished key means the file moved under the app).
- [ ] Round trip on an agent page, for a JSONC config **and** a TOML one: pencil → type → `Enter` →
      the file differs by exactly the one line, a backup exists, and the row shows the new value
      after the rescan.
- [ ] Refusals are proven, not assumed: a config with `editable = false` offers no affordance and a
      call that skips the UI is refused with `command_not_allowed`; a file edited outside Ahabby
      fails the stale check and writes nothing; an empty value never reaches the backend.
- [ ] A masked credential can be replaced without being revealed first, and its row is masked again
      after the rescan.
- [ ] The card's own test file exists (it has none today): the heading it renders, the affordance
      absent on a read-only config, and the edit request it sends for a plain value.

**Verification.**

```bash
npm test -- src/features/agents            # the card's new test
cargo test --manifest-path src-tauri/Cargo.toml doc_edit:: config_editor::
```

Then the desktop smoke: open an installed agent with a JSONC config (Cursor or opencode) and one
with a TOML config → edit the model in the card → confirm the diff the toast offers is one line →
open the file in the editor and see the comment above it still there → restart and see the new value
in the card.

**Ships as two commits**, because they are two changes with two bumps:
`style(agents): rename the settings summary to quick settings` (patch) and
`feat(agents): edit a config fact in place` (minor), each with its own `CHANGELOG.md` bullet.

**Decision to record in the Done entry:** whether the inline write should be confirmed in the
existing diff dialog for a secret row only (a credential is the one value a mistyped write costs
real time), or whether the toast is confirmation enough for every kind — the row is one line and the
backup is one click away either way.

## Blocked

Nothing blocked.

## Done

### T-001 — Add the `anti-slop` collection to the Hub

**Done** 2026-10-08 · `a9f9234`. The core `antislop.md` stays in the repository: a `githubSkills`
entry owns only the directory holding its `SKILL.md`, so the root file ships with no entry. Rather
than file an upstream issue, the source `description` says so outright ("the core `antislop.md`
stays in the repository; open it there"), and each skill's own text already points there.
