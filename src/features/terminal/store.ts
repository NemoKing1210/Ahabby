/**
 * The terminal's UI state: which workspaces are open, how each of them is split, which panes hold a
 * session, and which pane has the keyboard.
 *
 * Server state lives in React Query and the PTY itself lives in the backend; this store only answers
 * "what does the dock show". The sessions it knows are deliberately the *source of truth* for the
 * backend's too: anything the backend holds that no pane knows about is closed on startup (see
 * `lib/session.ts`).
 *
 * Three things are told apart here, because the dock shows all three:
 *
 * - a **session** is one PTY, keyed by the id the backend gave it;
 * - a **pane** is a slot in a workspace's arrangement, holding at most one session;
 * - a **workspace** is one tab — a layout, its panes, and the pane the keyboard is in.
 */

import { create } from 'zustand'

import type { TerminalSession } from '@/shared/bindings/TerminalSession'

import { canAdoptLayout, clampSize, panesForLayout } from './lib/layout'

/** 1 · 2 side by side · 2 stacked · 4 (2×2) — the arrangements a workspace may wear. */
export type TerminalLayout = 'single' | 'columns' | 'rows' | 'grid'

/**
 * One PTY, as the window sees it — the row that used to be the whole tab.
 *
 * Named `…State` on purpose: `TerminalSession` is the backend's own binding
 * (`shared/bindings/TerminalSession`), and the two are different things — the binding is what the
 * backend answered when the session started, this is what the window knows about it now.
 */
