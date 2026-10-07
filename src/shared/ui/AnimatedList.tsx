import { AnimatePresence, motion } from 'motion/react'
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'
import { softTransition, useSoftSlide } from '@/shared/lib/motion'

/** How long after mount a newly added row is still treated as part of the initial entrance. */
const ENTRANCE_WINDOW_MS = 700
const STAGGER_STEP_S = 0.04
const STAGGER_MAX_INDEX = 6

/**
 * A row that eases in when it arrives, fades out from where it stood when it leaves, and the rows
 * around it slide into the place it left.
 *
 * The rows are wrapped in `AnimatePresence` (`mode="popLayout"`): a removed row is taken out of the
 * flow while it animates out, so the rest close the gap at once instead of waiting for it. The
 * wrapper is `relative` on purpose — `popLayout` positions the leaving row absolutely, and the
 * nearest positioned ancestor being the list is what keeps it from jumping to the window.
 *
 * `layout="position"` rather than `layout`: a card's own box is not stretched or squashed while it
 * moves, so the text inside never blurs on the way.
 *
 * Rows that arrive later (filtering, rescanning) fade in on their own without a stagger delay, so
 * typing in a filter never feels like the list is catching up. Someone who asked their OS for less
 * motion gets the fade alone (`useSoftSlide`) and no layout animation (motion's own `reducedMotion`).
 */
export function AnimatedList({
  className,
  itemClassName,
  children,
  grouped = true,
  as = 'div',
  itemAs,
}: {
  /** Layout of the list itself — a grid, a wrapping chip row, a scrolling box. */
  className?: string
  /** Class every row's wrapper needs on its own (a flex row, mostly, has to keep `shrink-0`). */
  itemClassName?: string
  children: ReactNode
  /**
   * `true` (default) stacks the rows as a card group — close together, with the corners at the
   * exposed ends keeping the full radius (see `.ah-card-group`). Set it to `false` when `className`
   * already describes the layout (a grid, a chip row).
   */
  grouped?: boolean
  /** `ul` keeps the list semantics for the rows that are a real list of options. */
  as?: 'div' | 'ul'
  /** Defaults to `li` for a `ul`, `div` otherwise. */
  itemAs?: 'div' | 'li'
}) {
  const [staggering, setStaggering] = useState(true)
  const slide = useSoftSlide(6)
  const item = itemAs ?? (as === 'ul' ? 'li' : 'div')

  useEffect(() => {
    const timer = window.setTimeout(() => setStaggering(false), ENTRANCE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  const rows = Children.map(children, (child, index) => {
    if (!isValidElement(child)) return null
    // The delay belongs to the entrance alone: a reorder or an exit must never queue behind it.
    const delay = staggering ? Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_S : 0
    const key = child.key ?? index
    const props = {
      layout: 'position' as const,
      className: itemClassName,
      initial: slide.initial,
      animate: { ...slide.animate, transition: { ...softTransition, delay } },
      exit: { ...slide.exit, transition: softTransition },
      transition: softTransition,
    }
    return item === 'li' ? (
      <motion.li key={key} {...props}>
        {child}
      </motion.li>
    ) : (
      <motion.div key={key} {...props}>
        {child}
      </motion.div>
    )
  })

  const listClassName = cn(grouped && 'ah-card-group', 'relative', className)

  // `AnimatePresence` tracks its *direct* children, so it has to wrap the rows and not the
  // list element — the list itself never leaves, the rows do.
  if (as === 'ul') {
    return (
      <ul className={listClassName}>
        <AnimatePresence mode="popLayout">{rows}</AnimatePresence>
      </ul>
    )
  }
  return (
    <div className={listClassName}>
      <AnimatePresence mode="popLayout">{rows}</AnimatePresence>
    </div>
  )
}
