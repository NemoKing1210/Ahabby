/**
 * The rules a workspace's arrangement obeys, as pure functions: which layouts exist, how many slots
 * each shows, whether a workspace may wear one, and what its panes become when it does.
 *
 * These are the rules and nothing else — no store, no React, no terminal — so the fold that must
 * never leave an agent behind is one function a test can hold in its hand. `store.ts` applies them.
 */

import type { TerminalLayout, TerminalPane } from '../store'

/** A divider may not be dragged past this share of its container, or a pane stops being usable. */
export const SIZE_MIN = 0.15
export const SIZE_MAX = 0.85

const SLOTS: Record<TerminalLayout, 1 | 2 | 4> = { single: 1, columns: 2, rows: 2, grid: 4 }

/** How many panes a layout shows. */
export function paneCount(layout: TerminalLayout): 1 | 2 | 4 {
  return SLOTS[layout]
}

/** Whether a workspace may wear this layout while keeping every session it holds. */
export function canAdoptLayout(panes: TerminalPane[], layout: TerminalLayout): boolean {
  return panes.filter((pane) => pane.sessionId !== null).length <= paneCount(layout)
}

/**
 * The panes of a workspace wearing this layout: the ones holding a session first, in their order,
 * then the empty ones — cut to the new slot count and extended with freshly minted empty panes.
 *
 * Folding is therefore compaction, never a lost session: `canAdoptLayout` is what guarantees the
 * sessions fit, and everything else is only ever reordered or appended.
 */
export function panesForLayout(
  panes: TerminalPane[],
  layout: TerminalLayout,
  mint: () => string,
): TerminalPane[] {
  const count = paneCount(layout)
  const kept = [
    ...panes.filter((pane) => pane.sessionId !== null),
    ...panes.filter((pane) => pane.sessionId === null),
  ].slice(0, count)
  while (kept.length < count) kept.push({ id: mint(), sessionId: null })
  return kept
}

/** A divider fraction the store will accept. */
export function clampSize(value: number): number {
  return Math.min(SIZE_MAX, Math.max(SIZE_MIN, value))
}

/** The pane a Ctrl/Cmd+1…4 press asks for, or `null` for every key the shell keeps. */
export function focusPaneFromKey(event: KeyboardEvent): number | null {
  if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return null
  const match = /^Digit([1-4])$/.exec(event.code)
  return match ? Number(match[1]) : null
}
