import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import type { Driver } from 'driver.js'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'

import {
  useSetSidebarCollapsed,
  useSetTourCompleted,
  useSettings,
} from '@/features/settings/api/hooks'

import { startProductTour } from './runTour'
import { WelcomeTourDialog } from './WelcomeTourDialog'

type TourApi = {
  /** Open the welcome dialog, or restart the spotlight when already past first launch. */
  startTour: () => void
}

const TourContext = createContext<TourApi | null>(null)

export function useTour(): TourApi {
  const api = useContext(TourContext)
  if (!api) throw new Error('useTour must be used inside <TourProvider>')
  return api
}

/** Settings screens may mount outside the shell in tests; the button becomes a no-op there. */
export function useOptionalTour(): TourApi {
  return useContext(TourContext) ?? { startTour: () => undefined }
}

/**
 * Owns the first-launch welcome dialog and the driver.js instance. Mounted in the shell so it
 * shares the hash router and can expand the sidebar before highlighting nav items.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const settings = useSettings()
  const setTourCompleted = useSetTourCompleted()
  const setSidebarCollapsed = useSetSidebarCollapsed()
  const [welcomeOpen, setWelcomeOpen] = useState(false)
  const driverRef = useRef<Driver | null>(null)
  const startedRef = useRef(false)

  // First launch only: once settings land and the tour is unfinished, offer the welcome once
  // per mount (Settings → Show tutorial goes through `startTour` instead).
  useEffect(() => {
    if (!settings.data || settings.data.tourCompleted || startedRef.current) return
    startedRef.current = true
    setWelcomeOpen(true)
  }, [settings.data])

  useEffect(() => {
    return () => {
      driverRef.current?.destroy()
      driverRef.current = null
    }
  }, [])

  const markDone = useCallback(() => {
    driverRef.current = null
    setTourCompleted.mutate(true)
  }, [setTourCompleted])

  const runSpotlight = useCallback(() => {
    if (driverRef.current?.isActive()) {
      driverRef.current.destroy()
      driverRef.current = null
    }
    if (settings.data?.sidebarCollapsed) {
      setSidebarCollapsed.mutate(false)
    }
    // Let the welcome dialog unmount and the rail expand before measuring targets.
    window.setTimeout(() => {
      driverRef.current = startProductTour({
        t: (key) => t(key),
        navigate: (to) => {
          void navigate(to)
        },
        onDone: markDone,
      })
    }, 120)
  }, [markDone, navigate, setSidebarCollapsed, settings.data?.sidebarCollapsed, t])

  const startTour = useCallback(() => {
    setWelcomeOpen(true)
  }, [])

  const onWelcomeStart = useCallback(() => {
    setWelcomeOpen(false)
    runSpotlight()
  }, [runSpotlight])

  const onWelcomeSkip = useCallback(() => {
    setWelcomeOpen(false)
    setTourCompleted.mutate(true)
  }, [setTourCompleted])

  // Settings "Show tutorial" should open the welcome, then Start runs the spotlight. When the
  // welcome is opened from Settings after the tour was already completed, Skip still keeps it
  // completed (mutate true is a no-op on the backend when unchanged).
  const api: TourApi = { startTour }

  return (
    <TourContext.Provider value={api}>
      {children}
      {welcomeOpen ? <WelcomeTourDialog onStart={onWelcomeStart} onSkip={onWelcomeSkip} /> : null}
    </TourContext.Provider>
  )
}
