import { beforeEach, describe, expect, it } from 'vitest'

import type { TerminalSession } from '@/shared/bindings/TerminalSession'

import { base64ToBytes } from './lib/base64'
import { registerTerminal, unregisterTerminal, writeTerminalOutput } from './lib/session'
import { useTerminalStore } from './store'

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
    useTerminalStore.setState({ tabs: [], activeId: null, expanded: false, buffered: {} })
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
})

describe('base64ToBytes', () => {
  it('decodes exactly the bytes the backend encoded', () => {
    const text = 'привет 👋 \u001b[0m'
    expect(new TextDecoder().decode(base64ToBytes(encoded(text)))).toBe(text)
    expect(base64ToBytes('')).toHaveLength(0)
  })
})
