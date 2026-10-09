import { useMemo } from 'react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { orderByFavorite } from '@/features/agents/lib/favorites'
import { useProjects } from '@/features/projects/api/queries'
import { SHARED_OWNER, isProjectOwner, isSharedOwner, projectOwner } from '@/shared/lib/owners'

/** Every owner that can hold a synced copy, in the order their groups are shown. */
export interface SyncOwners {
  /**
   * Owner ids: the scan's agents (favourites first), then the agent-neutral shared surface, then
   * the user's projects. An owner the scan does not know — a project that was just forgotten —
   * is absent, and its group is placed at the end.
   */
  order: string[]
  /** Owner id → the reference its group is titled and tiled with. */
  refs: Map<string, AgentRef>
}

/**
 * The owners the cloud library groups by.
 *
 * The same sources as every other owner picker — the scan's agents with the pinned ones first,
 * the reserved shared surface and the user's projects — so a group wears the owner's own brand
 * tile and every surface names the same owner the same way, sharing the one query cache.
 */
export function useSyncOwners(): SyncOwners {
  const agents = useAgents()
  const projects = useProjects()
  const favorites = useFavoriteAgents()

  return useMemo(() => {
    const refs = new Map<string, AgentRef>()
    const order: string[] = []
    const push = (ref: AgentRef) => {
      if (refs.has(ref.id)) return
      refs.set(ref.id, ref)
      order.push(ref.id)
    }

    // Every agent the scan reported, installed or not: a declared config is read either way, so
    // an agent that is not installed can still hold copies worth restoring.
    for (const agent of orderByFavorite(agents.data?.agents ?? [], favorites)) {
      push({ id: agent.id, name: agent.name, icon: agent.icon ?? null })
    }
    push(SHARED_OWNER)
    for (const project of projects.data?.projects ?? []) push(projectOwner(project))
    return { order, refs }
  }, [agents.data, projects.data, favorites])
}

/** Rank of an owner in the group order; an owner the scan does not know sorts last. */
export function ownerRank(order: string[], ownerId: string): number {
  const index = order.indexOf(ownerId)
  return index < 0 ? order.length : index
}

/**
 * The owner kinds the library's sub-tabs cut the list into.
 *
 * `agents` is the catch-all for a real agent: the shared surface and a project are both owners
 * with an id of their own, so anything that is neither is an agent.
 */
export type SyncOwnerFacet = 'all' | 'agents' | 'projects' | 'shared'

/** The sub-tabs, in the order they are shown, with the label each already has elsewhere. */
export const SYNC_OWNER_FACETS: { facet: SyncOwnerFacet; labelKey: string }[] = [
  { facet: 'all', labelKey: 'common.all' },
  { facet: 'agents', labelKey: 'nav.agents' },
  { facet: 'projects', labelKey: 'nav.projects' },
  { facet: 'shared', labelKey: 'library.shared' },
]

/** `true` when an owner belongs on a sub-tab. */
export function ownerFacetMatches(facet: SyncOwnerFacet, ownerId: string): boolean {
  switch (facet) {
    case 'shared':
      return isSharedOwner(ownerId)
    case 'projects':
      return isProjectOwner(ownerId)
    case 'agents':
      return !isSharedOwner(ownerId) && !isProjectOwner(ownerId)
    default:
      return true
  }
}
