import { useQuery } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { ProjectScan } from '@/shared/bindings/ProjectScan'
import type { ScanReport } from '@/shared/bindings/ScanReport'

/**
 * The folders the user added and the projects found inside them.
 *
 * This is the same query as `useAgents` — same key, same cached report — narrowed with
 * `select`, so the Projects screen and the sidebar read one cache entry and a mutation
 * anywhere patches both. A second query would drift the moment one of them rescanned.
 */
export function useProjects() {
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: async () => (await ipc.cachedAgents()) ?? ipc.listAgents(false),
    staleTime: Infinity,
    select: (report: ScanReport): ProjectScan => report.projects,
  })
}
