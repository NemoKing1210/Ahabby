import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/**
 * Deletes a skill by moving its directory to the OS trash.
 *
 * `confirm: true` is sent only after the user went through the confirmation dialog; the
 * backend refuses the call otherwise.
 */
export function useDeleteSkill() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; skillId: string }) =>
      ipc.deleteSkill(vars.agentId, vars.skillId, true),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
    },
  })
}
