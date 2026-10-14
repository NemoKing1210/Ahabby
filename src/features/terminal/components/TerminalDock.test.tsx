/**
 * The dock: a tab strip that belongs to the window, terminals that belong to their sessions.
 *
 * What this guards against is a dock that unmounts or rebuilds a terminal to make room — a
 * background agent must go on painting into its own scrollback, a collapsed dock must not keep
 * the keyboard, and closing a tab must reach the backend that holds the PTY.
 *
 * The emulator is the real one, stubbed the way `TerminalView.test.tsx` stubs it: jsdom has
 * neither `ResizeObserver` nor `matchMedia`, which xterm asks for once on `open`.
 */

import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { disposeTerminal } from '../lib/terminals'
import { useTerminalStore, type TerminalTab } from '../store'
import { TerminalDock } from './TerminalDock'

/** The backend calls the dock's tree makes; everything else is never reached by these cases. */
const backend = vi.hoisted(() => ({
  closeTerminal: vi.fn((_sessionId: string): Promise<boolean> => Promise.resolve(true)),
  writeTerminal: vi.fn((): Promise<void> => Promise.resolve()),
  resizeTerminal: vi.fn((): Promise<void> => Promise.resolve()),
}))

vi.mock('@/shared/api/ipc', () => ({ ipc: backend }))

