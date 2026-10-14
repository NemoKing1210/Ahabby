import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalSession } from '@/shared/bindings/TerminalSession'

import { base64ToBytes } from './lib/base64'
import {
  reconcileTerminalSessions,
  registerTerminal,
  unregisterTerminal,
  writeTerminalOutput,
} from './lib/session'
import { useTerminalStore, type TerminalSessionState, type TerminalWorkspace } from './store'

/** The backend calls these cases can reach; everything else in the dock's tree is never used. */
const backend = vi.hoisted(() => ({
  listTerminalSessions: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  closeTerminal: vi.fn((_sessionId: string): Promise<boolean> => Promise.resolve(true)),
}))

vi.mock('@/shared/api/ipc', () => ({ ipc: backend }))

/** What `ipc.launchTerminal` answers for a session. */
function session(id: string, overrides: Partial<TerminalSession> = {}): TerminalSession {
  return {
    id,
    agentId: 'claude-code',
    agentName: 'Claude Code',
    cwd: '/home/me/project',
    shell: 'zsh',
    command: "'/usr/local/bin/claude'",
    cols: 80,
    rows: 24,
    running: true,
    exitCode: null,
    startedAtMs: 1,
    ...overrides,
  }
}

function encoded(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** The record the store keeps for `term-1`, as `open` writes it. */
const CLAUDE: TerminalSessionState = {
  sessionId: 'term-1',
  agentId: 'claude-code',
  agentName: 'Claude Code',
  cwd: '/home/me/project',
  shell: 'zsh',
  command: "'/usr/local/bin/claude'",
  running: true,
  exitCode: null,
  startedAtMs: 1,
}

const CODEX: TerminalSessionState = {
  ...CLAUDE,
  sessionId: 'term-2',
  agentId: 'codex',
  agentName: 'Codex',
  cwd: '/home/me/library',
}

/** A grid with a session in its first pane — the shape the fold cases start from. */
const GRID: TerminalWorkspace = {
  id: 'w1',
  layout: 'grid',
  panes: [
    { id: 'p1', sessionId: 'term-1' },
    { id: 'p2', sessionId: null },
    { id: 'p3', sessionId: null },
    { id: 'p4', sessionId: null },
  ],
  activePaneId: 'p1',
  sizes: { x: 0.5, y: 0.5 },
}

/** The same grid with a third-pane session as well, and the focus on an empty pane. */
const SPLIT: TerminalWorkspace = {
  ...GRID,
  panes: [
    { id: 'p1', sessionId: 'term-1' },
    { id: 'p2', sessionId: null },
    { id: 'p3', sessionId: 'term-2' },
    { id: 'p4', sessionId: null },
  ],
  activePaneId: 'p4',
}

/** A grid with a session in the first pane and the keyboard in an empty pane near the tail. */
const GRID_TAIL_FOCUS: TerminalWorkspace = { ...GRID, activePaneId: 'p4' }

/** The same grid with a session in every pane — a layout that cannot fold smaller. */
const FULL: TerminalWorkspace = {
  ...GRID,
  panes: [
    { id: 'p1', sessionId: 'term-1' },
    { id: 'p2', sessionId: 'term-2' },
    { id: 'p3', sessionId: 'term-3' },
    { id: 'p4', sessionId: 'term-4' },
  ],
}

/** A second workspace beside the grid, holding a session of its own. */
const SIDE: TerminalWorkspace = {
  id: 'w2',
  layout: 'single',
  panes: [{ id: 'p5', sessionId: 'term-2' }],
  activePaneId: 'p5',
  sizes: { x: 0.5, y: 0.5 },
}

/** Put the store where the dock left it: those workspaces, those sessions, that focus. */
function seed(
  workspaces: TerminalWorkspace[],
  sessions: Record<string, TerminalSessionState>,
): void {
  useTerminalStore.setState({
    sessions,
    workspaces,
    activeId: workspaces[0]?.id ?? null,
    expanded: true,
    maximized: false,
    buffered: {},
    exits: {},
  })
}

describe('workspaces and panes', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: {},
      workspaces: [],
      activeId: null,
      expanded: false,
      maximized: false,
      buffered: {},
      exits: {},
    })
  })

  it('opens a session into a workspace of its own', () => {
    useTerminalStore.getState().open(session('term-1'))

    const state = useTerminalStore.getState()
    expect(state.workspaces).toHaveLength(1)

    const [workspace] = state.workspaces
    expect(workspace?.layout).toBe('single')
    expect(workspace?.panes).toHaveLength(1)
    expect(workspace?.panes[0]?.sessionId).toBe('term-1')
    // The pane the keyboard is in is the only one there is, and the tab is the active one.
    expect(workspace?.activePaneId).toBe(workspace?.panes[0]?.id)
    expect(state.activeId).toBe(workspace?.id)
    expect(state.expanded).toBe(true)
    expect(state.sessions['term-1']).toEqual(CLAUDE)
  })

  it('opens the next session as the next workspace', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.open(session('term-2', { agentName: 'Codex' }))

    const state = useTerminalStore.getState()
    expect(state.workspaces).toHaveLength(2)
    expect(state.workspaces[1]?.panes[0]?.sessionId).toBe('term-2')
    // A session opened from the rail or an agent page comes to the front, as the tab did.
    expect(state.activeId).toBe(state.workspaces[1]?.id)
  })

  it('opens a session into the pane that asked for it', () => {
    seed([GRID], { 'term-1': CLAUDE })

    useTerminalStore.getState().open(session('term-2', { agentName: 'Codex' }), { paneId: 'p2' })

    const state = useTerminalStore.getState()
    // The arrangement stands: no workspace is added, the pane it was addressed to is filled.
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]?.panes.map((pane) => pane.sessionId)).toEqual([
      'term-1',
      'term-2',
      null,
      null,
    ])
    // …and the pane it went into is the one the keyboard is in.
    expect(state.workspaces[0]?.activePaneId).toBe('p2')
    expect(state.activeId).toBe('w1')
    expect(state.sessions['term-2']?.agentName).toBe('Codex')
  })

  it('leaves a pane that already holds a session alone', () => {
    seed([GRID], { 'term-1': CLAUDE })
    const before = useTerminalStore.getState().workspaces

    useTerminalStore.getState().open(session('term-2'), { paneId: 'p1' })

    // One pane, one session: a second one would mean two emulators sharing one host element.
    const state = useTerminalStore.getState()
    expect(state.workspaces).toBe(before)
    expect(state.sessions['term-2']).toBeUndefined()
  })

  it('applies an exit that arrived before its pane', () => {
    const store = useTerminalStore.getState()
    // The process can end before React has painted the pane it belongs to.
    store.finish('term-1', 1)
    store.open(session('term-1'))

    expect(useTerminalStore.getState().sessions['term-1']).toMatchObject({
      running: false,
      exitCode: 1,
    })

    // …and an exit with no code at all is remembered just the same.
    store.finish('term-2', null)
    store.open(session('term-2'))
    expect(useTerminalStore.getState().sessions['term-2']).toMatchObject({
      running: false,
      exitCode: null,
    })
  })

  it('puts a session into a pane in place of the one that was there', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    const [workspace] = useTerminalStore.getState().workspaces
    const paneId = workspace?.panes[0]?.id ?? ''

    store.replaceSession(paneId, session('term-9', { agentName: 'Restarted' }))

    // The workspace is the one it was — closing the dead session first would have taken a one-pane
    // workspace with it — and the agent that came back holds the pane.
    const state = useTerminalStore.getState()
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]?.panes[0]?.sessionId).toBe('term-9')
    expect(Object.keys(state.sessions)).toEqual(['term-9'])
    expect(state.sessions['term-9']?.agentName).toBe('Restarted')

    // A pane that does not exist is not a place to put a session.
    store.replaceSession('nope', session('term-8'))
    expect(useTerminalStore.getState().sessions['term-8']).toBeUndefined()
  })

  it('moves the focus to the pane it is asked for', () => {
    seed([GRID], { 'term-1': CLAUDE })
    const store = useTerminalStore.getState()

    store.focusPane('p3')
    expect(useTerminalStore.getState().workspaces[0]?.activePaneId).toBe('p3')

    store.focusPane('nope')
    expect(useTerminalStore.getState().workspaces[0]?.activePaneId).toBe('p3')
  })

  it('moves the focus by slot, for the keyboard', () => {
    seed([GRID], { 'term-1': CLAUDE })
    const store = useTerminalStore.getState()

    store.focusPaneAt(2)
    expect(useTerminalStore.getState().workspaces[0]?.activePaneId).toBe('p2')

    // A slot the workspace does not have is not an error, it is nothing to do.
    store.focusPaneAt(9)
    expect(useTerminalStore.getState().workspaces[0]?.activePaneId).toBe('p2')
  })

  it('records an exit against the session it belongs to', () => {
    useTerminalStore.getState().open(session('term-1'))

    useTerminalStore.getState().finish('term-1', 3)

    const state = useTerminalStore.getState()
    expect(state.sessions['term-1']).toMatchObject({ running: false, exitCode: 3 })
    expect(state.exits['term-1']).toBe(3)
  })
})

