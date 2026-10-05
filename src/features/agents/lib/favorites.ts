import type { Agent } from '@/shared/bindings/Agent'

/**
 * Favourites first, in the order the user pinned them; everything else keeps the order it
 * arrived in (the scan's). Shared by the agent list and the home page's roster, so the two
 * can never disagree about which agent comes first.
 */
export function orderByFavorite<T extends { id: string }>(items: T[], favoriteIds: string[]): T[] {
  const rank = new Map(favoriteIds.map((id, index) => [id, index]))
  return [...items].sort((left, right) => {
    const leftRank = rank.get(left.id)
    const rightRank = rank.get(right.id)
    if (leftRank === undefined) return rightRank === undefined ? 0 : 1
    if (rightRank === undefined) return -1
    return leftRank - rightRank
  })
}

/** Every agent the scan found installed on this machine, favourites first. */
export function installedAgents(agents: Agent[], favoriteIds: string[]): Agent[] {
  return orderByFavorite(
    agents.filter((agent) => agent.status === 'installed'),
    favoriteIds,
  )
}
