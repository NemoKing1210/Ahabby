import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalSession } from '@/shared/bindings/TerminalSession'

import { base64ToBytes } from './lib/base64'
import {
  reconcileTerminalSessions,
  registerTerminal,
  unregisterTerminal,
  writeTerminalOutput,
} from './lib/session'
import { useTerminalStore } from './store'

/** The two calls reconciling makes; everything else is never reached by these cases. */
const backend = vi.hoisted(() => ({
  listTerminalSessions: vi.fn((): Promise<unknown[]> => Promise.resolve([])),
  closeTerminal: vi.fn((_sessionId: string): Promise<boolean> => Promise.resolve(true)),
}))

vi.mock('@/shared/api/ipc', () => ({ ipc: backend }))

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

describe('terminal tabs', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      tabs: [],
      activeId: null,
      expanded: false,
      buffered: {},
      exits: {},
    })
  })

  it('opens one tab per session, brings the newest to the front and opens the dock', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.open(session('term-2', { agentName: 'Codex' }))

    const state = useTerminalStore.getState()
    expect(state.tabs.map((tab) => tab.sessionId)).toEqual(['term-1', 'term-2'])
    expect(state.activeId).toBe('term-2')
    expect(state.expanded).toBe(true)

    // Opening a session that is already on screen updates its row instead of duplicating it.
    store.open(session('term-1', { running: false }))
    expect(useTerminalStore.getState().tabs).toHaveLength(2)
  })

  it('collapses on request and expands again when a tab is picked', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.setExpanded(false)
    expect(useTerminalStore.getState().expanded).toBe(false)

    // Choosing a tab is also a request to see it.
    store.activate('term-1')
    expect(useTerminalStore.getState().expanded).toBe(true)

    store.toggleExpanded()
    expect(useTerminalStore.getState().expanded).toBe(false)
  })

  it('keeps a finished tab open until it is closed, and moves the selection on close', () => {
    const store = useTerminalStore.getState()
    store.open(session('term-1'))
    store.open(session('term-2'))

    store.finish('term-2', 3)
    let tabs = useTerminalStore.getState().tabs
    expect(tabs[1]?.running).toBe(false)
    expect(tabs[1]?.exitCode).toBe(3)

    store.close('term-2')
    tabs = useTerminalStore.getState().tabs
    expect(tabs.map((tab) => tab.sessionId)).toEqual(['term-1'])
    expect(useTerminalStore.getState().activeId).toBe('term-1')

    // Closing the last tab takes the dock away with it.
    store.close('term-1')
    expect(useTerminalStore.getState().tabs).toHaveLength(0)
    expect(useTerminalStore.getState().expanded).toBe(false)
  })

  it('hands a terminal the output that arrived before it was mounted', () => {
    // A session starts printing the moment it is spawned, which is before React paints the tab.
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

  it('opens a tab already finished when its process exited first', () => {
    // An agent that refuses to start exits before React has painted the tab it belongs to; a tab
    // that then claims to be running would swallow every keystroke for ever.
    const store = useTerminalStore.getState()
    store.finish('term-1', 1)
    store.open(session('term-1'))

    const tab = useTerminalStore.getState().tabs[0]
    expect(tab?.running).toBe(false)
    expect(tab?.exitCode).toBe(1)

    // …and an exit with no code at all is remembered just the same.
    store.finish('term-2', null)
    store.open(session('term-2'))
    expect(useTerminalStore.getState().tabs[1]?.running).toBe(false)
    expect(useTerminalStore.getState().tabs[1]?.exitCode).toBeNull()

    // Closing a tab forgets its exit, so a long session cannot accumulate them.
    useTerminalStore.getState().close('term-1')
    expect(useTerminalStore.getState().exits['term-1']).toBeUndefined()
  })
})

describe('reconciling with the backend', () => {
  beforeEach(() => {
    useTerminalStore.setState({
      tabs: [],
      activeId: null,
      expanded: false,
      buffered: {},
      exits: {},
    })
    backend.listTerminalSessions.mockReset()
    backend.closeTerminal.mockReset()
    backend.closeTerminal.mockResolvedValue(true)
  })

  it('closes sessions no tab can show and finishes tabs whose session is gone', async () => {
    const store = useTerminalStore.getState()
    store.open(session('term-live'))
    store.open(session('term-dead'))
    // The backend holds one of them plus a shell from before a reload that no tab knows about.
    backend.listTerminalSessions.mockResolvedValue([session('term-live'), session('term-orphan')])

    await reconcileTerminalSessions()

    // A shell nobody can reach is closed rather than left running out of sight…
    expect(backend.closeTerminal).toHaveBeenCalledTimes(1)
    expect(backend.closeTerminal).toHaveBeenCalledWith('term-orphan')
    expect(backend.closeTerminal).not.toHaveBeenCalledWith('term-live')

    // …and a tab whose session is gone stops pretending to be alive.
    const tabs = useTerminalStore.getState().tabs
    expect(tabs.find((tab) => tab.sessionId === 'term-live')?.running).toBe(true)
    expect(tabs.find((tab) => tab.sessionId === 'term-dead')?.running).toBe(false)
  })
})

describe('base64ToBytes', () => {
  it('decodes exactly the bytes the backend encoded', () => {
    const text = 'привет 👋 \u001b[0m'
    expect(new TextDecoder().decode(base64ToBytes(encoded(text)))).toBe(text)
    expect(base64ToBytes('')).toHaveLength(0)
  })
})