describe('layouts', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: { 'term-1': CLAUDE, 'term-2': CODEX },
      workspaces: [],
      activeId: null,
      expanded: true,
      maximized: false,
      buffered: {},
      exits: {},
    })
  })

  it('grows a workspace into the layout it is asked for', () => {
    seed(
      [
        {
          id: 'w1',
          layout: 'single',
          panes: [{ id: 'p1', sessionId: 'term-1' }],
          activePaneId: 'p1',
          sizes: { x: 0.5, y: 0.5 },
        },
      ],
      {
        'term-1': CLAUDE,
      },
    )

    useTerminalStore.getState().setLayout('grid')

    const [workspace] = useTerminalStore.getState().workspaces
    expect(workspace?.layout).toBe('grid')
    expect(workspace?.panes).toHaveLength(4)
    // The session keeps the pane it was in — and that pane keeps its id, so its emulator stays
    // attached to the same host.
    expect(workspace?.panes[0]).toEqual({ id: 'p1', sessionId: 'term-1' })
    expect(workspace?.panes.slice(1).every((pane) => pane.sessionId === null)).toBe(true)
    expect(workspace?.activePaneId).toBe('p1')
  })

  it('refuses a fold that would leave an agent behind', () => {
    seed([FULL], { 'term-1': CLAUDE, 'term-2': CODEX, 'term-3': CLAUDE, 'term-4': CODEX })
    const before = useTerminalStore.getState().workspaces

    useTerminalStore.getState().setLayout('columns')

    // Not a partial fold, not a moved session: the state is the one it was.
    const state = useTerminalStore.getState()
    expect(state.workspaces).toBe(before)
    expect(state.workspaces[0]?.layout).toBe('grid')
  })

  it('compacts the sessions into the first slots when it folds', () => {
    seed([SPLIT], { 'term-1': CLAUDE, 'term-2': CODEX })

    useTerminalStore.getState().setLayout('columns')

    const [workspace] = useTerminalStore.getState().workspaces
    expect(workspace?.layout).toBe('columns')
    expect(workspace?.panes).toEqual([
      { id: 'p1', sessionId: 'term-1' },
      { id: 'p3', sessionId: 'term-2' },
    ])
  })

  it('moves the focus off a pane the fold dropped', () => {
    seed([GRID_TAIL_FOCUS], { 'term-1': CLAUDE })

    useTerminalStore.getState().setLayout('single')

    // p4 was the focused pane and it is gone; p1 is the one that survives with a session in it.
    const [workspace] = useTerminalStore.getState().workspaces
    expect(workspace?.panes).toEqual([{ id: 'p1', sessionId: 'term-1' }])
    expect(workspace?.activePaneId).toBe('p1')
  })

  it('keeps a divider fraction inside the range that stays usable', () => {
    seed([SPLIT], { 'term-1': CLAUDE, 'term-2': CODEX })

    useTerminalStore.getState().setSizes({ x: 0.9 })
    expect(useTerminalStore.getState().workspaces[0]?.sizes).toEqual({ x: 0.85, y: 0.5 })

    useTerminalStore.getState().setSizes({ y: 0.02 })
    expect(useTerminalStore.getState().workspaces[0]?.sizes).toEqual({ x: 0.85, y: 0.15 })
  })
})

