import type { AgentRef } from '@/shared/bindings/AgentRef'

/**
 * Id of the synthetic owner the backend gives resources discovered in agent-neutral
 * locations (`~/.agents/skills`, `~/.agents/mcp.json`, `~/.agents/AGENTS.md`). Mirror of
 * `SHARED_OWNER_ID` in `src-tauri/src/domain/shared.rs` — the two must stay in sync, like
 * the event names in `shared/api/events.ts` and the secret masking in `shared/lib/mask.ts`.
 */
export const SHARED_OWNER_ID = 'shared'

/**
 * The shared surface as an owner reference, for pickers that offer "shared" next to the real
 * agents (the creation forms). The name is a placeholder: it is always shown through
 * `library.shared`, translated.
 */
export const SHARED_OWNER: AgentRef = { id: SHARED_OWNER_ID, name: 'Shared', icon: null }

/** `true` when the owner is the agent-neutral shared surface rather than one real agent. */
export function isSharedOwner(id: string): boolean {
  return id === SHARED_OWNER_ID
}

/**
 * Prefix of the synthetic owner the backend gives resources discovered in one of the user's
 * projects (`<skills dir>/<project>`, the project's own config files, ...). Mirror of the
 * project owner id in `src-tauri/src/domain/project.rs` — the two must stay in sync.
 */
export const PROJECT_OWNER_PREFIX = 'project:'

/** `true` when the owner is one of the user's own projects rather than an agent or shared. */
export function isProjectOwner(id: string): boolean {
  return id.startsWith(PROJECT_OWNER_PREFIX)
}

/**
 * A project as an owner reference, for the tabs that take an `AgentRef` and for the creation
 * forms. The name is the project's own directory name; a project has no brand (or icon) of
 * its own, so the icon is always `null` and the tile stays neutral.
 */
export function projectOwner(project: { id: string; name: string }): AgentRef {
  return { id: project.id, name: project.name, icon: null }
}

/** Display name of an owner: the shared surface is translated, a real agent keeps its name. */
export function ownerName(agent: AgentRef, sharedLabel: string): string {
  return isSharedOwner(agent.id) ? sharedLabel : agent.name
}
