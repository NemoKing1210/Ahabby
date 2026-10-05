import type { AgentRef } from '@/shared/bindings/AgentRef'

/**
 * Id of the synthetic owner the backend gives resources discovered in agent-neutral
 * locations (`~/.agents/skills`, `~/.agents/mcp.json`, `~/.agents/AGENTS.md`). Mirror of
 * `SHARED_OWNER_ID` in `src-tauri/src/domain/shared.rs` — the two must stay in sync, like
 * the event names in `shared/api/events.ts` and the secret masking in `shared/lib/mask.ts`.
 */
export const SHARED_OWNER_ID = 'shared'

/** `true` when the owner is the agent-neutral shared surface rather than one real agent. */
export function isSharedOwner(id: string): boolean {
  return id === SHARED_OWNER_ID
}

/** Display name of an owner: the shared surface is translated, a real agent keeps its name. */
export function ownerName(agent: AgentRef, sharedLabel: string): string {
  return isSharedOwner(agent.id) ? sharedLabel : agent.name
}
