/**
 * The dock: one row per workspace, the panes of the active one, and the layout arranging them.
 *
 * What this guards against is an arrangement that costs an agent — a fold that closes one, a pane
 * that takes a second session, a close that fires without asking — and a keyboard that lands in a
 * pane nobody is looking at. The emulator is the real one, stubbed the way `TerminalView.test.tsx`
 * stubs it: jsdom has neither `ResizeObserver` nor `matchMedia`, which xterm asks for once on
 * `open`.
 */

import { useState } from 'react'
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Agent } from '@/shared/bindings/Agent'
import type { TerminalSession } from '@/shared/bindings/TerminalSession'
import { renderWithProviders } from '@/test/render'
import { emptyScanReport } from '@/test/fixtures'

import { disposeTerminal } from '../lib/terminals'
import { useTerminalStore, type TerminalSessionState, type TerminalWorkspace } from '../store'
import { NewTerminalDialog } from './NewTerminalDialog'
import { TerminalDock } from './TerminalDock'

/** The backend calls the dock's tree makes; everything else is never reached by these cases. */
const backend = vi.hoisted(() => ({
  closeTerminal: vi.fn((_sessionId: string): Promise<boolean> => Promise.resolve(true)),
  writeTerminal: vi.fn((): Promise<void> => Promise.resolve()),
  resizeTerminal: vi.fn((): Promise<void> => Promise.resolve()),
  launchTerminal: vi.fn((): Promise<TerminalSession> => Promise.reject(new Error('not stubbed'))),
}))

vi.mock('@/shared/api/ipc', () => ({ ipc: backend }))

const AGENT: Agent = {
  id: 'claude-code',
  name: 'Claude Code',
  description: 'An agent',
  icon: 'claude',
  features: [],
  popular: true,
  status: 'installed',
  binaryPath: '/usr/local/bin/claude',
  version: { raw: '1.0.0', major: 1, minor: 0, patch: 0, comparable: true },
  installOptions: [],
  canInstall: false,
  canUpdate: false,
  canUninstall: false,
  configs: [],
  facts: [],
  skills: [],
  mcpServers: [],
  other: [],
  extensions: [],
  extensionsSupported: false,
  unverified: [],
  manifestSource: { kind: 'builtin' },
  removal: 'manifest',
  warnings: [],
  scanMs: 0,
}

const REPORT = { ...emptyScanReport, agents: [AGENT], installed: 1 }

vi.mock('@/features/agents/api/queries', () => ({
  useAgents: () => ({ data: REPORT }),
  useFavoriteAgents: () => [],
}))

/** The terminal's colours and the dialog's catalog are the window's own state. */
vi.mock('@/features/settings/api/hooks', () => ({
  useSettings: () => ({ data: { terminalTheme: 'auto' } }),
}))

/** jsdom has no `ResizeObserver`, and a pane fits itself on every resize of its host. */
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

const CODEX: TerminalSessionState = {
  ...CLAUDE,
  sessionId: 'term-2',
  agentId: 'codex',
  agentName: 'Codex',
  cwd: '/home/me/library',
  command: 'codex',
}

const GEMINI: TerminalSessionState = {
  ...CLAUDE,
  sessionId: 'term-3',
  agentId: 'gemini-cli',
  agentName: 'Gemini CLI',
  cwd: '/home/me/api',
  command: 'gemini',
}

/** What the backend answers when a session is started from the dialog. */
const LAUNCHED: TerminalSession = {
  id: 'term-9',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  cwd: 'C:\\work\\ahabby',
  shell: 'pwsh',
  command: 'claude',
  cols: 80,
  rows: 24,
  running: true,
  exitCode: null,
  startedAtMs: 0,
}

/** One pane holding one session. */
const SINGLE: TerminalWorkspace = {
  id: 'w1',
  layout: 'single',
  panes: [{ id: 'p1', sessionId: 'term-1' }],
  activePaneId: 'p1',
  sizes: { x: 0.5, y: 0.5 },
}

/** Two panes side by side, each with an agent of its own. */
const COLUMNS: TerminalWorkspace = {
  ...SINGLE,
  layout: 'columns',
  panes: [
    { id: 'p1', sessionId: 'term-1' },
    { id: 'p2', sessionId: 'term-2' },
  ],
}

