import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'

import { startPointerDrag } from '../lib/drag'
import type { TerminalLayout } from '../store'

/** The layouts whose columns are cut, and whose rows are: `columns` and `rows` are each half. */
const COLUMN_LAYOUTS: TerminalLayout[] = ['columns', 'grid']
const ROW_LAYOUTS: TerminalLayout[] = ['rows', 'grid']

/**
 * The panes of one workspace, laid out the way it asked for.
 *
 * One flat grid with its fractions taken from the workspace's own `sizes`: the panes are its
 * children in slot order, and the dividers are bars laid *over* the gaps rather than cells of their
 * own. One fraction therefore drives both rows of a `grid`, so the cross can never come apart, and
 * folding the workspace reorders children instead of rebuilding the panes — the emulator each
 * session owns is moved into its new cell, not thrown away.
 *
 * This component knows about geometry and nothing else: what a pane *is* belongs to its caller.
 */
export function PaneGrid({
  layout,
  sizes,
  onResize,
  children,
}: {
  layout: TerminalLayout
  sizes: { x: number; y: number }
  /** A fraction of the container the user dragged a divider to; the store clamps it. */
  onResize: (next: Partial<{ x: number; y: number }>) => void
  children: ReactNode
}) {
  const { t } = useTranslation()
  const gridRef = useRef<HTMLDivElement>(null)
  const cut = { columns: COLUMN_LAYOUTS.includes(layout), rows: ROW_LAYOUTS.includes(layout) }

  /**
   * Follow a divider until it is let go. The fraction is read off the container rather than
   * accumulated from the drag, so a divider dragged to the far edge and back lands exactly where
   * the pointer is.
   */
  const dragDivider = (axis: 'x' | 'y') => (event: ReactPointerEvent<HTMLDivElement>) => {
    const rect = gridRef.current?.getBoundingClientRect()
    if (!rect) return
    const span = axis === 'x' ? rect.width : rect.height
    const origin = axis === 'x' ? rect.left : rect.top
    if (span === 0) return
    startPointerDrag(event, {
      cursor: axis === 'x' ? 'col-resize' : 'row-resize',
      onMove: (moveEvent) => {
        const at = axis === 'x' ? moveEvent.clientX : moveEvent.clientY
        onResize(axis === 'x' ? { x: (at - origin) / span } : { y: (at - origin) / span })
      },
    })
  }

  return (
    <div
      ref={gridRef}
      className="relative grid min-h-0 flex-1"
      style={{
        gap: 'var(--group-gap)',
        gridTemplateColumns: cut.columns ? `${sizes.x}fr ${1 - sizes.x}fr` : '1fr',
        gridTemplateRows: cut.rows ? `${sizes.y}fr ${1 - sizes.y}fr` : '1fr',
      }}
    >
      {children}

      {cut.columns ? (
        <div
          key="divider-x"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('terminal.resizePanes')}
          onPointerDown={dragDivider('x')}
          className="group absolute inset-y-0 flex w-1.5 -translate-x-1/2 cursor-col-resize items-center justify-center"
          style={{ left: `${sizes.x * 100}%` }}
        >
          <span
            aria-hidden
            className={cn(
              'bg-border-strong h-10 w-0.5 rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100',
            )}
          />
        </div>
      ) : null}

      {cut.rows ? (
        <div
          key="divider-y"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('terminal.resizePanes')}
          onPointerDown={dragDivider('y')}
          className="group absolute inset-x-0 flex h-1.5 -translate-y-1/2 cursor-row-resize items-center justify-center"
          style={{ top: `${sizes.y * 100}%` }}
        >
          <span
            aria-hidden
            className={cn(
              'bg-border-strong h-0.5 w-10 rounded-full opacity-0 transition-opacity duration-150 group-hover:opacity-100',
            )}
          />
        </div>
      ) : null}
    </div>
  )
}
