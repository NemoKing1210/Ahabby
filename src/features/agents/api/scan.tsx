/**
 * Scan state for the whole app.
 *
 * The first paint comes from the previous run's report (`cachedAgents`), so a restart shows
 * the real list instead of skeletons. Immediately afterwards this provider starts a
 * background scan and turns its events into per-agent state: which cards are still being
 * inspected (`scanning`) and which ones just received fresh data (`landed`).
 *
 * Events — not the caller — are what the UI follows, so a scan started anywhere (the rescan
 * buttons, the post-install refresh) animates the same way.
 */

import { useQueryClient } from '@tanstack/react-query'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import { onAgentScanned, onScanDone, onScanStart } from '@/shared/api/events'
import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Agent } from '@/shared/bindings/Agent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { toastAppError } from '@/shared/ui/Toast'

/** How long a card keeps its "fresh data just landed" highlight. */
const LANDED_MS = 1100

const EMPTY_IDS: ReadonlySet<string> = new Set()

interface ScanState {
  /** Agents whose card shows the refresh sweep. */
  scanning: ReadonlySet<string>
  /** Agents whose fresh data just arrived. */
  landed: ReadonlySet<string>
  /** How many agents the running scan covers. */
  total: number
}

const IDLE: ScanState = { scanning: EMPTY_IDS, landed: EMPTY_IDS, total: 0 }

export interface ScanRefresh {
  /** A scan is running, no matter what started it. */
  isScanning: boolean
  scanning: ReadonlySet<string>
  landed: ReadonlySet<string>
  /** Finished / covered agents of the running scan. */
  progress: { done: number; total: number }
  /** Ask for a fresh scan; the backend's events drive the UI. */
  rescan: () => void
}

const ScanRefreshContext = createContext<ScanRefresh | null>(null)

export function useScanRefresh(): ScanRefresh {
  const value = useContext(ScanRefreshContext)
  if (!value) {
    throw new Error('useScanRefresh must be used inside <ScanRefreshProvider>')
  }
  return value
}

export function ScanRefreshProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const [state, setState] = useState<ScanState>(IDLE)
  const [running, setRunning] = useState(false)
  const timers = useRef(new Map<string, number>())
  const inFlight = useRef(false)
  const startupChecked = useRef(false)

  /** Replace one agent in the cached report; unknown agents wait for the final report. */
  const patchAgent = useCallback(
    (agent: Agent) => {
      queryClient.setQueryData<ScanReport>(queryKeys.agents(), (previous) => {
        if (!previous) return previous
        const index = previous.agents.findIndex((candidate) => candidate.id === agent.id)
        if (index === -1) return previous
        const agents = previous.agents.slice()
        agents[index] = agent
        return { ...previous, agents }
      })
    },
    [queryClient],
  )

  const flushReport = useCallback(
    (report: ScanReport) => {
      queryClient.setQueryData(queryKeys.agents(), report)
      void queryClient.invalidateQueries({ queryKey: queryKeys.library() })
    },
    [queryClient],
  )

  /** Highlight cards for a moment, then fade the highlight away on its own. */
  const markLanded = useCallback((ids: string[]) => {
    if (ids.length === 0) return
    setState((previous) => ({ ...previous, landed: new Set([...previous.landed, ...ids]) }))
    for (const id of ids) {
      const pending = timers.current.get(id)
      if (pending !== undefined) window.clearTimeout(pending)
      timers.current.set(
        id,
        window.setTimeout(() => {
          timers.current.delete(id)
          setState((previous) => {
            if (!previous.landed.has(id)) return previous
            const landed = new Set(previous.landed)
            landed.delete(id)
            return { ...previous, landed }
          })
        }, LANDED_MS),
      )
    }
  }, [])

  const rescan = useCallback(() => {
    if (inFlight.current) return
    inFlight.current = true
    setRunning(true)
    void ipc
      .rescan()
      .then(flushReport)
      .catch((error) => toastAppError(error))
      .finally(() => {
        inFlight.current = false
        setRunning(false)
      })
  }, [flushReport])

  useEffect(() => {
    const listeners = [
      onScanStart(() => {
        const known =
          queryClient
            .getQueryData<ScanReport>(queryKeys.agents())
            ?.agents.map((agent) => agent.id) ?? []
        setRunning(true)
        setState({ scanning: new Set(known), landed: EMPTY_IDS, total: known.length })
      }),
      onAgentScanned((agent) => {
        patchAgent(agent)
        setState((previous) => {
          if (!previous.scanning.has(agent.id)) return previous
          const scanning = new Set(previous.scanning)
          scanning.delete(agent.id)
          return { ...previous, scanning }
        })
        markLanded([agent.id])
      }),
      onScanDone((report) => {
        flushReport(report)
        setRunning(false)
        setState(IDLE)
      }),
    ]

    // The events are the polish, not the contract: when the bridge cannot be attached the
    // command results still keep the cache correct.
    void Promise.all(listeners).catch(() => undefined)
    return () => {
      void Promise.all(listeners)
        .then((unlisten) => {
          for (const off of unlisten) off()
        })
        .catch(() => undefined)
    }
  }, [flushReport, markLanded, patchAgent, queryClient])

  // One background refresh per launch. The cached report is already on screen, so the scan
  // stays invisible until an agent settles; a cold start has just scanned and skips it.
  useEffect(() => {
    if (startupChecked.current) return
    startupChecked.current = true
    void ipc
      .cachedAgents()
      .then((cached) => {
        if (cached) rescan()
      })
      .catch(() => undefined)
  }, [rescan])

  useEffect(
    () => () => {
      for (const pending of timers.current.values()) window.clearTimeout(pending)
      timers.current.clear()
    },
    [],
  )

  const value = useMemo<ScanRefresh>(
    () => ({
      isScanning: running,
      scanning: state.scanning,
      landed: state.landed,
      progress: {
        done: Math.max(0, state.total - state.scanning.size),
        total: state.total,
      },
      rescan,
    }),
    [rescan, running, state],
  )

  return <ScanRefreshContext.Provider value={value}>{children}</ScanRefreshContext.Provider>
}
