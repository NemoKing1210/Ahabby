import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Extension } from '@/shared/bindings/Extension'
import type { ExtensionAction } from '@/shared/bindings/ExtensionAction'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import i18n from '@/shared/i18n'
import { toast } from '@/shared/ui/Toast'

import { useJobStore } from '@/features/install/store'

/** The switch of one extension, flipped. */
function flipped(extension: Extension, extensionId: string, enabled: boolean): Extension {
  return extension.id === extensionId ? { ...extension, enabled } : extension
}

/** The cached report with one extension's switch already flipped, for the optimistic update. */
function reportWithExtension(
  report: ScanReport,
  extensionId: string,
  enabled: boolean,
): ScanReport {
  return {
    ...report,
    agents: report.agents.map((agent) => ({
      ...agent,
      extensions: agent.extensions.map((extension) => flipped(extension, extensionId, enabled)),
    })),
  }
}

/**
 * Deletes a local extension by moving its files to the OS trash.
 *
 * `confirm: true` is sent only after the user went through the confirmation dialog; the backend
 * refuses the call otherwise. A package never reaches this path — it is removed through the
 * agent's own CLI (see [`useRunExtensionAction`]).
 */
export function useDeleteExtension() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; extensionId: string }) =>
      ipc.deleteExtension(vars.agentId, vars.extensionId, true),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
    },
  })
}

/**
 * Switches a local extension off or on: the backend renames its entry file, so the agent stops
 * loading the module and the user can switch it back at any time.
 *
 * The answer carries a fresh scan, which the backend takes by asking every agent for its
 * version — so the switch is moved in the cached report first and put back if the write is
 * refused, instead of looking dead for the length of a scan.
 */
export function useSetExtensionEnabled() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; extensionId: string; enabled: boolean }) =>
      ipc.setExtensionEnabled(vars.agentId, vars.extensionId, vars.enabled),
    onMutate: (vars) => {
      const report = client.getQueryData<ScanReport>(queryKeys.agents())
      if (report) {
        client.setQueryData(
          queryKeys.agents(),
          reportWithExtension(report, vars.extensionId, vars.enabled),
        )
      }
      return { report }
    },
    onError: (_error, _vars, context) => {
      if (context?.report) client.setQueryData(queryKeys.agents(), context.report)
    },
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
    },
  })
}

/** The exact command the agent's CLI would run, resolved by the backend from the last scan. */
export function useExtensionPlan(
  agentId: string,
  extensionId: string | null,
  action: ExtensionAction,
) {
  return useQuery({
    queryKey: queryKeys.extensionPlan(agentId, extensionId ?? '', action),
    queryFn: () => ipc.planExtensionAction(agentId, extensionId ?? '', action),
    enabled: extensionId !== null,
    staleTime: 30_000,
  })
}

export interface RunExtensionActionVars {
  agentId: string
  extensionId: string
  action: ExtensionAction
  /** The action the job runs, as the console labels it (`update` / `uninstall`). */
  jobAction: InstallAction
  displayCommand: string
}

/**
 * Starts the resolved command as a job and puts it in the job console, so output, cancellation
 * and the rescan on `job://done` are the machinery every install already uses.
 */
export function useRunExtensionAction() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: RunExtensionActionVars) =>
      ipc.runExtensionAction(vars.agentId, vars.extensionId, vars.action, true),
    onSuccess: (jobId, vars) => {
      useJobStore.getState().start({
        jobId,
        agentId: vars.agentId,
        action: vars.jobAction,
        command: vars.displayCommand,
      })
      toast.info(i18n.t('toast.installStarted', { command: vars.displayCommand }))
    },
    onSettled: () => {
      void client.invalidateQueries({ queryKey: ['agents'] })
    },
  })
}
