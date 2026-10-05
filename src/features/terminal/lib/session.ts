/**
 * The bridge between the backend's PTY sessions and the tabs on screen.
 *
 * Two responsibilities that do not belong in the store or in a component:
 * * routing `terminal://output` to the right terminal — a tab whose terminal is not mounted yet
 *   buffers its bytes in the store instead of losing them;
 * * dropping backend sessions no tab knows about, which happens after a reload in development
 *   (the webview restarts, the backend keeps its shells).
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
 * Close backend sessions that no tab knows about.
 *
 * The tab list is the truth: a session the window cannot show is a shell nobody can reach, so it
 * is closed rather than left running out of sight.
 */
export async function reconcileTerminalSessions(): Promise<void> {
  const sessions = await ipc.listTerminalSessions()
  if (sessions.length === 0) return
  const known = new Set(useTerminalStore.getState().tabs.map((tab) => tab.sessionId))
  await Promise.all(
    sessions
      .filter((session) => !known.has(session.id))
      // A session that is already gone is not a failure worth surfacing.
      .map((session) => ipc.closeTerminal(session.id).catch(() => undefined)),
  )
}
