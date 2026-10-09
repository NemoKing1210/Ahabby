import { useQueries } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { HubEntry } from '@/shared/bindings/HubEntry'

import type { RecommendationPick } from './catalog'

export interface ResolvedRecommendation {
  pick: RecommendationPick
  entry: HubEntry | null
  pending: boolean
  error: boolean
}

/**
 * Resolve a role's curated picks into live Hub entries (installed state included).
 *
 * Each pick is a `getHubEntry` call: the first open of a source still pays for the tarball, then
 * the cache serves every other pick from that collection.
 */
export function useRecommendations(picks: RecommendationPick[]): {
  items: ResolvedRecommendation[]
  pending: boolean
  ready: HubEntry[]
  missing: HubEntry[]
} {
  const queries = useQueries({
    queries: picks.map((pick) => ({
      queryKey: queryKeys.hubEntry(pick.entryId),
      queryFn: () => ipc.getHubEntry(pick.entryId, false),
      staleTime: Infinity,
      retry: false,
    })),
  })

  const items: ResolvedRecommendation[] = picks.map((pick, index) => {
    const query = queries[index]
    return {
      pick,
      entry: query?.data?.entry ?? null,
      pending: Boolean(query?.isPending || query?.isFetching),
      error: Boolean(query?.isError),
    }
  })

  const ready = items.map((item) => item.entry).filter((entry): entry is HubEntry => entry !== null)
  const missing = ready.filter((entry) => entry.installable && entry.installed.length === 0)

  return {
    items,
    pending: items.some((item) => item.pending),
    ready,
    missing,
  }
}