describe('closing', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: { 'term-1': CLAUDE, 'term-2': CODEX },
      workspaces: [],
      activeId: null,
      expanded: true,
      maximized: false,
      buffered: {},
      exits: {},
    })
  })

  it('closes one session and leaves the pane standing', () => {
    seed([SPLIT], { 'term-1': CLAUDE, 'term-2': CODEX })
    useTerminalStore.setState({
      buffered: { 'term-1': [new Uint8Array([1])] },
      exits: { 'term-1': 9 },
    })

    useTerminalStore.getState().closeSession('term-1')

    const state = useTerminalStore.getState()
    // The arrangement is untouched — the pane is empty, not gone — and the workspace stands.
    expect(state.workspaces).toHaveLength(1)
    expect(state.workspaces[0]?.layout).toBe('grid')
    expect(state.workspaces[0]?.panes).toEqual([
      { id: 'p1', sessionId: null },
      { id: 'p2', sessionId: null },
      { id: 'p3', sessionId: 'term-2' },
      { id: 'p4', sessionId: null },
    ])
    expect(state.activeId).toBe('w1')
    // The closed session's own leavings go with it, as they did with a tab.
    expect(state.sessions['term-1']).toBeUndefined()
    expect(state.buffered['term-1']).toBeUndefined()
    expect(state.exits['term-1']).toBeUndefined()
  })

  it('takes the workspace when its last session goes', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.open(session('term-2', { agentName: 'Codex' }))
    const [first, second] = useTerminalStore.getState().workspaces
    const closing = second?.panes[0]?.sessionId ?? ''

    store.closeSession(closing)

    const state = useTerminalStore.getState()
    expect(state.workspaces.map((workspace) => workspace.id)).toEqual([first?.id])
    // Closing the tab the window was on moves the window to the one beside it.
    expect(state.activeId).toBe(first?.id)
  })

  it('leaves the dock when the last workspace goes', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.toggleMaximized()

    store.closeSession('term-1')

    const state = useTerminalStore.getState()
    expect(state.workspaces).toHaveLength(0)
    expect(state.activeId).toBeNull()
    // Nothing left to show: the dock goes away, and so does the mode that filled the window.
    expect(state.expanded).toBe(false)
    expect(state.maximized).toBe(false)
  })

  it('hands the window back when the dock is collapsed or emptied', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.toggleMaximized()

    expect(useTerminalStore.getState().maximized).toBe(true)
    // A maximized dock is an open one: there is no such thing as a strip of tabs filling the window.
    expect(useTerminalStore.getState().expanded).toBe(true)

    // Folding it is leaving that mode, not hiding it — the next unfold opens as a dock again.
    store.setExpanded(false)
    expect(useTerminalStore.getState().maximized).toBe(false)
    store.setExpanded(true)
    expect(useTerminalStore.getState().maximized).toBe(false)

    // …and so is closing the last workspace: a maximized dock with nothing in it would be an empty
    // window.
    store.setMaximized(true)
    store.closeSession('term-1')
    const emptied = useTerminalStore.getState()
    expect(emptied.workspaces).toHaveLength(0)
    expect(emptied.maximized).toBe(false)
  })
})

