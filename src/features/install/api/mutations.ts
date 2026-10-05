import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import i18n from '@/shared/i18n'
import { toast } from '@/shared/ui/Toast'
import type { InstallAction } from '@/shared/bindings/InstallAction'

import { useJobStore } from '../store'

/** The exact command that would run, resolved by the backend from the manifest. */
export function useInstallPlan(
  agentId: string | null,
  action: InstallAction,
  methodId?: string | null,
) {
  return useQuery({
    queryKey: queryKeys.installPlan(agentId ?? '', action, methodId ?? null),
    queryFn: () => ipc.planInstall(agentId ?? '', action, methodId),
    enabled: agentId !== null,
    staleTime: 30_000,
  })
}

export interface RunInstallVars {
  agentId: string
  action: InstallAction
  methodId?: string | null
  displayCommand: string
}

/**
 * Starts a job. The command itself never leaves the backend: the frontend only sends the
 * agent id and the method id, and receives a job id plus a stream of output events.
 */
export function useRunInstall() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (vars: RunInstallVars) => ipc.runInstall(vars.agentId, vars.action, vars.methodId),
    onSuccess: (jobId, vars) => {
      useJobStore.getState().start({
        jobId,
        agentId: vars.agentId,
        action: vars.action,
        command: vars.displayCommand,
      })
      toast.info(i18n.t('toast.installStarted', { command: vars.displayCommand }))
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}

export function useCancelJob() {
  return useMutation({ mutationFn: (jobId: string) => ipc.cancelJob(jobId) })
}
