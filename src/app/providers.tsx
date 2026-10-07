import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'

import { ipc } from '@/shared/api/ipc'
import { onJobDone, onJobOutput, onTerminalExit, onTerminalOutput } from '@/shared/api/events'
import { queryKeys } from '@/shared/api/keys'
import { Toaster } from '@/shared/ui/Toast'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { ScanRefreshProvider } from '@/features/agents/api/scan'
import { BrowserProvider } from '@/features/browser/context'
import { useJobStore } from '@/features/install/store'
import { reconcileTerminalSessions, writeTerminalOutput } from '@/features/terminal/lib/session'
import { useTerminalStore } from '@/features/terminal/store'

export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Desktop app over IPC: refetching on every window focus is noise.
        refetchOnWindowFocus: false,
        retry: 1,
        staleTime: 5_000,
      },
    },
  })
}

/**
 * Bridges the backend's job events into the store and refreshes the agent list once an
 * install finishes, so a newly installed version shows up without a manual rescan.
 */
function JobEventBridge() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const listeners = [
      onJobOutput((event) => useJobStore.getState().append(event)),
      onJobDone((outcome) => {
        useJobStore.getState().finish(outcome)
        void ipc
          .rescanAfterJob()
          .then(() => {
            void queryClient.invalidateQueries({ queryKey: queryKeys.library() })
            void queryClient.invalidateQueries({ queryKey: queryKeys.agents() })
          })
          .catch(() => undefined)
      }),
    ]

    return () => {
      void Promise.all(listeners).then((unlisten) => {
        for (const off of unlisten) off()
      })
    }
  }, [queryClient])

  return null
}

/** One reconciliation per page load; the tab list is what decides which sessions survive. */
let reconciled = false

/**
 * Bridges the backend's terminal sessions into the tab store.
 *
 * Output has to be routed even for a tab that is not on screen, which is why the subscription
 * lives here and not in a component; the store buffers whatever a terminal that is not mounted
 * yet would have missed.
 */
function TerminalEventBridge() {
  useEffect(() => {
    const listeners = [
      onTerminalOutput(writeTerminalOutput),
      onTerminalExit((exit) =>
        useTerminalStore.getState().finish(exit.sessionId, exit.exitCode ?? null),
      ),
    ]

    // A session outlives the webview in development (an HMR reload restarts the page, not the
    // backend), so sessions no tab can show are closed once, at startup.
    if (!reconciled) {
      reconciled = true
      void reconcileTerminalSessions().catch(() => undefined)
    }

    return () => {
      void Promise.all(listeners).then((unlisten) => {
        for (const off of unlisten) off()
      })
    }
  }, [])

  return null
}

/**
 * Providers only.
 *
 * Language and theme are applied in `main.tsx` *before* React mounts (they are read from
 * the backend once), so the first frame is already correct and no component has to sync
 * them afterwards — later changes go through `useSaveSettings`.
 *
 * `client` is how `boot()` hands over the query cache it already primed with the settings it read:
 * the shell asks for them on its first render, and a cache that starts empty would paint the rail
 * open (and the wrong screen) before the same document arrived a second time over IPC.
 */
export function AppProviders({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient())

  return (
    <QueryClientProvider client={queryClient}>
      {/* `reducedMotion="user"` drops transform and layout animation for users who asked
          the OS for less motion; opacity fades survive, which is what the CSS side does too. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={250}>
          <JobEventBridge />
          <TerminalEventBridge />
          <ScanRefreshProvider>
            {/* Ahabby's own browser sits above every screen: one click listener catches the
                external links anywhere in the app, and the reader is a modal over the shell. */}
            <BrowserProvider>{children}</BrowserProvider>
          </ScanRefreshProvider>
        </TooltipProvider>
        <Toaster />
      </MotionConfig>
    </QueryClientProvider>
  )
}
