import { QueryClient, useQuery } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { JobOutcome } from '@/shared/bindings/JobOutcome'
import type { JobOutputEvent } from '@/shared/bindings/JobOutputEvent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { SyncEvent } from '@/shared/bindings/SyncEvent'
import type { TerminalExit } from '@/shared/bindings/TerminalExit'
import type { TerminalOutput } from '@/shared/bindings/TerminalOutput'
import type { TerminalSession } from '@/shared/bindings/TerminalSession'
import type { WindowChrome } from '@/shared/bindings/WindowChrome'
import { initI18n } from '@/shared/i18n'

import { useJobStore } from '@/features/install/store'
import { registerTerminal, unregisterTerminal } from '@/features/terminal/lib/session'
import { useTerminalStore } from '@/features/terminal/store'

import { AppProviders } from './providers'
import { useWindowChrome } from './window'

/**
 * The backend's event bus is replaced wholesale: every `on*` helper captures the handler the
 * bridge handed it and answers a resolved unlisten, so a case can fire the event itself and no
 * `listen` ever reaches Tauri. The scan handlers are captured too — `ScanRefreshProvider` is
 * part of the tree `AppProviders` renders.
 */
const mocks = vi.hoisted(() => {
  // One slot per event the provider subscribes to, so a case can fire one by name.
  const handlers: Record<string, ((...args: unknown[]) => void) | undefined> = {}
  return {
    handlers,
    unlisten: vi.fn(),
    ipc: {
      cachedAgents: vi.fn<() => Promise<ScanReport | null>>(),
      rescan: vi.fn<() => Promise<ScanReport>>(),
      rescanAfterJob: vi.fn<() => Promise<ScanReport>>(),
      listTerminalSessions: vi.fn<() => Promise<TerminalSession[]>>(),
      closeTerminal: vi.fn<(sessionId: string) => Promise<boolean>>(),
      userCatalogDir: vi.fn<() => Promise<string>>(),
      windowChrome: vi.fn<() => Promise<WindowChrome>>(),
    },
  }
})

vi.mock('@/shared/api/events', () => {
  const capture = (name: string) => (handler: (...args: unknown[]) => void) => {
    mocks.handlers[name] = handler
    return Promise.resolve(mocks.unlisten)
  }

  return {
    onJobOutput: capture('jobOutput'),
    onJobDone: capture('jobDone'),
    onSyncDone: capture('syncDone'),
    onTerminalOutput: capture('terminalOutput'),
    onTerminalExit: capture('terminalExit'),
    onWindowState: capture('windowState'),
    onScanStart: capture('scanStart'),
    onAgentScanned: capture('scanAgent'),
    onScanDone: capture('scanDone'),
  }
})

vi.mock('@/shared/api/ipc', () => ({ ipc: mocks.ipc }))

const WINDOWED: WindowChrome = { custom: true, maximized: false, focused: true }

/**
 * Mounts `AppProviders` over a cache of its own and hands it back, so a case can read what the
 * bridges wrote and watch what they ask the cache to do.
 */
function renderProviders(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return { client, ...render(<AppProviders client={client}>{children}</AppProviders>) }
}

/** Fire one captured event the way the backend would, inside `act` because handlers touch stores. */
function fire<T>(name: string, payload: T): void {
  const handler = mocks.handlers[name]
  if (!handler) throw new Error(`the bridge never registered a handler for ${name}`)
  act(() => {
    handler(payload)
  })
}

function session(id: string): TerminalSession {
  return {
    id,
    agentId: 'claude',
    agentName: 'Claude Code',
    cwd: '/home/user',
    shell: 'pwsh',
    command: 'claude',
    cols: 80,
    rows: 24,
    running: true,
    exitCode: null,
    startedAtMs: 1_700_000_000_000,
  }
}

