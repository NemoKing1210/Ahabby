import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { RemovalMode } from '@/shared/bindings/RemovalMode'

/**
 * The agent list is the app's single source of truth: the sidebar, the agent page and the
 * library all read from this one query, which is why a rescan updates everything at once.
 */
export function useAgents() {
  return useQuery({
    queryKey: queryKeys.agents(),
    // A restart paints the previous run's report instantly; only a machine that has never
    // scanned falls back to a blocking scan. `ScanRefreshProvider` owns every update after
    // that (per-agent patches, the final report), so this query never re-reads the backend.
    queryFn: async () => (await ipc.cachedAgents()) ?? ipc.listAgents(false),
    staleTime: Infinity,
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

/**
 * Removes an agent from Ahabby and refreshes everything that lists agents.
 *
 * The backend does exactly what `mode` says: hiding always works, deleting moves the
 * agent's user-catalog manifest to the OS trash (and is refused for a shipped manifest).
 * Real removal from the machine is a separate uninstall job (`useRunInstall`).
 */
export function useRemoveAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ agentId, mode }: { agentId: string; mode: RemovalMode }) =>
      ipc.removeAgent(agentId, mode, true),
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

/**
 * Reads exactly one credential the user asked to see. Quick info only ever receives masked
 * values, so this is the single path that can bring the real text into the webview.
 */
export function useRevealConfigFact() {
  return useMutation({
    mutationFn: ({ agentId, path, key }: { agentId: string; path: string; key: string }) =>
      ipc.revealConfigFact(agentId, path, key),
  })
}

/**
 * Ids the user pinned as favourites, in the order they were added. Favourites live in
 * settings, so the sidebar, the agents list and the Settings page share one cache entry.
 *
 * Falls back to a module-level empty array so the reference stays stable for `useMemo`.
 */
const NO_FAVORITES: string[] = []

export function useFavoriteAgents(): string[] {
  const query = useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ipc.getSettings,
    staleTime: Infinity,
  })
  return query.data?.favoriteAgents ?? NO_FAVORITES
}

/** Pins or unpins one agent; the backend answers with the whole settings document. */
export function useToggleFavoriteAgent() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ agentId, favorite }: { agentId: string; favorite: boolean }) =>
      ipc.setAgentFavorite(agentId, favorite),
    onSuccess: (settings) => queryClient.setQueryData(queryKeys.settings(), settings),
  })
}