/** The tab icons come from the agent list and the terminal's colours from the settings. */
vi.mock('@/features/agents/api/queries', () => ({ useAgents: () => ({ data: undefined }) }))
vi.mock('@/features/settings/api/hooks', () => ({
  useSettings: () => ({ data: { terminalTheme: 'auto' } }),
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

const CLAUDE: TerminalTab = {
  sessionId: 'term-1',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  cwd: 'C:\\work\\ahabby',
  shell: 'pwsh',
  command: 'claude',
  running: true,
  exitCode: null,
  startedAtMs: 0,
}

const CODEX: TerminalTab = {
  ...CLAUDE,
  sessionId: 'term-2',
  agentId: 'codex',
  agentName: 'Codex',
  cwd: 'C:\\work\\library',
  command: 'codex',
}

/** Put the dock where a user would find it: those tabs open, the first one in front. */
function openDock(tabs: TerminalTab[], activeId = tabs[0]?.sessionId ?? null): void {
  useTerminalStore.setState({
    tabs,
    activeId,
    expanded: true,
    maximized: false,
    buffered: {},
    exits: {},
  })
}

/** The element the first of the mounted emulators paints into. */
function terminal(): HTMLElement {
  const element = document.querySelector<HTMLElement>('.xterm')
  if (!element) throw new Error('the dock mounted no terminal')
  return element
}

/** The dock's own row for its terminals, found from the emulator outwards. */
function dockBody(element: HTMLElement): HTMLElement {
  const body = element.closest<HTMLElement>('.absolute')?.parentElement?.parentElement
  if (!body) throw new Error('the dock gave the terminals no body')
  return body
}

/**
 * The element the dock gives the terminals their height with — collapsing is a height of zero,
 * and a maximized dock has no height of its own to give.
 */
function bodyOf(element: HTMLElement): HTMLElement {
  const body = dockBody(element)
  if (body.style.height === '') throw new Error('the dock did not size the terminal body')
  return body
}

function renderDock() {
  return renderWithProviders(<TerminalDock onNew={() => undefined} />)
}

afterEach(() => {
  // The emulators are keyed by session and live outside React, so a case hands its own back: the
  // store no longer listing the tab is what makes the unmount release it.
  useTerminalStore.setState({
    tabs: [],
    activeId: null,
    expanded: false,
    maximized: false,
    buffered: {},
    exits: {},
  })
  // Every case counts the calls it makes, so none of them passes on the strength of the case
  // before it: "closes all of them" has to mean two calls, not three minus one.
  vi.clearAllMocks()
  cleanup()
  disposeTerminal(CLAUDE.sessionId)
  disposeTerminal(CODEX.sessionId)
})

describe('TerminalDock', () => {
  it('mounts no terminal while no session is open', () => {
    const { container } = renderDock()

    // Nothing to show: no tab, and no emulator behind one.
    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(container.querySelector('.xterm')).toBeNull()
  })

  it('shows one tab per session and only the active session on screen', () => {
    openDock([CLAUDE, CODEX], CODEX.sessionId)
    renderDock()

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(2)
    expect(tabs[0]).toHaveTextContent('Claude Code')
    expect(tabs[1]).toHaveTextContent('Codex')
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')

    // Every tab keeps its own body mounted — that is what lets a background agent go on painting —
    // and only the active one is on screen. The class is the contract here: the inactive emulator
    // is hidden rather than taken down.
    const surfaces = Array.from(document.querySelectorAll<HTMLElement>('.xterm')).map((element) =>
      element.closest<HTMLElement>('.absolute'),
    )
    expect(surfaces).toHaveLength(2)
    expect(surfaces[0]).toHaveClass('invisible')
    expect(surfaces[1]).not.toHaveClass('invisible')
  })

  it('keeps every terminal mounted and takes only the height away when collapsed', async () => {
    const user = userEvent.setup()
    openDock([CLAUDE])
    renderDock()

    const element = terminal()
    expect(bodyOf(element).style.height).not.toBe('0px')

    await user.click(screen.getByRole('button', { name: 'Collapse the terminal' }))

    // Collapsed means zero height, not unmounted: the element is the same one, still in the
    // document, and the emulator behind it was never rebuilt.
    expect(bodyOf(element).style.height).toBe('0px')
    expect(element.isConnected).toBe(true)
    // …and it is that very element: a structural match would also accept a rebuilt emulator.
    const mounted = Array.from(document.querySelectorAll('.xterm'))
    expect(mounted).toHaveLength(1)
    expect(mounted[0]).toBe(element)
  })

  it('hands the keyboard back while the dock is collapsed', () => {
    openDock([CLAUDE])
    renderDock()

    const element = terminal()
    // Open, the terminal is where the keys go…
    expect(element.contains(document.activeElement)).toBe(true)

    // …and closed, it must not be: a hidden terminal that still owned the focus would swallow
    // every key the rest of the app expects. `fireEvent.click` dispatches the click alone — a real
    // click would move the focus to the button and hide what the terminal itself does with it.
    fireEvent.click(screen.getByRole('button', { name: 'Collapse the terminal' }))
    expect(element.contains(document.activeElement)).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Expand the terminal' }))
    expect(element.contains(document.activeElement)).toBe(true)
  })

  it('closes the tab it is asked to and tells the backend', async () => {
    const user = userEvent.setup()
    openDock([CLAUDE, CODEX], CODEX.sessionId)
    renderDock()

    const [, codexTerminal] = Array.from(document.querySelectorAll('.xterm'))
    await user.click(screen.getByRole('button', { name: "Close Claude Code's terminal" }))

    // The user asked for the tab to go, so it goes at once — and the PTY behind it is ended too.
    expect(backend.closeTerminal).toHaveBeenCalledWith(CLAUDE.sessionId)
    // The row leaves with its exit animation, so it is off the strip a moment after the click.
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1))
    expect(screen.getByRole('tab')).toHaveTextContent('Codex')

    // The tab that stayed keeps its own terminal, untouched.
    const mounted = Array.from(document.querySelectorAll('.xterm'))
    expect(mounted).toHaveLength(1)
    expect(mounted[0]).toBe(codexTerminal)
  })

  it('leaves nothing behind when the last tab is closed', async () => {
    const user = userEvent.setup()
    openDock([CLAUDE])
    const { container } = renderDock()

    await user.click(screen.getByRole('button', { name: "Close Claude Code's terminal" }))

    expect(backend.closeTerminal).toHaveBeenCalledWith(CLAUDE.sessionId)
    await waitFor(() => expect(screen.queryAllByRole('tab')).toHaveLength(0))
    expect(container.querySelector('.xterm')).toBeNull()
  })

  it('shows a tab whose session is gone as finished, not as one still taking keys', () => {
    openDock([CLAUDE])
    renderDock()

    // This is what `lib/session.ts` (and the PTY's own `not_found`) does when the backend no longer
    // holds a session: the tab must admit it is over instead of swallowing keystrokes for ever.
    act(() => useTerminalStore.getState().finish(CLAUDE.sessionId, null))

    expect(screen.getByText('Process exited with code —')).toBeInTheDocument()
    expect(screen.getByRole('tab')).toHaveTextContent('—')
    // The strip the end of a session takes belongs to the tab, with the way out of it.
    expect(screen.getByRole('button', { name: 'Start again' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close tab' })).toBeInTheDocument()

    // The screen the agent painted stays where it is: the last rows printed are the ones to read.
    expect(terminal()).toBeInTheDocument()
  })

  it('keeps the tab strip on screen while the terminal body is hidden', async () => {
    const user = userEvent.setup()
    openDock([CLAUDE, CODEX])
    renderDock()

    const strip = screen.getByRole('tablist')
    await user.click(screen.getByRole('button', { name: 'Collapse the terminal' }))

    expect(bodyOf(terminal()).style.height).toBe('0px')
    // The very same strip, not a rebuilt one: the tabs stay visible and switchable above a body
    // that is out of the way.
    expect(screen.getByRole('tablist')).toBe(strip)
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Expand the terminal' })).toHaveAttribute(
      'aria-expanded',
      'false',
    )
  })

  it('fills the window when maximized, and gives the same terminals back', async () => {
    const user = userEvent.setup()
    openDock([CLAUDE, CODEX])
    renderDock()

    const element = terminal()
    expect(bodyOf(element).style.height).toBe('320px')

    await user.click(screen.getByRole('button', { name: 'Maximize the terminal' }))

    // The height is the window's now, so the drag handle that sets it goes with it…
    expect(useTerminalStore.getState().maximized).toBe(true)
    expect(screen.queryByRole('separator')).toBeNull()
    expect(dockBody(element).style.height).toBe('')
    // …the dock is the column's flexible row, so the screen above it has somewhere to go…
    expect(dockBody(element)).toHaveClass('flex-1')
    expect(element.closest('section')).toHaveClass('flex-1')
    // …and the terminal on screen is the very one it was: maximizing is room, not a rebuild.
    expect(terminal()).toBe(element)

    await user.click(screen.getByRole('button', { name: 'Restore the terminal' }))

    expect(useTerminalStore.getState().maximized).toBe(false)
    expect(screen.getByRole('separator')).toBeInTheDocument()
    expect(bodyOf(element).style.height).toBe('320px')
    expect(terminal()).toBe(element)
  })

  it('ends every session at once, and only once it has been asked', async () => {
    const user = userEvent.setup()
    openDock([CLAUDE, CODEX])
    renderDock()

    await user.click(screen.getByRole('button', { name: 'Close all terminals' }))

    // An agent in another tab is work in progress: the question comes first, and nothing is ended
    // while it is open.
    expect(backend.closeTerminal).not.toHaveBeenCalled()
    expect(screen.getByText('Close every terminal?')).toBeInTheDocument()
    expect(
      screen.getByText(
        'All 2 open sessions end and every agent running in one stops. Their scrollback goes too.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(backend.closeTerminal).not.toHaveBeenCalled()
    expect(screen.queryByText('Close every terminal?')).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Close all terminals' }))
    await user.click(screen.getByRole('button', { name: 'Close all' }))

    // Every tab goes and every PTY behind it is told, not just the one in front.
    expect(backend.closeTerminal).toHaveBeenCalledTimes(2)
    expect(backend.closeTerminal).toHaveBeenCalledWith(CLAUDE.sessionId)
    expect(backend.closeTerminal).toHaveBeenCalledWith(CODEX.sessionId)
    await waitFor(() => expect(screen.queryAllByRole('tab')).toHaveLength(0))
    // The last tab takes the dock, and the maximized mode with it.
    expect(useTerminalStore.getState().expanded).toBe(false)
  })
})
