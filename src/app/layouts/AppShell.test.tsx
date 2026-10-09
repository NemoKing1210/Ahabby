import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { ScanRefreshProvider } from '@/features/agents/api/scan'

import { AppShell } from './AppShell'
import { emptySyncSettings } from '@/test/fixtures'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    getSettings: vi.fn(),
    setSidebarCollapsed: vi.fn(),
    setLastRoute: vi.fn(),
    setTourCompleted: vi.fn(),
    cachedAgents: vi.fn(),
    listAgents: vi.fn(),
    listLibrary: vi.fn(),
    listTerminals: vi.fn(),
  },
}))

/** The event bridge is not what this file is about; the shell works without it. */
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))

const REPORT: ScanReport = {
  agents: [],
  problems: [],
  scannedAtMs: 0,
  durationMs: 0,
  installed: 0,
  availableToInstall: 0,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
  projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
}

function settings(overrides: Partial<Settings> = {}): Settings {
  return {
    language: 'en',
    theme: 'system',
    accent: 'clay',
    accentCustom: null,
    interfaceScale: 100,
    textScale: 100,
    fontFamily: 'inter',
    monoFont: 'jetbrains',
    extraScanPaths: [],
    networkVersionChecks: true,
    backupDir: null,
    versionCacheMinutes: 60,
    proxyMode: 'none',
    proxyUrl: null,
    terminal: 'builtin',
    terminalTheme: 'auto',
    hiddenAgents: [],
    favoriteAgents: [],
    projectFolders: [],
    launchAtLogin: false,
    trayIcon: true,
    closeToTray: true,
    startMinimized: false,
    sidebarCollapsed: false,
    lastRoute: null,
    tourCompleted: true,
    ...overrides,
    sync: overrides.sync ?? emptySyncSettings,
  }
}

/**
 * Mounts the shell the way `boot()` does: the settings query is primed before the first render,
 * and only the commands the shell actually calls are mocked. What is asserted here is the pair of
 * remembered values — the rail and the open screen — from the click to the write.
 */
function renderShell(stored = settings(), route = '/agents') {
  vi.mocked(ipc.cachedAgents).mockResolvedValue(null)
  vi.mocked(ipc.listAgents).mockResolvedValue(REPORT)
  vi.mocked(ipc.listLibrary).mockResolvedValue({
    skills: [],
    mcpServers: [],
    other: [],
    stats: { agents: 0, installedAgents: 0, skills: 0, mcpServers: 0, other: 0 },
    scannedAtMs: 0,
    problems: [],
  })
  vi.mocked(ipc.listTerminals).mockResolvedValue({ options: [], defaultCwd: '/home' })
  vi.mocked(ipc.setSidebarCollapsed).mockImplementation((collapsed: boolean) =>
    Promise.resolve(settings({ ...stored, sidebarCollapsed: collapsed })),
  )
  vi.mocked(ipc.setLastRoute).mockImplementation((last: string | null) =>
    Promise.resolve(settings({ ...stored, lastRoute: last })),
  )

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.settings(), stored)
  client.setQueryData(queryKeys.agents(), REPORT)

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          { path: 'agents', element: <p>agents screen</p> },
          { path: 'library', element: <p>library screen</p> },
        ],
      },
    ],
    { initialEntries: [route] },
  )

  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={initI18n('en')}>
        <TooltipProvider>
          <ScanRefreshProvider>
            <RouterProvider router={router} />
          </ScanRefreshProvider>
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return client
}

afterEach(() => {
  cleanup()
})

describe('AppShell', () => {
  it('opens the rail the way it was left', async () => {
    renderShell(settings({ sidebarCollapsed: true }))

    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Navigation' })).toBeNull()
  })

  it('moves the rail on the click and remembers it, before the write lands', async () => {
    // The write is held open: everything asserted below happens while it is still in flight.
    let release: (saved: Settings) => void = () => undefined
    const client = renderShell()
    vi.mocked(ipc.setSidebarCollapsed).mockImplementation(
      () => new Promise<Settings>((resolve) => (release = resolve)),
    )
    await screen.findByRole('heading', { name: 'Navigation' })

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    expect(await screen.findByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument()
    expect(client.getQueryData<Settings>(queryKeys.settings())?.sidebarCollapsed).toBe(true)
    expect(ipc.setSidebarCollapsed).toHaveBeenCalledWith(true)

    await act(async () => {
      release(settings({ sidebarCollapsed: true }))
      await Promise.resolve()
    })
  })

  it('puts the rail back where it was when the write fails', async () => {
    vi.mocked(ipc.setSidebarCollapsed).mockRejectedValue(new Error('settings.json is read-only'))
    const client = renderShell()
    await screen.findByRole('heading', { name: 'Navigation' })

    await userEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }))

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Collapse sidebar' })).toBeInTheDocument(),
    )
    expect(client.getQueryData<Settings>(queryKeys.settings())?.sidebarCollapsed).toBe(false)
  })

  it('remembers the screen the window is on', async () => {
    const client = renderShell(settings({ lastRoute: '/agents' }), '/library')

    await waitFor(() => expect(ipc.setLastRoute).toHaveBeenCalledWith('/library'))
    expect(client.getQueryData<Settings>(queryKeys.settings())?.lastRoute).toBe('/library')
  })

  it('does not write the screen it already remembers', async () => {
    renderShell(settings({ lastRoute: '/agents' }), '/agents')

    expect(await screen.findByText('agents screen')).toBeInTheDocument()
    expect(ipc.setLastRoute).not.toHaveBeenCalled()
  })
})
