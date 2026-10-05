import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { useEffect, useState, type ReactNode } from 'react'

import { ipc } from '@/shared/api/ipc'
import { onJobDone, onJobOutput } from '@/shared/api/events'
import { queryKeys } from '@/shared/api/keys'
import { Toaster } from '@/shared/ui/Toast'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { useJobStore } from '@/features/install/store'

function createQueryClient() {
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

/**
 * Providers only.
 *
 * Language and theme are applied in `main.tsx` *before* React mounts (they are read from
 * the backend once), so the first frame is already correct and no component has to sync
 * them afterwards — later changes go through `useSaveSettings`.
 */
export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient)

  return (
    <QueryClientProvider client={queryClient}>
      {/* `reducedMotion="user"` drops transform and layout animation for users who asked
          the OS for less motion; opacity fades survive, which is what the CSS side does too. */}
      <MotionConfig reducedMotion="user">
        <TooltipProvider delayDuration={250}>
          <JobEventBridge />
          {children}
        </TooltipProvider>
        <Toaster />
      </MotionConfig>
    </QueryClientProvider>
  )
}
