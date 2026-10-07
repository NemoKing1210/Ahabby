import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { RouterProvider, createMemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { settingsRoutes } from '../routes'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    listPackageManagers: vi.fn(),
    userCatalogDir: vi.fn(),
    backupRoot: vi.fn(),
    listTerminals: vi.fn(),
    revealPath: vi.fn(),
    setWindowTheme: vi.fn(),
  },
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
    sidebarCollapsed: false,
    lastRoute: null,
    ...overrides,
  }
}

/** The stylesheet `appearanceApplier` installs for a non-default accent. */
const accentStyles = () => document.getElementById('ah-accent-styles')?.textContent ?? ''

async function openSettings(data = settings(), route = '/settings/appearance') {
  vi.mocked(ipc.getSettings).mockResolvedValue(data)
  vi.mocked(ipc.listPackageManagers).mockResolvedValue([])
  vi.mocked(ipc.userCatalogDir).mockResolvedValue('/catalog')
  vi.mocked(ipc.backupRoot).mockResolvedValue('/backups')
  vi.mocked(ipc.listTerminals).mockResolvedValue({ options: [], defaultCwd: '/home' })
  vi.mocked(ipc.saveSettings).mockImplementation((next: Settings) => Promise.resolve(next))

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const router = createMemoryRouter(settingsRoutes, { initialEntries: [route] })
  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={initI18n('en')}>
        <TooltipProvider>
          <RouterProvider router={router} />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { level: 1, name: 'Settings' })
  // The subpage paints through its own transition, so a bare `getBy*` right after this would be
  // a race — every test starts on the appearance area.
  await screen.findByRole('heading', { level: 2, name: 'Appearance' })
  return data
}

beforeEach(() => {
  vi.mocked(ipc.setWindowTheme).mockResolvedValue(undefined)
  window.matchMedia = (() => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia
})

afterEach(() => {
  cleanup()
  document.getElementById('ah-accent-styles')?.remove()
  document.documentElement.removeAttribute('style')
  document.documentElement.classList.remove('dark')
})

describe('Settings layout', () => {
  it('opens the first area when the settings path is bare', async () => {
    await openSettings(settings(), '/settings')

    expect(await screen.findByRole('heading', { level: 2, name: 'Appearance' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Terminal' })).toHaveAttribute(
      'href',
      '/settings/terminal',
    )
  })

  it('moves between areas and keeps the unsaved draft', async () => {
    await openSettings()

    await userEvent.click(screen.getByRole('button', { name: 'Violet' }))
    await userEvent.click(screen.getByRole('link', { name: 'Network' }))
    expect(await screen.findByRole('heading', { level: 2, name: 'Network' })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: 'Appearance' }))
    expect(await screen.findByRole('button', { name: 'Violet', pressed: true })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => {
      expect(ipc.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ accent: 'violet' }))
    })
  })

  it('drops the draft when the changes are discarded', async () => {
    await openSettings(settings({ accent: 'violet' }))

    await userEvent.click(screen.getByRole('button', { name: 'Teal' }))
    expect(screen.getByRole('button', { name: 'Teal', pressed: true })).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Discard changes' }))
    expect(screen.getByRole('button', { name: 'Violet', pressed: true })).toBeInTheDocument()
    expect(ipc.saveSettings).not.toHaveBeenCalled()
  })
})

describe('Settings appearance', () => {
  it('shows the saved choices', async () => {
    await openSettings(settings({ accent: 'violet', interfaceScale: 110, fontFamily: 'serif' }))

    expect(screen.getByRole('button', { name: 'Violet', pressed: true })).toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Interface size' })).toHaveTextContent(
      'Comfortable · 110%',
    )
    expect(screen.getByRole('combobox', { name: 'Interface font' })).toHaveTextContent(
      'Lora (serif)',
    )
  })

  it('previews an accent on the live interface before it is saved', async () => {
    await openSettings()
    expect(accentStyles()).toBe('')

    await userEvent.click(screen.getByRole('button', { name: 'Violet' }))

    expect(accentStyles()).toContain('--ah-accent:#a682d9')
    expect(ipc.saveSettings).not.toHaveBeenCalled()
  })

  it('saves the accent with the rest of the settings', async () => {
    await openSettings()

    await userEvent.click(screen.getByRole('button', { name: 'Teal' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipc.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({ accent: 'teal', interfaceScale: 100 }),
      )
    })
  })

  it('accepts a typed custom accent and refuses one it cannot paint', async () => {
    await openSettings()

    await userEvent.click(screen.getByRole('button', { name: 'Custom' }))
    const hex = screen.getByRole('textbox', { name: 'Custom accent color' })

    await userEvent.clear(hex)
    await userEvent.type(hex, '#12')
    expect(screen.getByText('Use a hex color like #7b83eb')).toBeInTheDocument()
    expect(accentStyles()).toBe('')

    await userEvent.clear(hex)
    await userEvent.type(hex, '#ABC')
    expect(accentStyles()).toContain('--ah-accent:#aabbcc')
  })

  it('puts accent, sizes and fonts back to their defaults and leaves the rest alone', async () => {
    await openSettings(
      settings({
        accent: 'violet',
        interfaceScale: 110,
        textScale: 125,
        fontFamily: 'serif',
        monoFont: 'system',
        theme: 'dark',
      }),
    )

    await userEvent.click(screen.getByRole('button', { name: 'Reset accent, sizes and fonts' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipc.saveSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          accent: 'clay',
          accentCustom: null,
          interfaceScale: 100,
          textScale: 100,
          fontFamily: 'inter',
          monoFont: 'jetbrains',
          theme: 'dark',
          language: 'en',
        }),
      )
    })
  })
})
