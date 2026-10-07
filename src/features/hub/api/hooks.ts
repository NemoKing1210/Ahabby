import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { HubInstallRequest } from '@/shared/bindings/HubInstallRequest'

/**
 * Installs one hub entry for the owner the user picked — the shared surface, an installed agent,
 * or one of their projects.
 *
 * The backend does the writing through the same adapter the manual "create skill" / "add server"
 * forms use, and answers with the whole fresh report, so the new resource is on screen in the
 * Library as soon as the write lands.
 */
export function useInstallHubResource() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (request: HubInstallRequest) => ipc.installHubResource(request),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

/**
 * Re-reads one entry from the collection it comes from, ignoring the answer already cached.
 *
 * It is what picks up a version the publisher has just moved, and what makes the preview honest
 * again after the collection changed; the fresh answer replaces the cached detail, so every dialog
 * showing that entry repaints.
 */
export function useRefreshHubEntry() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (entryId: string) => ipc.getHubEntry(entryId, true),
    onSuccess: (detail) => client.setQueryData(queryKeys.hubEntry(detail.entry.id), detail),
  })
}
