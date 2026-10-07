/**
 * The emulators themselves: one xterm instance per session, owned here rather than by the
 * component that happens to be showing it.
 *
 * React is free to mount a tab's `TerminalView` and take it down again — StrictMode mounts every
 * component twice in development, the dock goes away when the last tab closes — while a
 * terminal's *state* (its parsed screen, its scrollback, its selection) lives in the emulator.
 * Building a second one for the same session throws that state away, which is exactly how a tab
 * ends up blank or half-painted after a remount. So an emulator is created once per session,
 * re-homed onto whatever host the mounted component owns, and disposed only when the tab itself
 * is closed.
 *
 * Everything that is a property of the *session* rather than of the view — keystrokes going back
 * to the PTY, the size of the console, the bytes of its output — is wired here, once, so a
 * remount cannot double-subscribe or lose a chunk in between.
 */

import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { toAppError } from '@/shared/api/errors'
import { ipc } from '@/shared/api/ipc'
import type { TerminalTheme } from '@/shared/bindings/TerminalTheme'

import { useTerminalStore } from '../store'
import { registerTerminal, unregisterTerminal } from './session'
import { terminalFont, terminalTheme } from './theme'

/**
 * Repaint an attached terminal: the scheme it is painted with and the font it is laid out in.
 *
 * The mutation belongs here and not in the view: the emulator is the session's, and the view only
 * ever says what it should look like. Callers refit afterwards — a different font means different
 * cell sizes, and the grid has to be recomputed.
 */
export function paintTerminal(handle: TerminalHandle, scheme: TerminalTheme): void {
  const font = terminalFont()
  handle.term.options.theme = terminalTheme(scheme)
  handle.term.options.fontFamily = font.fontFamily
  handle.term.options.fontSize = font.fontSize
}

/** What a view needs to paint and drive one session's terminal. */
export interface TerminalHandle {
  term: Terminal
  fit: FitAddon
  search: SearchAddon
}

interface Entry extends TerminalHandle {
  /** Where a link the user clicks is opened. Refreshed on every attach. */
  open: (url: string) => void
}

/**
 * Live emulators, keyed by session. Deliberately outside React: the terminal must not be rebuilt
 * because a component re-rendered or remounted, and writing a repaint into it must not notify
 * React either.
 */
const entries = new Map<string, Entry>()

/**
 * The emulator for a session: created on first use, re-homed on every later attach.
 *
 * The host is the element the terminal is painted into; the first attach also registers the
 * writer that `terminal://output` goes through, so the bytes of a session that started printing
 * before React painted anything are handed over here.
 */
export function attachTerminal(
  sessionId: string,
  host: HTMLElement,
  open: (url: string) => void,
): TerminalHandle {
  const existing = entries.get(sessionId)
  if (existing) {
    existing.open = open
    // Moving the element the emulator already paints into keeps its scrollback and its parsed
    // screen: the next mount of a `TerminalView` shows what the previous one showed, instead of
    // an empty terminal that only fills in once the program inside prints again.
    const element = existing.term.element
    if (element && element.parentElement !== host) host.appendChild(element)
    existing.term.refresh(0, existing.term.rows - 1)
    return existing
  }

  const font = terminalFont()
  const term = new Terminal({
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: font.fontFamily,
    fontSize: font.fontSize,
    lineHeight: 1.2,
    macOptionIsMeta: true,
    // A terminal is a scrollback, not a document: keep a generous history, like a desktop one.
    scrollback: 10_000,
    theme: terminalTheme(),
  })
  const fit = new FitAddon()
  const search = new SearchAddon()
  const entry: Entry = { term, fit, search, open }
  entries.set(sessionId, entry)

  term.loadAddon(fit)
  term.loadAddon(search)
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      event.preventDefault()
      // Read from the table, not from a captured value: the link handler outlives the render
      // that created it, and it is the session that owns the terminal, not that render.
      entries.get(sessionId)?.open(uri)
    }),
  )
  term.open(host)

  // Everything the user types goes back to the PTY. A session the backend no longer holds —
  // closed from the tray, dropped by a reload — cannot be typed into, and a tab that swallows
  // keystrokes for ever is worse than one that admits it is over.
  term.onData((data) => {
    void ipc.writeTerminal(sessionId, data).catch((error: unknown) => {
      if (toAppError(error).code === 'not_found') {
        useTerminalStore.getState().finish(sessionId, null)
      }
    })
  })
  term.onResize(({ cols, rows }) => {
    void ipc.resizeTerminal(sessionId, cols, rows).catch(() => undefined)
  })
  registerTerminal(sessionId, (data) => term.write(data))
  return entry
}

/**
 * Release a session's emulator: the tab is closed, so its screen, its scrollback and everything
 * xterm registered are dropped. Called from the view that owns the tab once the store has
 * forgotten it.
 */
export function disposeTerminal(sessionId: string): void {
  const entry = entries.get(sessionId)
  if (!entry) return
  entries.delete(sessionId)
  unregisterTerminal(sessionId)
  entry.term.dispose()
}
