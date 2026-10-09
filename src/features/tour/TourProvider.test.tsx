import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { TourProvider } from './TourProvider'
import { emptySyncSettings } from '@/test/fixtures'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    setTourCompleted: vi.fn(),
    setSidebarCollapsed: vi.fn(),
  },
}))

vi.mock('./runTour', () => ({
  startProductTour: vi.fn(() => ({
    isActive: () => true,
    destroy: vi.fn(),
    drive: vi.fn(),
  })),
}))

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
    tourCompleted: false,
    ...overrides,
    sync: overrides.sync ?? emptySyncSettings,
  }
}

function renderTour(stored = settings()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.settings(), stored)
  vi.mocked(ipc.setTourCompleted).mockImplementation((completed) =>
    Promise.resolve(settings({ ...stored, tourCompleted: completed })),
  )

  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={initI18n('en')}>
        <TooltipProvider>
          <MemoryRouter>
            <TourProvider>
              <p>shell</p>
            </TourProvider>
          </MemoryRouter>
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  return client
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

beforeEach(() => {
  vi.mocked(ipc.setTourCompleted).mockReset()
})

describe('TourProvider', () => {
  it('opens the welcome dialog on a first launch', async () => {
    renderTour(settings({ tourCompleted: false }))
    expect(await screen.findByRole('heading', { name: 'Welcome to Ahabby' })).toBeInTheDocument()
  })

  it('does not open the welcome when the tour is already done', () => {
    renderTour(settings({ tourCompleted: true }))
    expect(screen.queryByRole('heading', { name: 'Welcome to Ahabby' })).toBeNull()
  })

  it('marks the tour completed when Skip is chosen', async () => {
    const client = renderTour(settings({ tourCompleted: false }))
    await screen.findByRole('heading', { name: 'Welcome to Ahabby' })
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }))
    await waitFor(() => expect(ipc.setTourCompleted).toHaveBeenCalledWith(true))
    expect(client.getQueryData<Settings>(queryKeys.settings())?.tourCompleted).toBe(true)
  })
})