beforeEach(() => {
  initI18n('en')

  mocks.handlers = {}
  mocks.ipc.cachedAgents.mockResolvedValue(null)
  mocks.ipc.rescan.mockResolvedValue({ agents: [] } as unknown as ScanReport)
  mocks.ipc.rescanAfterJob.mockResolvedValue({ agents: [] } as unknown as ScanReport)
  mocks.ipc.listTerminalSessions.mockResolvedValue([])
  mocks.ipc.closeTerminal.mockResolvedValue(true)
  mocks.ipc.userCatalogDir.mockResolvedValue('/home/user/.ahabby/catalog')
  mocks.ipc.windowChrome.mockResolvedValue(WINDOWED)

  // The stores outlive a component on purpose, so one case's jobs and sessions must not leak.
  useJobStore.setState({ jobs: {} })
  useTerminalStore.setState({
    sessions: {},
    workspaces: [],
    activeId: null,
    expanded: false,
    maximized: false,
    buffered: {},
    exits: {},
  })
})

afterEach(() => {
  cleanup()
  unregisterTerminal('session-1')
  vi.clearAllMocks()
})

describe('AppProviders', () => {
  it('renders its children under a query client they can read from', async () => {
    function CatalogDirProbe() {
      const { data } = useQuery({
        queryKey: ['providers-probe'],
        queryFn: () => ipc.userCatalogDir(),
      })
      return <span>{data ?? 'pending'}</span>
    }

    renderProviders(
      <>
        <span>shell</span>
        <CatalogDirProbe />
      </>,
    )

    expect(screen.getByText('shell')).toBeInTheDocument()
    expect(await screen.findByText('/home/user/.ahabby/catalog')).toBeInTheDocument()
  })
})

describe('JobEventBridge', () => {
  it('appends job output and, on job://done, finishes the job and refreshes the library and agents', async () => {
    useJobStore.getState().start({
      jobId: 'job-1',
      agentId: 'claude',
      action: 'install',
      command: 'npm install -g @anthropic-ai/claude-code',
    })

    const { client } = renderProviders(<span>shell</span>)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fire<JobOutputEvent>('jobOutput', { jobId: 'job-1', stream: 'stdout', line: 'installing' })
    await waitFor(() =>
      expect(useJobStore.getState().jobs['job-1']?.lines).toEqual([
        { stream: 'stdout', line: 'installing' },
      ]),
    )

    const outcome: JobOutcome = {
      jobId: 'job-1',
      agentId: 'claude',
      action: 'install',
      command: 'npm install -g @anthropic-ai/claude-code',
      ok: true,
      exitCode: 0,
      cancelled: false,
      durationMs: 1_200,
      message: null,
    }
    fire<JobOutcome>('jobDone', outcome)

    await waitFor(() => expect(useJobStore.getState().jobs['job-1']?.outcome).toEqual(outcome))
    await waitFor(() => expect(mocks.ipc.rescanAfterJob).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.agents() }))
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      queryKeys.library(),
      queryKeys.agents(),
    ])
  })

  it('still marks the job finished when the post-install rescan fails, and invalidates nothing', async () => {
    useJobStore.getState().start({
      jobId: 'job-2',
      agentId: 'claude',
      action: 'update',
      command: 'npm install -g @anthropic-ai/claude-code',
    })
    mocks.ipc.rescanAfterJob.mockRejectedValue(new Error('scan failed'))

    const { client } = renderProviders(<span>shell</span>)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fire<JobOutcome>('jobDone', {
      jobId: 'job-2',
      agentId: 'claude',
      action: 'update',
      command: 'npm install -g @anthropic-ai/claude-code',
      ok: false,
      exitCode: 1,
      cancelled: false,
      durationMs: 30,
      message: 'network unreachable',
    })

    await waitFor(() => expect(mocks.ipc.rescanAfterJob).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(useJobStore.getState().jobs['job-2']?.outcome?.ok).toBe(false))
    expect(invalidate).not.toHaveBeenCalled()
  })
})

describe('SyncEventBridge', () => {
  it('invalidates the sync status, the items, the remote list and the library on sync://done — and nothing else', async () => {
    const { client } = renderProviders(<span>shell</span>)
    const invalidate = vi.spyOn(client, 'invalidateQueries')

    fire<SyncEvent>('syncDone', { run: null, error: null })

    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(4))
    expect(invalidate.mock.calls.map(([filters]) => filters?.queryKey)).toEqual([
      queryKeys.syncStatus(),
      queryKeys.syncItemsAll(),
      queryKeys.syncRemote(),
      queryKeys.library(),
    ])
  })
})

