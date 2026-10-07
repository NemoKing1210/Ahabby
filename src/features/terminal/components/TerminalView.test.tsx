/**
 * The terminal panel's own colours.
 *
 * xterm paints the canvas from the scheme it is given, but the strip around it and the find bar
 * floating over it are ordinary elements built from the design tokens. The regression this guards
 * against is a panel wearing the app's colours around a canvas painted in someone else's — a dark
 * scheme sitting in the light interface, or the other way round.
 */

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import type { TerminalTab } from '../store'
import { TerminalView } from './TerminalView'

const settings = vi.hoisted(() => ({ terminalTheme: 'dracula' }))

vi.mock('@/features/settings/api/hooks', () => ({
  useSettings: () => ({ data: settings }),
}))

/** jsdom has no `ResizeObserver`, and the view fits itself on every resize of its host. */
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', ResizeObserverStub)

/** …nor a `matchMedia`, which xterm's device-pixel-ratio service asks for once on `open`. */
vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
}))

const TAB: TerminalTab = {
  sessionId: 'session-1',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  cwd: 'C:\\work',
  shell: 'pwsh',
  command: 'claude',
  running: true,
  exitCode: null,
  startedAtMs: 0,
}

/** The element the view wraps the emulator in — the panel the scheme is declared on. */
function surface(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild
  if (!(element instanceof HTMLElement)) throw new Error('the terminal panel did not render')
  return element
}

afterEach(() => {
  cleanup()
  settings.terminalTheme = 'dracula'
})

describe('TerminalView surface', () => {
  it('declares the fixed scheme on the panel it paints', () => {
    const { container } = renderWithProviders(<TerminalView session={TAB} active />)
    const panel = surface(container)

    expect(panel.style.getPropertyValue('--ah-background')).toBe('#282a36')
    expect(panel.style.getPropertyValue('--ah-foreground')).toBe('#f8f8f2')
    // The base layer reads the `--color-*` half, so both names have to be there.
    expect(panel.style.getPropertyValue('--color-background')).toBe('#282a36')
  })

  it('declares nothing for the scheme that is the interface', () => {
    settings.terminalTheme = 'auto'
    const { container } = renderWithProviders(<TerminalView session={TAB} active />)

    expect(surface(container).style.getPropertyValue('--ah-background')).toBe('')
  })

  it('renders the emulator inside the surface it paints', () => {
    const { container } = renderWithProviders(<TerminalView session={TAB} active />)

    // The canvas has to sit inside the element that declares the scheme — that element is what the
    // strip around it and the find bar are painted from.
    expect(surface(container).querySelector('.xterm')).not.toBeNull()
  })
})
