import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/**
 * The agent list is the app's single source of truth: the sidebar, the agent page and the
 * library all read from this one query, which is why a rescan updates everything at once.
 */
export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents(),
    queryFn: () => ipc.listAgents(false),
    staleTime: 15_000,
  })
}

export function useAgent(agentId: string | undefined) {
  const query = useAgents()
  const agent = agentId
    ? query.data?.agents.find((candidate) => candidate.id === agentId)
    : undefined
  return {
    agent,
    isLoading: query.isLoading,
    error: query.error,
    isMissing: !query.isLoading && agentId !== undefined && agent === undefined,
    refetch: query.refetch,
  }
}

export function useRescan() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => ipc.rescan(),
    onSuccess: (report) => {
      queryClient.setQueryData(queryKeys.agents(), report)
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

/**
 * Removes an agent from Ahabby and refreshes everything that lists agents. The backend
 * decides whether that means deleting a user manifest or hiding a shipped agent; the
 * returned `data` says which happened.
 */
export function useRemoveAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => ipc.removeAgent(agentId, true),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.agents(), result.report)
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })
}

/** Brings a hidden agent back into the list. */
export function useRestoreAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (agentId: string) => ipc.restoreAgent(agentId),
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.agents(), result.report)
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() })
      void queryClient.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })
}

export function useRevealPath() {
  return useMutation({ mutationFn: (path: string) => ipc.revealPath(path) })
}

export function useOpenUrl() {
  return useMutation({ mutationFn: (url: string) => ipc.openUrl(url) })
}
