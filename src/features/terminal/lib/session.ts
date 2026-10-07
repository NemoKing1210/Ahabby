/**
 * The bridge between the backend's PTY sessions and the tabs on screen.
 *
 * Two responsibilities that do not belong in the store or in a component:
 * * routing `terminal://output` to the right terminal — a tab whose terminal is not mounted yet
 *   buffers its bytes in the store instead of losing them (the emulators themselves are owned by
 *   `lib/terminals.ts`, which is loaded with the dock and not with the shell);
 * * dropping backend sessions no tab knows about, and finishing tabs whose session is gone, which
 *   is what a reload in development leaves behind (the webview restarts, the backend keeps its
 *   shells).
 */

import { ipc } from '@/shared/api/ipc'
import type { TerminalOutput } from '@/shared/bindings/TerminalOutput'

import { useTerminalStore } from '../store'
import { base64ToBytes } from './base64'

/** What a mounted terminal does with its bytes. */
type Writer = (data: Uint8Array) => void

/**
 * Mounted terminals, keyed by session. Kept outside the store on purpose: writing to a terminal
 * must never notify React, or every repaint of a TUI would re-render the tree.
 */
const writers = new Map<string, Writer>()

/** Attach a terminal to its session and hand it whatever arrived before it was mounted. */
export function registerTerminal(sessionId: string, writer: Writer): void {
  writers.set(sessionId, writer)
  for (const chunk of useTerminalStore.getState().takeBuffered(sessionId)) {
    writer(chunk)
  }
}

export function unregisterTerminal(sessionId: string): void {
  writers.delete(sessionId)
}

/** Route one `terminal://output` chunk. */
export function writeTerminalOutput(event: TerminalOutput): void {
  const data = base64ToBytes(event.data)
  const writer = writers.get(event.sessionId)
  if (writer) {
    writer(data)
    return
  }
  useTerminalStore.getState().buffer(event.sessionId, data)
}

/**
 * Make the tab list and the backend agree, in both directions.
 *
 * The tab list is the truth about what the window can show: a backend session no tab knows about
 * is a shell nobody can reach (it happens after a reload in development — the webview restarts,
 * the backend keeps its shells), so it is closed rather than left running out of sight. The
 * reverse is true as well, and matters more: a tab whose session the backend no longer holds can
 * never be typed into again, so it is marked finished instead of quietly swallowing keystrokes.
 */
export async function reconcileTerminalSessions(): Promise<void> {
  const store = useTerminalStore.getState()
  const sessions = await ipc.listTerminalSessions()
  const live = new Set(sessions.map((session) => session.id))

  await Promise.all(
    sessions
      .filter((session) => !store.tabs.some((tab) => tab.sessionId === session.id))
      // A session that is already gone is not a failure worth surfacing.
      .map((session) => ipc.closeTerminal(session.id).catch(() => undefined)),
  )

  for (const tab of store.tabs) {
    if (!live.has(tab.sessionId)) useTerminalStore.getState().finish(tab.sessionId, null)
  }
}