/** A grid with one agent in it and three panes waiting for one. */
const GRID: TerminalWorkspace = {
  ...SINGLE,
  layout: 'grid',
  panes: [
    { id: 'p1', sessionId: 'term-1' },
    { id: 'p2', sessionId: null },
    { id: 'p3', sessionId: null },
    { id: 'p4', sessionId: null },
  ],
}

/** A workspace beside the others, with an agent of its own, so a case can have two rows. */
const SIDE: TerminalWorkspace = {
  id: 'w2',
  layout: 'single',
  panes: [{ id: 'p5', sessionId: 'term-3' }],
  activePaneId: 'p5',
  sizes: { x: 0.5, y: 0.5 },
}

/** Put the dock where the user left it: those workspaces, those sessions, that focus. */
function openDock(
  workspaces: TerminalWorkspace[],
  sessions: Record<string, TerminalSessionState>,
  activeId = workspaces[0]?.id ?? null,
): void {
  useTerminalStore.setState({
    sessions,
    workspaces,
    activeId,
    expanded: true,
    maximized: false,
    buffered: {},
    exits: {},
  })
}

/** The dock as the shell wires it: the panel, and the dialog it asks for a session with. */
function DockWithDialog() {
  const [request, setRequest] = useState<{ into?: { paneId: string; cwd: string } } | null>(null)

  return (
    <>
      <TerminalDock onNew={(into) => setRequest({ into })} />
      {request ? (
        <NewTerminalDialog
          catalog={{ options: [], defaultCwd: '/home/me' }}
          into={request.into}
          onOpenChange={() => setRequest(null)}
        />
      ) : null}
    </>
  )
}

/** Every pane's canvas, in slot order. */
function emulators(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>('.xterm'))
}

/** The row of the strip that names a workspace. */
function rows(): HTMLElement[] {
  return screen.getAllByRole('tab')
}

/** A promise whose resolver the case holds, so a mutation can be caught in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  // `Promise.withResolvers` is ES2024 and this repo's `lib` is ES2022.
  let resolve: (value: T) => void = () => undefined
  const promise = new Promise<T>((settle) => {
    resolve = settle
  })
  return { promise, resolve: (value: T) => resolve(value) }
}

/** The element the dock gives its panes their height with — collapsing is a height of zero. */
function bodyOf(element: HTMLElement): HTMLElement {
  for (let node = element.parentElement; node; node = node.parentElement) {
    if (node.style.height !== '') return node
  }
  throw new Error('the dock did not size the panes')
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
  vi.clearAllMocks()
  cleanup()
  disposeTerminal(CLAUDE.sessionId)
  disposeTerminal(CODEX.sessionId)
  disposeTerminal(LAUNCHED.id)
})

