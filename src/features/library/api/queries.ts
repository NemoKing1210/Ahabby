import { useQuery } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/**
 * Aggregated library. The backend builds it from the last scan result, so this query is
 * cheap and stays in sync with the agent list (`useRescan` invalidates both).
 */
export function useLibrary() {
  return useQuery({
    queryKey: queryKeys.library(),
    queryFn: ipc.listLibrary,
    staleTime: 15_000,
  })
}
