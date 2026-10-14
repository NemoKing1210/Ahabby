/**
 * The one drag every handle in the dock is built on: the panel's own top edge, and the dividers
 * between panes.
 *
 * The cursor and the selection are pinned for the whole gesture rather than only while the pointer
 * is over the handle — a fast drag leaves the handle in the first few pixels, and without this the
 * pointer would turn back into an arrow and start selecting text halfway through the resize.
 */

import type { PointerEvent as ReactPointerEvent } from 'react'

export function startPointerDrag(
  event: ReactPointerEvent<HTMLElement>,
  { cursor, onMove }: { cursor: string; onMove: (event: globalThis.PointerEvent) => void },
): void {
  event.preventDefault()
  const move = (moveEvent: globalThis.PointerEvent) => onMove(moveEvent)
  const stop = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', stop)
    document.body.style.removeProperty('cursor')
    document.body.style.removeProperty('user-select')
  }
  document.body.style.cursor = cursor
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', stop)
}
