import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { WindowChrome } from '@/shared/bindings/WindowChrome'

/**
 * The window's own chrome.
 *
 * The window is the backend's — every operation on it is a command, because the webview is given
 * no window permission of its own — and this is the one place the header reads it from. The
 * state is primed by `boot()` before the first render, so a window that has no OS frame draws
 * its header on the very first frame instead of moving every panel down one paint later, and it
 * is kept current by `WindowChromeBridge` from `window://state`.
 */
export function useWindowChrome(): WindowChrome | undefined {
  return useQuery({
    queryKey: queryKeys.windowChrome(),
    queryFn: () => ipc.windowChrome(),
    // The window's own events are the only thing that moves it, and they arrive on the bus.
    staleTime: Infinity,
  }).data
}

/** The four things a window can do to itself, as the header's buttons ask for them. */
export interface WindowControls {
  /** Follow the cursor with the window, as a caption drag does. */
  startDrag: () => void
  minimize: () => void
  /** Maximize a windowed window, restore a maximized one. */
  toggleMaximize: () => void
  /** Close, which is the OS's own close request — the tray setting decides the rest. */
  close: () => void
}

/**
 * Builds the header's controls.
 *
 * A failed call is not worth a toast: the window is already doing what it does, and the buttons
 * are the only place the failure would be visible. A maximize is the exception — its answer is
 * written straight into the cache rather than waited for over the event bus, because an icon
 * that lags the click is the one thing a caption button cannot do.
 */
export function useWindowControls(): WindowControls {
  const queryClient = useQueryClient()

  const maximize = useMutation({
    mutationFn: () => ipc.windowToggleMaximize(),
    onSuccess: (chrome) => queryClient.setQueryData(queryKeys.windowChrome(), chrome),
  })

  const ignore = (action: () => Promise<unknown>) => {
    void action().catch(() => undefined)
  }

  return {
    startDrag: () => ignore(ipc.windowStartDrag),
    minimize: () => ignore(ipc.windowMinimize),
    toggleMaximize: () => maximize.mutate(),
    close: () => ignore(ipc.windowClose),
  }
}