export interface TerminalSessionState {
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

/** A slot in a workspace's arrangement, holding at most one session. */
export interface TerminalPane {
  id: string
  sessionId: string | null
}

/** A tab: an arrangement of panes, and the pane the keyboard is in. */
export interface TerminalWorkspace {
  id: string
  layout: TerminalLayout
  /** In layout order: the first slot is the top-left one. */
  panes: TerminalPane[]
  /** Where the keyboard goes when the tab is on screen. */
  activePaneId: string
  /**
   * Divider fractions of the container, per axis: `x` is read by `columns`/`grid`, `y` by
   * `rows`/`grid`. An axis a layout does not read keeps its last value, so folding and re-splitting
   * does not reset what the user dragged.
   */
  sizes: { x: number; y: number }
}

/**
 * Output held for a session whose pane is not mounted yet: a session starts printing the moment it
 * is spawned, which can be before React has painted the workspace it was opened into.
 */
const MAX_BUFFERED_CHUNKS = 400

/** The even split a fresh workspace opens with. */
const DEFAULT_SIZES = { x: 0.5, y: 0.5 }

let sequence = 0

/** An id for what the backend does not name — a workspace, a pane — unique to this window's life. */
function nextId(prefix: 'w' | 'p'): string {
  sequence += 1
  return `${prefix}${sequence}`
}

/**
 * The workspace the window is showing: the active one, or the last — the same fallback the dock
 * makes when the active id points at a workspace that is gone.
 */
function shownWorkspace(state: TerminalState): TerminalWorkspace | undefined {
  return (
    state.workspaces.find((workspace) => workspace.id === state.activeId) ??
    state.workspaces[state.workspaces.length - 1]
  )
}

/**
 * The window's record for a session the backend just started, with an exit that already arrived
 * applied to it: a process can end before React has painted the pane it belongs to.
 */
function recordFor(
  session: TerminalSession,
  exits: Record<string, number | null>,
): TerminalSessionState {
  const record: TerminalSessionState = {
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
  if (Object.hasOwn(exits, record.sessionId)) {
    record.running = false
    record.exitCode = exits[record.sessionId] ?? null
  }
  return record
}

/**
 * Every trace of a session is dropped with it: its record, the output held for a pane that was
 * never mounted, and the exit recorded for it.
 */
function without(
  state: TerminalState,
  sessionId: string | null,
): Pick<TerminalState, 'sessions' | 'buffered' | 'exits'> {
  if (sessionId === null) {
    return { sessions: state.sessions, buffered: state.buffered, exits: state.exits }
  }
  const { [sessionId]: _record, ...sessions } = state.sessions
  const { [sessionId]: _buffered, ...buffered } = state.buffered
  const { [sessionId]: _exited, ...exits } = state.exits
  return { sessions, buffered, exits }
}

interface TerminalState {
  /** One record per PTY, keyed by the id the backend gave it. */
  sessions: Record<string, TerminalSessionState>
  /** The tabs, in strip order. */
  workspaces: TerminalWorkspace[]
  /** The workspace on screen. */
  activeId: string | null
  /**
   * Whether the docked panel shows its terminals. Collapsed, the tab strip stays visible and the
   * terminals stay mounted (a background agent keeps its scrollback), but nothing is interactive.
   */
  expanded: boolean
  /**
   * Whether the dock has taken the whole window: the screen above it and the rail give way and the
   * terminal fills what is left, while its tabs and their scrollback stay exactly as they were.
   * Only an open dock can be maximized — collapsing it, or closing its last workspace, leaves it.
   */
  maximized: boolean
  buffered: Record<string, Uint8Array[]>
  /**
   * Sessions that have already ended, whether or not their pane existed at the time. A process can
   * exit before React has painted the pane it belongs to (an agent that refuses to start, a shell
   * that closes at once); without this the pane would then claim to be running for ever, with
   * nothing behind it.
   */
  exits: Record<string, number | null>
  /**
   * Add a session: as a workspace of its own, or into the pane that asked for it (which brings that
   * workspace to the front and opens the dock).
   */
  open: (session: TerminalSession, into?: { paneId: string }) => void
  /**
   * Put a session into a pane **in place of** whatever it holds — the restart path, where the pane
   * is never left empty. Closing the old session first would take a one-pane workspace with it (its
   * last session went), and the agent that had just started would have nowhere to live.
   */
  replaceSession: (paneId: string, session: TerminalSession) => void
  activate: (workspaceId: string) => void
  /** Give a pane of its own workspace the keyboard. */
  focusPane: (paneId: string) => void
  /** Give the pane in this slot (1-based) of the workspace on screen the keyboard. */
  focusPaneAt: (index: number) => void
  /** Wear this layout: grown by appending empty panes, folded only while every session still fits. */
  setLayout: (layout: TerminalLayout) => void
  setSizes: (sizes: Partial<{ x: number; y: number }>) => void
  setExpanded: (expanded: boolean) => void
  toggleExpanded: () => void
  /** Fill the window (which opens the dock), or give the window back to the screens. */
  setMaximized: (maximized: boolean) => void
  toggleMaximized: () => void
  /** The process in the session ended; the pane stays until it is closed. */
  finish: (sessionId: string, exitCode: number | null) => void
  /**
   * Forget a session, whether or not the backend still holds it: its pane is emptied, and a
   * workspace left without a single session goes with it — the way a tab used to.
   */
  closeSession: (sessionId: string) => void
  buffer: (sessionId: string, data: Uint8Array) => void
  takeBuffered: (sessionId: string) => Uint8Array[]
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  sessions: {},
  workspaces: [],
  activeId: null,
  expanded: false,
  maximized: false,
  buffered: {},
  exits: {},

  open: (session, into) =>
    set((state) => {
      const record = recordFor(session, state.exits)
      const sessions = { ...state.sessions, [record.sessionId]: record }

      if (into) {
        const target = state.workspaces.find((workspace) =>
          workspace.panes.some((pane) => pane.id === into.paneId),
        )
        const pane = target?.panes.find((candidate) => candidate.id === into.paneId)
        // One pane holds one session: a second one would mean two emulators sharing one host.
        if (!target || !pane || pane.sessionId !== null) return state
        return {
          sessions,
          activeId: target.id,
          expanded: true,
          workspaces: state.workspaces.map((workspace) =>
            workspace.id === target.id
              ? {
                  ...workspace,
                  activePaneId: into.paneId,
                  panes: workspace.panes.map((candidate) =>
                    candidate.id === into.paneId
                      ? { ...candidate, sessionId: record.sessionId }
                      : candidate,
                  ),
                }
              : workspace,
          ),
        }
      }

      const id = nextId('w')
      const paneId = nextId('p')
      return {
        sessions,
        activeId: id,
        expanded: true,
        workspaces: [
          ...state.workspaces,
          {
            id,
            layout: 'single',
            panes: [{ id: paneId, sessionId: record.sessionId }],
            activePaneId: paneId,
            sizes: { ...DEFAULT_SIZES },
          },
        ],
      }
    }),

  replaceSession: (paneId, session) =>
    set((state) => {
      const owner = state.workspaces.find((workspace) =>
        workspace.panes.some((pane) => pane.id === paneId),
      )
      const pane = owner?.panes.find((candidate) => candidate.id === paneId)
      if (!owner || !pane) return state

      // The old session's traces go first, so a leftover exit of it cannot colour the new record.
      const cleared = without(state, pane.sessionId)
      const record = recordFor(session, cleared.exits)
      return {
        sessions: { ...cleared.sessions, [record.sessionId]: record },
        buffered: cleared.buffered,
        exits: cleared.exits,
        activeId: owner.id,
        expanded: true,
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === owner.id
            ? {
                ...workspace,
                activePaneId: pane.id,
                panes: workspace.panes.map((candidate) =>
                  candidate.id === paneId
                    ? { ...candidate, sessionId: record.sessionId }
                    : candidate,
                ),
              }
            : workspace,
        ),
      }
    }),

  activate: (workspaceId) =>
    set((state) =>
      state.workspaces.some((workspace) => workspace.id === workspaceId)
        ? { activeId: workspaceId, expanded: true }
        : state,
    ),

  focusPane: (paneId) =>
    set((state) => {
      const owner = state.workspaces.find((workspace) =>
        workspace.panes.some((pane) => pane.id === paneId),
      )
      if (!owner || owner.activePaneId === paneId) return state
      return {
        workspaces: state.workspaces.map((workspace) =>
          workspace.id === owner.id ? { ...workspace, activePaneId: paneId } : workspace,
        ),
      }
    }),

  focusPaneAt: (index) =>
    set((state) => {
      const workspace = shownWorkspace(state)
      const pane = workspace?.panes[index - 1]
      if (!workspace || !pane || workspace.activePaneId === pane.id) return state
      return {
        workspaces: state.workspaces.map((candidate) =>
          candidate.id === workspace.id ? { ...candidate, activePaneId: pane.id } : candidate,
        ),
      }
    }),

  setLayout: (layout) =>
    set((state) => {
      const workspace = shownWorkspace(state)
      // A fold that cannot fit every session is refused outright: the store never moves a session
      // it cannot keep, and a half-applied layout is worse than no layout.
      if (!workspace || workspace.layout === layout) return state
      if (!canAdoptLayout(workspace.panes, layout)) return state

      const panes = panesForLayout(workspace.panes, layout, () => nextId('p'))
      const activePaneId = panes.some((pane) => pane.id === workspace.activePaneId)
        ? workspace.activePaneId
        : (panes[0]?.id ?? workspace.activePaneId)
      return {
        workspaces: state.workspaces.map((candidate) =>
          candidate.id === workspace.id ? { ...candidate, layout, panes, activePaneId } : candidate,
        ),
      }
    }),

  setSizes: (sizes) =>
    set((state) => {
      const workspace = shownWorkspace(state)
      if (!workspace) return state
      const next = {
        x: sizes.x === undefined ? workspace.sizes.x : clampSize(sizes.x),
        y: sizes.y === undefined ? workspace.sizes.y : clampSize(sizes.y),
      }
      return {
        workspaces: state.workspaces.map((candidate) =>
          candidate.id === workspace.id ? { ...candidate, sizes: next } : candidate,
        ),
      }
    }),

  setExpanded: (expanded) =>
    set((state) => ({ expanded, maximized: expanded ? state.maximized : false })),

  toggleExpanded: () =>
    set((state) => ({
      expanded: !state.expanded,
      maximized: state.expanded ? false : state.maximized,
    })),

  setMaximized: (maximized) =>
    set((state) => ({ maximized, expanded: maximized ? true : state.expanded })),

  toggleMaximized: () =>
    set((state) => (state.maximized ? { maximized: false } : { maximized: true, expanded: true })),

  finish: (sessionId, exitCode) =>
    set((state) => {
      const current = state.sessions[sessionId]
      return {
        exits: { ...state.exits, [sessionId]: exitCode },
        sessions: current
          ? { ...state.sessions, [sessionId]: { ...current, running: false, exitCode } }
          : state.sessions,
      }
    }),

  closeSession: (sessionId) =>
    set((state) => {
      const { sessions, buffered, exits } = without(state, sessionId)
      const owner = state.workspaces.find((workspace) =>
        workspace.panes.some((pane) => pane.sessionId === sessionId),
      )
      if (!owner) return { sessions, buffered, exits }

      // The pane stays where it is and is simply empty again: an arrangement the user built is
      // never reshuffled by closing one agent.
      const panes = owner.panes.map((pane) =>
        pane.sessionId === sessionId ? { ...pane, sessionId: null } : pane,
      )
      const emptied = panes.every((pane) => pane.sessionId === null)
      const workspaces = emptied
        ? state.workspaces.filter((workspace) => workspace.id !== owner.id)
        : state.workspaces.map((workspace) =>
            workspace.id === owner.id ? { ...workspace, panes } : workspace,
          )
      const activeId =
        emptied && state.activeId === owner.id
          ? (workspaces[workspaces.length - 1]?.id ?? null)
          : state.activeId
      // No workspaces left means nothing to show: the dock goes away entirely.
      return {
        sessions,
        buffered,
        exits,
        workspaces,
        activeId,
        expanded: workspaces.length > 0 && state.expanded,
        maximized: workspaces.length > 0 && state.maximized,
      }
    }),

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