describe('TerminalDock', () => {
  it('mounts no terminal while no workspace is open', () => {
    const { container } = renderWithProviders(<DockWithDialog />)

    expect(screen.queryAllByRole('tab')).toHaveLength(0)
    expect(container.querySelector('.xterm')).toBeNull()
  })

  it('names one row per workspace, and how many panes it holds', () => {
    openDock([COLUMNS, SIDE], { 'term-1': CLAUDE, 'term-2': CODEX, 'term-3': GEMINI }, 'w1')
    renderWithProviders(<DockWithDialog />)

    const [first, second] = rows()
    expect(rows()).toHaveLength(2)
    // The row names what the window shows — the focused pane of the workspace — …
    expect(first).toHaveTextContent('Claude Code')
    expect(second).toHaveTextContent('Gemini CLI')
    // …and says how much else is behind it.
    expect(within(first as HTMLElement).getByText('2')).toBeInTheDocument()
    expect(within(second as HTMLElement).queryByText('2')).toBeNull()
  })

  it('lays a grid out with a pane per slot, and a divider on each axis', () => {
    openDock([GRID], { 'term-1': CLAUDE })
    renderWithProviders(<DockWithDialog />)

    // Four panes: the one holding the session paints a terminal, the three waiting offer one, and
    // every cell of a grid is labelled — the strip says the cell is empty, the middle invites an
    // agent in, and neither says it twice.
    expect(emulators()).toHaveLength(1)
    for (const label of screen.getAllByText('This pane is empty')) {
      expect(label.closest('.border-dashed')).toBeNull()
    }
    expect(
      screen.getAllByText('Start an agent here, or fold the layout to give the room back.'),
    ).toHaveLength(3)
    expect(screen.getAllByRole('button', { name: 'Start an agent here' })).toHaveLength(3)
    // A grid is cut on both axes; a `columns` workspace only one — that is what tells them apart.
    const dividers = screen.getAllByRole('separator', { name: 'Resize the panes' })
    expect(dividers.map((divider) => divider.getAttribute('aria-orientation')).sort()).toEqual([
      'horizontal',
      'vertical',
    ])
  })

  it('hands the keyboard to the focused pane alone, and follows a press', () => {
    openDock([COLUMNS], { 'term-1': CLAUDE, 'term-2': CODEX })
    renderWithProviders(<DockWithDialog />)

    const [first, second] = emulators()
    expect(first?.contains(document.activeElement)).toBe(true)
    expect(second?.contains(document.activeElement)).toBe(false)

    act(() => {
      fireEvent.pointerDown(screen.getByText('Codex'))
    })

    // The press moves the focus of the workspace, and the keyboard goes with it.
    expect(useTerminalStore.getState().workspaces[0]?.activePaneId).toBe('p2')
    expect(emulators()[1]?.contains(document.activeElement)).toBe(true)
    expect(emulators()[0]?.contains(document.activeElement)).toBe(false)
  })

  it('starts an agent in the pane that asked for it', async () => {
    const user = userEvent.setup()
    backend.launchTerminal.mockResolvedValue(LAUNCHED)
    openDock([GRID], { 'term-1': CLAUDE })
    renderWithProviders(<DockWithDialog />)

    await user.click(
      screen.getAllByRole('button', { name: 'Start an agent here' })[0] as HTMLElement,
    )

    // The dialog opens on the pane's own directory, so four panes in one project are not four
    // paths to type.
    expect(screen.getByLabelText('Working directory')).toHaveValue(CLAUDE.cwd)

    await user.click(screen.getByRole('button', { name: 'Open terminal' }))

    // The session lands in the pane that asked for it: no second workspace, no reshuffle.
    const state = useTerminalStore.getState()
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]?.panes.map((pane) => pane.sessionId)).toEqual([
      'term-1',
      'term-9',
      null,
      null,
    ])
  })

  it('refuses a fold that would leave an agent behind', () => {
    openDock([COLUMNS], { 'term-1': CLAUDE, 'term-2': CODEX })
    renderWithProviders(<DockWithDialog />)

    const fold = screen.getByRole('button', { name: 'One pane' })
    expect(fold).toBeDisabled()
    // A button that cannot be pressed still says why.
    expect(fold).toHaveAttribute('title', 'Close 1 agent to fold to this layout')
    // …while the layout the workspace can afford stays available.
    expect(screen.getByRole('button', { name: 'Four panes' })).toBeEnabled()
  })

  it('asks before it closes a workspace of several agents', async () => {
    const user = userEvent.setup()
    openDock([COLUMNS], { 'term-1': CLAUDE, 'term-2': CODEX })
    renderWithProviders(<DockWithDialog />)

    await user.click(screen.getByRole('button', { name: 'Close this workspace' }))

    expect(backend.closeTerminal).not.toHaveBeenCalled()
    expect(screen.getByText('Close every agent in this workspace?')).toBeInTheDocument()
    expect(
      screen.getByText('All 2 sessions end and their scrollback goes with them.'),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close them all' }))

    expect(backend.closeTerminal).toHaveBeenCalledTimes(2)
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-1')
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-2')
    await waitFor(() => expect(screen.queryAllByRole('tab')).toHaveLength(0))
  })

  it('closes a workspace of one agent without asking', async () => {
    const user = userEvent.setup()
    openDock([SINGLE], { 'term-1': CLAUDE })
    renderWithProviders(<DockWithDialog />)

    await user.click(screen.getByRole('button', { name: 'Close this workspace' }))

    // One agent is the tab the user is looking at: there is nothing to weigh up.
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-1')
    expect(screen.queryByText('Close every agent in this workspace?')).toBeNull()
  })

  it('starts a finished agent again in its own pane, once per press', async () => {
    const user = userEvent.setup()
    // The launch is held open, so the press can be repeated while it is in flight.
    const launch = deferred<TerminalSession>()
    backend.launchTerminal.mockImplementation(() => launch.promise)
    openDock([SINGLE], { 'term-1': { ...CLAUDE, running: false, exitCode: 0 } })
    renderWithProviders(<DockWithDialog />)

    const again = screen.getByRole('button', { name: 'Start again' })
    await user.click(again)

    // One press, one agent: the button is out of action until the backend answers, or a second
    // press would start an agent the pane can never show.
    expect(backend.launchTerminal).toHaveBeenCalledTimes(1)
    expect(again).toBeDisabled()

    await act(async () => {
      launch.resolve(LAUNCHED)
      await Promise.resolve()
    })

    // The workspace survives — a one-pane dock would otherwise go away with the session it just
    // ended — and the new agent takes the pane the dead one had.
    const state = useTerminalStore.getState()
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]?.panes[0]?.sessionId).toBe('term-9')
    expect(Object.keys(state.sessions)).toEqual(['term-9'])
    expect(screen.getAllByRole('tab')).toHaveLength(1)
  })

  it('keeps every pane mounted and hands the keyboard back when collapsed', async () => {
    const user = userEvent.setup()
    openDock([COLUMNS], { 'term-1': CLAUDE, 'term-2': CODEX })
    renderWithProviders(<DockWithDialog />)

    const [first, second] = emulators()
    const body = bodyOf(first as HTMLElement)
    expect(body.style.height).not.toBe('0px')
    expect(first?.contains(document.activeElement)).toBe(true)

    await user.click(screen.getByRole('button', { name: 'Collapse the terminal' }))

    expect(body.style.height).toBe('0px')
    // Both panes are still there — a background agent keeps painting into its own scrollback —
    // and the collapsed dock no longer holds the keyboard, which is not its to keep.
    expect(emulators()).toHaveLength(2)
    expect(emulators()[0]).toBe(first)
    expect(emulators()[1]).toBe(second)
    expect(first?.contains(document.activeElement)).toBe(false)

    await user.click(screen.getByRole('button', { name: 'Expand the terminal' }))

    // …and unfolding it gives the keyboard back to the pane that had it.
    expect(emulators()[0]?.contains(document.activeElement)).toBe(true)
  })

  it('fills the window when maximized, and gives the same panes back', async () => {
    const user = userEvent.setup()
    openDock([COLUMNS], { 'term-1': CLAUDE, 'term-2': CODEX })
    renderWithProviders(<DockWithDialog />)

    const [first] = emulators()
    expect(screen.getByRole('separator', { name: 'Resize the terminal' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Maximize the terminal' }))

    expect(useTerminalStore.getState().maximized).toBe(true)
    // The height is the window's now, so the handle that sets it goes with it.
    expect(screen.queryByRole('separator', { name: 'Resize the terminal' })).toBeNull()
    expect(emulators()[0]).toBe(first)

    await user.click(screen.getByRole('button', { name: 'Restore the terminal' }))

    expect(useTerminalStore.getState().maximized).toBe(false)
    expect(screen.getByRole('separator', { name: 'Resize the terminal' })).toBeInTheDocument()
  })

  it('ends every session of every workspace at once, once it is asked', async () => {
    const user = userEvent.setup()
    openDock([COLUMNS, SIDE], { 'term-1': CLAUDE, 'term-2': CODEX, 'term-3': GEMINI })
    renderWithProviders(<DockWithDialog />)

    await user.click(screen.getByRole('button', { name: 'Close all terminals' }))

    expect(backend.closeTerminal).not.toHaveBeenCalled()
    expect(
      screen.getByText(
        'All 3 open sessions end and every agent running in one stops. Their scrollback goes too.',
      ),
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Close all' }))

    expect(backend.closeTerminal).toHaveBeenCalledWith('term-1')
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-2')
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-3')
    await waitFor(() => expect(screen.queryAllByRole('tab')).toHaveLength(0))
  })

  it('writes the fraction a divider is dragged to', () => {
    openDock([COLUMNS], { 'term-1': CLAUDE, 'term-2': CODEX })
    renderWithProviders(<DockWithDialog />)
    // jsdom lays nothing out, so the container has to say how wide it is.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      right: 400,
      bottom: 200,
      width: 400,
      height: 200,
      toJSON: () => ({}),
    })

    const divider = screen.getByRole('separator', { name: 'Resize the panes' })
    fireEvent.pointerDown(divider, { clientX: 200 })
    fireEvent.pointerMove(window, { clientX: 300 })
    fireEvent.pointerUp(window)

    // Three quarters of the way across a 400px grid.
    expect(useTerminalStore.getState().workspaces[0]?.sizes.x).toBe(0.75)
  })
})
