/**
 * The terminal's UI state: which tabs are open, which one is on screen, and the output that
 * arrived before a tab's terminal was mounted.
 *
 * Server state lives in React Query and the PTY itself lives in the backend; this store only
 * answers "which tabs does the window show". The tab list is deliberately the *source of truth*
 * for the backend sessions too: anything the backend holds that no tab knows about is closed on
 * startup (see `lib/session.ts`).
 */

import { create } from 'zustand'

import type { TerminalSession } from '@/shared/bindings/TerminalSession'

/** One open terminal tab. */
export interface TerminalTab {
  sessionId: string
  agentId: string
  agentName: string
  /** Directory the shell runs in. */
  cwd: string
  /** The shell the session runs (`pwsh`, `zsh`, …). */
  shell: string
  /** The command line typed into the shell (the agent binary). */
  command: string
  running: boolean
  exitCode: number | null
  startedAtMs: number
}

export function tabFromSession(session: TerminalSession): TerminalTab {
  return {
    sessionId: session.id,
    agentId: session.agentId,
    agentName: session.agentName,
    cwd: session.cwd,
    shell: session.shell,
    command: session.command,
    running: session.running,
    exitCode: session.exitCode ?? null,
    startedAtMs: session.startedAtMs,
  }
}

/**
 * Output held for a tab whose terminal is not mounted yet: a session starts printing the moment
 * it is spawned, which is before React has painted the tab.
 */
const MAX_BUFFERED_CHUNKS = 400

interface TerminalState {
  tabs: TerminalTab[]
  activeId: string | null
  /**
   * Whether the docked panel shows its terminals. Collapsed, the tab strip stays visible and the
   * terminals stay mounted (a background agent keeps its scrollback), but nothing is interactive.
   */
  expanded: boolean
  buffered: Record<string, Uint8Array[]>
  /**
   * Sessions that have already ended, whether or not their tab existed at the time. A process can
   * exit before React has painted the tab it belongs to (an agent that refuses to start, a shell
   * that closes at once); without this the tab would then claim to be running for ever, with
   * nothing behind it.
   */
  exits: Record<string, number | null>
  /** Add a tab (idempotent per session), bring it to the front and open the dock. */
  open: (session: TerminalSession) => void
  activate: (sessionId: string) => void
  /** The process in the session ended; the tab stays until it is closed. */
  finish: (sessionId: string, exitCode: number | null) => void
  /** Forget a tab, whether or not its session still exists. */
  close: (sessionId: string) => void
  setExpanded: (expanded: boolean) => void
  toggleExpanded: () => void
  buffer: (sessionId: string, data: Uint8Array) => void
  takeBuffered: (sessionId: string) => Uint8Array[]
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeId: null,
  expanded: false,
  buffered: {},
  exits: {},

  open: (session) =>
    set((state) => {
      const tab = tabFromSession(session)
      // A tab is only as alive as its process: an exit that arrived before the tab existed is
      // applied the moment the tab does.
      if (Object.hasOwn(state.exits, tab.sessionId)) {
        tab.running = false
        tab.exitCode = state.exits[tab.sessionId] ?? null
      }
      const tabs = state.tabs.some((existing) => existing.sessionId === tab.sessionId)
        ? state.tabs.map((existing) => (existing.sessionId === tab.sessionId ? tab : existing))
        : [...state.tabs, tab]
      return { tabs, activeId: tab.sessionId, expanded: true }
    }),

  activate: (sessionId) =>
    set((state) =>
      state.tabs.some((tab) => tab.sessionId === sessionId)
        ? { activeId: sessionId, expanded: true }
        : state,
    ),

  finish: (sessionId, exitCode) =>
    set((state) => ({
      exits: { ...state.exits, [sessionId]: exitCode },
      tabs: state.tabs.map((tab) =>
        tab.sessionId === sessionId ? { ...tab, running: false, exitCode } : tab,
      ),
    })),

  close: (sessionId) =>
    set((state) => {
      const tabs = state.tabs.filter((tab) => tab.sessionId !== sessionId)
      const { [sessionId]: _dropped, ...buffered } = state.buffered
      const { [sessionId]: _exited, ...exits } = state.exits
      const activeId =
        state.activeId === sessionId ? (tabs[tabs.length - 1]?.sessionId ?? null) : state.activeId
      // No tabs left means nothing to show: the dock goes away entirely.
      return { tabs, buffered, exits, activeId, expanded: tabs.length > 0 && state.expanded }
    }),

  setExpanded: (expanded) => set({ expanded }),

  toggleExpanded: () => set((state) => ({ expanded: !state.expanded })),

  buffer: (sessionId, data) =>
    set((state) => {
      const pending = [...(state.buffered[sessionId] ?? []), data].slice(-MAX_BUFFERED_CHUNKS)
      return { buffered: { ...state.buffered, [sessionId]: pending } }
    }),

  takeBuffered: (sessionId) => {
    const pending = get().buffered[sessionId] ?? []
    if (pending.length > 0) {
      set((state) => {
        const { [sessionId]: _taken, ...buffered } = state.buffered
        return { buffered }
      })
    }
    return pending
  },
}))
