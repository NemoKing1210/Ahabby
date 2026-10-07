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

import { disposeTerminal } from '../lib/terminals'
import { useTerminalStore, type TerminalTab } from '../store'
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
  // The emulators are keyed by session and live outside React, so a case has to hand its own
  // back: the store no longer listing the tab is what makes the unmount release it.
  useTerminalStore.setState({ tabs: [], activeId: null, expanded: false, buffered: {}, exits: {} })
  cleanup()
  disposeTerminal(TAB.sessionId)
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

describe('TerminalView emulator', () => {
  /** A mount is only a remount of a live tab when the store still lists it. */
  function liveTab(): void {
    useTerminalStore.setState({ tabs: [TAB], activeId: TAB.sessionId, expanded: true })
  }

  it('shows the same emulator again when the view is mounted a second time', () => {
    liveTab()
    const first = renderWithProviders(<TerminalView session={TAB} active />)
    const element = surface(first.container).querySelector('.xterm')
    expect(element).not.toBeNull()
    first.unmount()

    // Development mounts every component twice, and rebuilding the terminal for the second mount
    // would throw away the screen the agent has already painted — the new host gets the very same
    // emulator moved into it, scrollback and all.
    const second = renderWithProviders(<TerminalView session={TAB} active />)
    expect(surface(second.container).querySelector('.xterm')).toBe(element)
  })

  it('builds a fresh emulator for a tab that was closed and opened again', () => {
    liveTab()
    const first = renderWithProviders(<TerminalView session={TAB} active />)
    const element = surface(first.container).querySelector('.xterm')
    first.unmount()

    // The tab is gone from the store, so its emulator is released with it…
    useTerminalStore.setState({ tabs: [] })
    disposeTerminal(TAB.sessionId)

    // …and the session id is never reused by the backend's counter, but even so a new view must
    // never inherit the old screen.
    liveTab()
    const second = renderWithProviders(<TerminalView session={TAB} active />)
    expect(surface(second.container).querySelector('.xterm')).not.toBe(element)
  })
})
