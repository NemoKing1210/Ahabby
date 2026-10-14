import { cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Settings } from '@/shared/bindings/Settings'
import { testSettings } from '@/test/fixtures'
import { renderWithProviders } from '@/test/render'

import { TERMINAL_THEME_ORDER } from '@/features/terminal/lib/themes'

import { SettingsDraftProvider } from '../lib/draft'
import { SettingsTerminalPage } from './SettingsTerminalPage'

vi.mock('@/shared/api/ipc', () => ({ ipc: { listTerminals: vi.fn() } }))

/**
 * The page reads its settings through the draft the layout owns, and the layout's save button is
 * the only thing that reaches the backend. So the harness stands in for that layout: it holds the
 * document, applies every patch a control asks for, and reports the patch.
 */
function Harness({
  initial,
  onUpdate,
}: {
  initial?: Partial<Settings>
  onUpdate?: (patch: Partial<Settings>) => void
}) {
  const [draft, setDraft] = useState<Settings>(() => testSettings(initial))
  const update = (patch: Partial<Settings>) => {
    onUpdate?.(patch)
    setDraft((current) => ({ ...current, ...patch }))
  }
  return (
    <SettingsDraftProvider value={{ draft, update }}>
      <SettingsTerminalPage />
    </SettingsDraftProvider>
  )
}

function renderPage(initial?: Partial<Settings>, onUpdate?: (patch: Partial<Settings>) => void) {
  return renderWithProviders(<Harness initial={initial} onUpdate={onUpdate} />)
}

/** The colour picker, as the reader of a screen sees it. */
function picker(container: HTMLElement) {
  return within(container).getByRole('radiogroup', { name: 'Color scheme' })
}

/** The miniature terminal below the picker, painted with the chosen scheme. */
function previewPanel(container: HTMLElement): HTMLElement {
  const panel = within(container).getByText('Preview').parentElement?.parentElement
  if (!(panel instanceof HTMLElement)) throw new Error('the terminal preview did not render')
  return panel
}

/** The schemes as Settings names them, in the order the picker has to show them. */
const THEME_LABELS = [
  'Ahabby',
  'One Dark',
  'Dracula',
  'Tokyo Night',
  'Catppuccin Mocha',
  'Nord',
  'Gruvbox Dark',
  'Solarized Dark',
  'Solarized Light',
  'One Light',
]

beforeEach(() => {
  vi.mocked(ipc.listTerminals).mockResolvedValue({ options: [], defaultCwd: '/home' })
})

afterEach(cleanup)

describe('SettingsTerminalPage', () => {
  it('lists every built-in scheme in order, with the saved one selected', () => {
    const { container } = renderPage({ terminalTheme: 'nord' })
    const cards = within(picker(container)).getAllByRole('radio')

    expect(cards).toHaveLength(TERMINAL_THEME_ORDER.length)
    expect(THEME_LABELS).toHaveLength(TERMINAL_THEME_ORDER.length)
    THEME_LABELS.forEach((label, index) => {
      expect(cards[index]?.textContent ?? '').toContain(label)
    })

    expect(
      within(picker(container)).getByRole('radio', { name: /^Nord/ }).getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      within(picker(container))
        .getByRole('radio', { name: /^Dracula/ })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('writes a chosen scheme into the draft and shows it as selected', async () => {
    const user = userEvent.setup()
    const patches: Partial<Settings>[] = []
    const { container } = renderPage({ terminalTheme: 'auto' }, (patch) => patches.push(patch))

    await user.click(within(picker(container)).getByRole('radio', { name: /^Dracula/ }))

    expect(patches).toEqual([{ terminalTheme: 'dracula' }])
    expect(
      within(picker(container))
        .getByRole('radio', { name: /^Dracula/ })
        .getAttribute('aria-checked'),
    ).toBe('true')
    expect(
      within(picker(container))
        .getByRole('radio', { name: /^Ahabby/ })
        .getAttribute('aria-checked'),
    ).toBe('false')
  })

  it('paints the preview with the palette of the chosen scheme', async () => {
    const user = userEvent.setup()
    const { container } = renderPage({ terminalTheme: 'dracula' })

    let panel = previewPanel(container)
    expect(panel.style.background).toBe('rgb(40, 42, 54)')
    expect(within(panel).getByText('✓ 9 agents ready').style.color).toBe('rgb(80, 250, 123)')
    expect(within(panel).getByText('! 3 need a version check').style.background).toBe(
      'rgb(68, 71, 90)',
    )

    // Another scheme is another palette, not another name on the same colours.
    await user.click(within(picker(container)).getByRole('radio', { name: /^One Light/ }))

    panel = previewPanel(container)
    expect(panel.style.background).toBe('rgb(250, 250, 250)')
    expect(within(panel).getByText('✓ 9 agents ready').style.color).toBe('rgb(80, 161, 79)')
  })

  it('paints `auto` from the app theme instead of a fixed palette', () => {
    const root = document.documentElement
    root.classList.add('dark')
    root.style.setProperty('--ah-background', '#123456')
    root.style.setProperty('--ah-foreground', '#abcdef')
    root.style.setProperty('--ah-accent', '#ff00ff')

    try {
      const { container } = renderPage({ terminalTheme: 'auto' })
      const panel = previewPanel(container)

      // The interface's own tokens, not one of the presets'.
      expect(panel.style.background).toBe('rgb(18, 52, 86)')
      expect(within(panel).getByText('❯').style.color).toBe('rgb(255, 0, 255)')
      expect(panel.style.background).not.toBe('rgb(40, 42, 54)')
    } finally {
      cleanup()
      root.classList.remove('dark')
      root.style.removeProperty('--ah-background')
      root.style.removeProperty('--ah-foreground')
      root.style.removeProperty('--ah-accent')
    }
  })

  it('ignores the app tokens for a fixed scheme', () => {
    const root = document.documentElement
    root.style.setProperty('--ah-background', '#123456')

    try {
      const { container } = renderPage({ terminalTheme: 'dracula' })

      expect(previewPanel(container).style.background).toBe('rgb(40, 42, 54)')
    } finally {
      cleanup()
      root.style.removeProperty('--ah-background')
    }
  })
})
