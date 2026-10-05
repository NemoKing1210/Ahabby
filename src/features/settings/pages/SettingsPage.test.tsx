import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Settings } from '@/shared/bindings/Settings'
import { renderWithProviders } from '@/test/render'

import { SettingsPage } from './SettingsPage'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    getSettings: vi.fn(),
    saveSettings: vi.fn(),
    listPackageManagers: vi.fn(),
    userCatalogDir: vi.fn(),
    backupRoot: vi.fn(),
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
    hiddenAgents: [],
    favoriteAgents: [],
    ...overrides,
  }
}

/** The stylesheet `appearanceApplier` installs for a non-default accent. */
const accentStyles = () => document.getElementById('ah-accent-styles')?.textContent ?? ''

async function openSettings(data = settings()) {
  vi.mocked(ipc.getSettings).mockResolvedValue(data)
  vi.mocked(ipc.listPackageManagers).mockResolvedValue([])
  vi.mocked(ipc.userCatalogDir).mockResolvedValue('/catalog')
  vi.mocked(ipc.backupRoot).mockResolvedValue('/backups')
  vi.mocked(ipc.saveSettings).mockImplementation((next: Settings) => Promise.resolve(next))

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  renderWithProviders(
    <QueryClientProvider client={client}>
      <SettingsPage />
    </QueryClientProvider>,
  )
  await screen.findByRole('heading', { name: 'Settings' })
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

describe('SettingsPage appearance', () => {
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
