/**
 * One pane's terminal: the panel it paints, the emulator the session owns, and the keyboard.
 *
 * xterm paints the canvas from the scheme it is given, but the strip around it and the find bar
 * floating over it are ordinary elements built from the design tokens. The regressions this guards
 * against are a panel wearing the app's colours around a canvas painted in someone else's, an
 * emulator rebuilt instead of re-homed, and a pane holding the keyboard that does not have it.
 */

import { useState } from 'react'
import { cleanup, fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { disposeTerminal } from '../lib/terminals'
import { useTerminalStore, type TerminalSessionState } from '../store'
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

const CLAUDE: TerminalSessionState = {
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

const CODEX: TerminalSessionState = { ...CLAUDE, sessionId: 'session-2', agentName: 'Codex' }

/** A grid with the first pane holding a session: the shape the keyboard case needs. */
const GRID = {
  id: 'w1',
  layout: 'grid' as const,
  panes: [
    { id: 'p1', sessionId: 'session-1' },
    { id: 'p2', sessionId: null },
    { id: 'p3', sessionId: null },
    { id: 'p4', sessionId: null },
  ],
  activePaneId: 'p1',
  sizes: { x: 0.5, y: 0.5 },
}

/** The element the view wraps the emulator in — the panel the scheme is declared on. */
function surface(container: HTMLElement): HTMLElement {
  const element = container.firstElementChild
  if (!(element instanceof HTMLElement)) throw new Error('the terminal panel did not render')
  return element
}

/** Both panes of a two-pane render, in document order. */
function surfaces(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.xterm')).map((element) => {
    const panel = element.closest<HTMLElement>('.absolute')
    if (!panel) throw new Error('the emulator is not inside a pane')
    return panel
  })
}

/** Two panes and a way to move the focus between them, standing in for the dock. */
function TwoPanes() {
  const [focused, setFocused] = useState<'first' | 'second'>('first')

  return (
    <>
      <button type="button" onClick={() => setFocused('second')}>
        focus the second pane
      </button>
      <TerminalView session={CLAUDE} visible focusable={focused === 'first'} />
      <TerminalView session={CODEX} visible focusable={focused === 'second'} />
    </>
  )
}

afterEach(() => {
  // The emulators are keyed by session and live outside React, so a case hands its own back: the
  // store no longer knowing the session is what makes the unmount release it.
  useTerminalStore.setState({
    sessions: {},
    workspaces: [],
    activeId: null,
    expanded: false,
    maximized: false,
    buffered: {},
    exits: {},
  })
  cleanup()
  disposeTerminal(CLAUDE.sessionId)
  disposeTerminal(CODEX.sessionId)
  settings.terminalTheme = 'dracula'
})

describe('TerminalView surface', () => {
  it('declares the fixed scheme on the panel it paints', () => {
    const { container } = renderWithProviders(<TerminalView session={CLAUDE} visible />)
    const panel = surface(container)

    expect(panel.style.getPropertyValue('--ah-background')).toBe('#282a36')
    expect(panel.style.getPropertyValue('--ah-foreground')).toBe('#f8f8f2')
    // The base layer reads the `--color-*` half, so both names have to be there.
    expect(panel.style.getPropertyValue('--color-background')).toBe('#282a36')
  })

  it('declares nothing for the scheme that is the interface', () => {
    settings.terminalTheme = 'auto'
    const { container } = renderWithProviders(<TerminalView session={CLAUDE} visible />)

    expect(surface(container).style.getPropertyValue('--ah-background')).toBe('')
  })

  it('renders the emulator inside the surface it paints', () => {
    const { container } = renderWithProviders(<TerminalView session={CLAUDE} visible />)

    // The canvas has to sit inside the element that declares the scheme — that element is what the
    // strip around it and the find bar are painted from.
    expect(surface(container).querySelector('.xterm')).not.toBeNull()
  })
})

describe('TerminalView emulator', () => {
  it('shows the same emulator again when the view is mounted a second time', () => {
    useTerminalStore.setState({ sessions: { 'session-1': CLAUDE } })
    const first = renderWithProviders(<TerminalView session={CLAUDE} visible />)
    const element = surface(first.container).querySelector('.xterm')
    expect(element).not.toBeNull()
    first.unmount()

    // Development mounts every component twice, and rebuilding the terminal for the second mount
    // would throw away the screen the agent has already painted — the new host gets the very same
    // emulator moved into it, scrollback and all.
    const second = renderWithProviders(<TerminalView session={CLAUDE} visible />)
    expect(surface(second.container).querySelector('.xterm')).toBe(element)
  })

  it('builds a fresh emulator for a session that was closed and opened again', () => {
    useTerminalStore.setState({ sessions: { 'session-1': CLAUDE } })
    const first = renderWithProviders(<TerminalView session={CLAUDE} visible />)
    const element = surface(first.container).querySelector('.xterm')
    first.unmount()

    // The session is gone from the store, so its emulator is released with it…
    useTerminalStore.setState({ sessions: {} })
    disposeTerminal(CLAUDE.sessionId)

    // …and even though the backend's counter never reuses a session id, a new view must never
    // inherit the old screen.
    useTerminalStore.setState({ sessions: { 'session-1': CLAUDE } })
    const second = renderWithProviders(<TerminalView session={CLAUDE} visible />)
    expect(surface(second.container).querySelector('.xterm')).not.toBe(element)
  })
})

describe('TerminalView focus', () => {
  it('hands the keyboard to the focused pane alone', async () => {
    useTerminalStore.setState({ sessions: { 'session-1': CLAUDE, 'session-2': CODEX } })
    renderWithProviders(<TwoPanes />)

    const [first, second] = surfaces()
    // Two panes are on screen and both keep painting; only the focused one takes the keys.
    expect(first?.contains(document.activeElement)).toBe(true)
    expect(second?.contains(document.activeElement)).toBe(false)

    await userEvent.click(screen.getByRole('button', { name: 'focus the second pane' }))

    // The keyboard moves with the focus, and the pane that lost it lets go: a terminal that keeps
    // the keys while the user is looking elsewhere swallows everything the app expects.
    expect(surfaces()[1]?.contains(document.activeElement)).toBe(true)
    expect(surfaces()[0]?.contains(document.activeElement)).toBe(false)
  })

  it('reads the pane a Ctrl+digit asks for', () => {
    useTerminalStore.setState({
      sessions: { 'session-1': CLAUDE },
      workspaces: [GRID],
      activeId: 'w1',
      expanded: true,
    })
    const { container } = renderWithProviders(<TerminalView session={CLAUDE} visible focusable />)
    const keys = container.querySelector('.xterm-helper-textarea')
    if (!(keys instanceof HTMLElement)) throw new Error('the emulator rendered no keyboard target')

    fireEvent.keyDown(keys, { code: 'Digit2', ctrlKey: true })

    expect(useTerminalStore.getState().workspaces[0]?.activePaneId).toBe('p2')
  })
})
