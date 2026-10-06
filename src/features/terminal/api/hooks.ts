import { useCallback } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Agent } from '@/shared/bindings/Agent'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useSettings } from '@/features/settings/api/hooks'

import { useTerminalStore } from '../store'
import { BUILTIN_TERMINAL_ID } from '../lib/terminal'

/**
 * Grid a session starts with. A terminal cannot know its size before it is mounted, so it starts
 * at the classic 80×24 and resizes itself the moment the tab is on screen.
 */
export const DEFAULT_COLS = 80
export const DEFAULT_ROWS = 24

/** The terminal picker: the built-in terminal plus every terminal installed on this machine. */
export function useTerminals() {
  return useQuery({
    queryKey: queryKeys.terminals(),
    queryFn: ipc.listTerminals,
    staleTime: 30_000,
  })
}

export function useLaunchTerminal() {
  return useMutation({
    mutationFn: ({ agentId, cwd }: { agentId: string; cwd: string | null }) =>
      ipc.launchTerminal(agentId, cwd, DEFAULT_COLS, DEFAULT_ROWS),
  })
}

export function useOpenInTerminal() {
  return useMutation({
    mutationFn: ({
      agentId,
      terminalId,
      cwd,
    }: {
      agentId: string
      terminalId: string
      cwd: string | null
    }) => ipc.openInTerminal(agentId, terminalId, cwd),
  })
}

/**
 * Close a tab: the tab goes away immediately (the user asked for it) and the backend is told to
 * end the session. A session that is already gone is not worth an error — the goal state is
 * reached either way.
 */
export function useCloseTerminal(): (sessionId: string) => void {
  const close = useTerminalStore((state) => state.close)
  return useCallback(
    (sessionId: string) => {
      close(sessionId)
      void ipc.closeTerminal(sessionId).catch(() => undefined)
    },
    [close],
  )
}

/**
 * The one action every "run in terminal" button performs.
 *
 * Which terminal that is comes from Settings: the built-in one opens a tab in the dock (which
 * comes up on its own, so the agent is on screen wherever the user is), an external one is
 * launched as its own window. Both are asked for with an agent id — the frontend never decides
 * what to execute. `cwd` only says where the agent should start; on a project screen it is
 * the project's root, and everywhere else it is left `null`.
 */
export function useRunAgentInTerminal(): (agent: Agent, cwd?: string | null) => void {
  const { t } = useTranslation()
  const settings = useSettings()
  const catalog = useTerminals()
  const launch = useLaunchTerminal()
  const openExternal = useOpenInTerminal()

  return useCallback(
    (agent: Agent, cwd: string | null = null) => {
      const terminalId = settings.data?.terminal ?? BUILTIN_TERMINAL_ID

      if (terminalId === BUILTIN_TERMINAL_ID) {
        launch.mutate(
          { agentId: agent.id, cwd: cwd ?? null },
          // `open` puts the session in the store, brings its tab to the front and expands the
          // dock — no navigation, the user keeps the screen they were on.
          {
            onSuccess: (session) => useTerminalStore.getState().open(session),
            onError: (error) => toastAppError(error),
          },
        )
        return
      }

      const option = catalog.data?.options.find((entry) => entry.id === terminalId)
      openExternal.mutate(
        { agentId: agent.id, terminalId, cwd: cwd ?? null },
        {
          onSuccess: () => {
            const name = option?.name ?? terminalId
            toast.success(
              option?.capability === 'opensDirectory'
                ? t('terminal.openedDirectory', { terminal: name })
                : t('terminal.openedExternal', { terminal: name }),
            )
          },
          onError: (error) => toastAppError(error),
        },
      )
    },
    [catalog.data, launch, openExternal, settings.data, t],
  )
}
