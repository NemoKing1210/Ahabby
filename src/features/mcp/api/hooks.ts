import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

export function useDeleteMcpServer() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; serverId: string }) =>
      ipc.deleteMcpServer(vars.agentId, vars.serverId, true),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}

/**
 * Reads exactly one secret value the user asked to see. Values are masked by the backend on
 * purpose, so this is the only path that can bring a token into the webview.
 */
export function useRevealSecret() {
  return useMutation({
    mutationFn: (vars: { agentId: string; serverId: string; key: string }) =>
      ipc.revealMcpSecret(vars.agentId, vars.serverId, vars.key),
  })
}