describe('reconciling with the backend', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: {},
      workspaces: [],
      activeId: null,
      expanded: false,
      maximized: false,
      buffered: {},
      exits: {},
    })
    backend.listTerminalSessions.mockReset()
    backend.closeTerminal.mockReset()
    backend.closeTerminal.mockResolvedValue(true)
  })

  it('closes only the sessions no pane can show', async () => {
    seed([GRID, SIDE], { 'term-1': CLAUDE, 'term-2': CODEX })
    // The backend holds both panes' shells and one from before a reload that no pane knows about.
    backend.listTerminalSessions.mockResolvedValue([
      session('term-1'),
      session('term-2'),
      session('term-orphan'),
    ])

    await reconcileTerminalSessions()

    // A shell nobody can reach is closed rather than left running out of sight…
    expect(backend.closeTerminal).toHaveBeenCalledTimes(1)
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-orphan')
    // …and a pane in a workspace the window is not showing is still a pane.
    expect(useTerminalStore.getState().sessions['term-2']?.running).toBe(true)
    expect(useTerminalStore.getState().sessions['term-1']?.running).toBe(true)
  })

  it('finishes a pane whose session the backend no longer holds', async () => {
    seed([GRID, SIDE], { 'term-1': CLAUDE, 'term-2': CODEX })
    backend.listTerminalSessions.mockResolvedValue([])

    await reconcileTerminalSessions()

    // A pane that could never be typed into again must admit it is over instead.
    expect(useTerminalStore.getState().sessions['term-1']).toMatchObject({ running: false })
    expect(useTerminalStore.getState().sessions['term-2']).toMatchObject({ running: false })
  })
})

describe('output buffering', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      sessions: {},
      workspaces: [],
      activeId: null,
      expanded: false,
      maximized: false,
      buffered: {},
      exits: {},
    })
  })

  it('hands a terminal the output that arrived before it was mounted', () => {
    // A session starts printing the moment it is spawned, which is before React paints the pane.
    writeTerminalOutput({ sessionId: 'term-1', data: encoded('PS> ') })

    const received: string[] = []
    registerTerminal('term-1', (data) => received.push(new TextDecoder().decode(data)))
    expect(received).toEqual(['PS> '])

    // Registered terminals are written to directly, without going through the buffer again.
    writeTerminalOutput({ sessionId: 'term-1', data: encoded('claude') })
    expect(received).toEqual(['PS> ', 'claude'])

    unregisterTerminal('term-1')
    writeTerminalOutput({ sessionId: 'term-1', data: encoded('after close') })
    expect(received).toEqual(['PS> ', 'claude'])
    expect(useTerminalStore.getState().buffered['term-1']).toHaveLength(1)
  })
})

describe('base64ToBytes', () => {
  it('decodes exactly the bytes the backend encoded', () => {
    const text = 'привет 👋 \u001b[0m'
    expect(new TextDecoder().decode(base64ToBytes(encoded(text)))).toBe(text)
    expect(base64ToBytes('')).toHaveLength(0)
  })
})