describe('TerminalEventBridge', () => {
  it('buffers terminal://output for the session it names, and finishes the tab on terminal://exit', async () => {
    useTerminalStore.getState().open(session('session-1'))

    renderProviders(<span>shell</span>)

    fire<TerminalOutput>('terminalOutput', { sessionId: 'session-1', data: btoa('hi') })
    await waitFor(() =>
      expect(useTerminalStore.getState().buffered['session-1']).toEqual([
        new Uint8Array([104, 105]),
      ]),
    )

    // The chunk belongs to its own session: a second session's bytes are not mixed into it.
    fire<TerminalOutput>('terminalOutput', { sessionId: 'session-2', data: btoa('x') })
    await waitFor(() =>
      expect(useTerminalStore.getState().buffered['session-2']).toEqual([new Uint8Array([120])]),
    )
    expect(useTerminalStore.getState().buffered['session-1']).toEqual([new Uint8Array([104, 105])])

    fire<TerminalExit>('terminalExit', { sessionId: 'session-1', exitCode: 3 })

    await waitFor(() => expect(useTerminalStore.getState().exits['session-1']).toBe(3))
    expect(useTerminalStore.getState().sessions['session-1']).toMatchObject({
      running: false,
      exitCode: 3,
    })
  })

  it('hands output to a mounted terminal instead of buffering it', async () => {
    const written: Uint8Array[] = []
    registerTerminal('session-1', (data) => written.push(data))

    renderProviders(<span>shell</span>)

    fire<TerminalOutput>('terminalOutput', { sessionId: 'session-1', data: btoa('hi') })
    await waitFor(() => expect(written).toEqual([new Uint8Array([104, 105])]))

    expect(useTerminalStore.getState().buffered['session-1']).toBeUndefined()
  })

  it('detaches every event listener when the providers unmount', async () => {
    const view = renderProviders(<span>shell</span>)

    // The four bridges alone register six listeners; the scan provider adds three more.
    const registered = Object.keys(mocks.handlers).length
    expect(registered).toBeGreaterThanOrEqual(6)

    view.unmount()

    await waitFor(() => expect(mocks.unlisten).toHaveBeenCalledTimes(registered))
  })
})

describe('WindowChromeBridge', () => {
  it('writes window://state into the cache, where the header reads it from', async () => {
    function ChromeProbe() {
      const chrome = useWindowChrome()
      return <span>{chrome ? (chrome.maximized ? 'maximized' : 'windowed') : 'unknown'}</span>
    }

    const { client } = renderProviders(<ChromeProbe />)

    // The cache is primed by that query itself — `boot()` does the same before the first render,
    // the bridge only keeps it current — so the probe shows what `windowChrome()` answered.
    expect(await screen.findByText('windowed')).toBeInTheDocument()

    fire<WindowChrome>('windowState', { custom: true, maximized: true, focused: false })

    expect(await screen.findByText('maximized')).toBeInTheDocument()
    expect(client.getQueryData(queryKeys.windowChrome())).toEqual({
      custom: true,
      maximized: true,
      focused: false,
    })
  })
})

/**
 * `reconciled` is module state, so this is the one case that needs a fresh copy of the module:
 * the dynamic import is what makes the second mount prove the guard instead of proving that an
 * earlier case already ran it.
 */
describe('TerminalEventBridge reconciliation', () => {
  it('asks the backend for its sessions once per page load, even across two mounts', async () => {
    vi.resetModules()
    const { AppProviders: FreshProviders } = await import('./providers')

    const first = render(
      <FreshProviders>
        <span>first</span>
      </FreshProviders>,
    )
    await waitFor(() => expect(mocks.ipc.listTerminalSessions).toHaveBeenCalledTimes(1))

    first.unmount()
    render(
      <FreshProviders>
        <span>second</span>
      </FreshProviders>,
    )
    expect(screen.getByText('second')).toBeInTheDocument()

    // The guard is the contract: the second mount must not reconcile again.
    await waitFor(() => expect(mocks.ipc.listTerminalSessions).toHaveBeenCalledTimes(1))
  })
})
