import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Agent } from '@/shared/bindings/Agent'
import type { ScanReport } from '@/shared/bindings/ScanReport'

import { ScanRefreshProvider, useScanRefresh } from './scan'

/** Listeners the provider attached, keyed by the event name the backend emits. */
const { listeners } = vi.hoisted(() => ({
  listeners: new Map<string, (event: { payload: unknown }) => void>(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler)
    return Promise.resolve(() => listeners.delete(event))
  },
}))

vi.mock('@/shared/api/ipc', () => ({
  ipc: { cachedAgents: vi.fn(), rescan: vi.fn() },
}))

function agent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
  return {
    description: 'A coding agent',
    tagline: null,
    icon: null,
    category: 'cli',
    website: null,
    docs: null,
    features: [],
    popular: true,
    status: 'installed',
    binaryPath: null,
    foundIn: null,
    version: null,
    installedVia: null,
    installOptions: [],
    canInstall: false,
    installDocsUrl: null,
    canUpdate: false,
    canUninstall: false,
    configs: [],
    skills: [],
    mcpServers: [],
    other: [],
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' },
    removal: 'manifest',
    warnings: [],
    scanMs: 4,
    ...overrides,
  }
}

const REPORT: ScanReport = {
  agents: [agent({ id: 'alpha', name: 'Alpha' }), agent({ id: 'beta', name: 'Beta' })],
  problems: [],
  scannedAtMs: 0,
  durationMs: 12,
  installed: 2,
  availableToInstall: 0,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
}

function emit(event: string, payload: unknown) {
  const handler = listeners.get(event)
  if (!handler) throw new Error(`nothing listens to ${event}`)
  act(() => handler({ payload }))
}

/** Mirrors what the cards and the sidebar read from the provider. */
function Probe() {
  const { isScanning, scanning, landed, progress } = useScanRefresh()
  return (
    <ul>
      {REPORT.agents.map((entry) => (
        <li key={entry.id} data-testid={entry.id}>
          {scanning.has(entry.id) ? 'scanning' : landed.has(entry.id) ? 'landed' : 'idle'}
        </li>
      ))}
      <li data-testid="running">{isScanning ? `${progress.done}/${progress.total}` : 'idle'}</li>
    </ul>
  )
}

describe('ScanRefreshProvider', () => {
  beforeEach(() => {
    listeners.clear()
    vi.mocked(ipc.rescan).mockResolvedValue(REPORT)
  })

  function renderProvider(cached: ScanReport | null) {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(cached)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(queryKeys.agents(), REPORT)
    render(
      <QueryClientProvider client={client}>
        <ScanRefreshProvider>
          <Probe />
        </ScanRefreshProvider>
      </QueryClientProvider>,
    )
    return client
  }

  it('refreshes a remembered list and settles each agent on its own', async () => {
    const client = renderProvider(REPORT)

    // A restart paints the remembered list and starts a background scan for it.
    await waitFor(() => expect(ipc.rescan).toHaveBeenCalledTimes(1))

    emit('scan://start', null)
    expect(screen.getByTestId('running')).toHaveTextContent('0/2')
    expect(screen.getByTestId('alpha')).toHaveTextContent('scanning')
    expect(screen.getByTestId('beta')).toHaveTextContent('scanning')

    const fresh = agent({ id: 'alpha', name: 'Alpha', version: null, installedVia: 'npm' })
    emit('scan://agent', fresh)

    // Only alpha settles: beta is still being inspected.
    await waitFor(() => expect(screen.getByTestId('alpha')).toHaveTextContent('landed'))
    expect(screen.getByTestId('beta')).toHaveTextContent('scanning')
    expect(screen.getByTestId('running')).toHaveTextContent('1/2')

    // The per-agent event is also what updates the list itself.
    const patched = client
      .getQueryData<ScanReport>(queryKeys.agents())
      ?.agents.find((entry) => entry.id === 'alpha')
    expect(patched).toEqual(fresh)

    const finished: ScanReport = { ...REPORT, scannedAtMs: 99 }
    emit('scan://done', finished)
    expect(screen.getByTestId('running')).toHaveTextContent('idle')
    expect(screen.getByTestId('alpha')).toHaveTextContent('idle')
    expect(client.getQueryData<ScanReport>(queryKeys.agents())?.scannedAtMs).toBe(99)
  })

  it('does not scan again on a first launch that already scanned', async () => {
    renderProvider(null)

    await waitFor(() => expect(ipc.cachedAgents).toHaveBeenCalledTimes(1))
    expect(ipc.rescan).not.toHaveBeenCalled()
  })
})
