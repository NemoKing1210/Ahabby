import { AnimatePresence, motion } from 'motion/react'
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'

import { cn } from '@/shared/lib/cn'
import { softTransition, useSoftSlide } from '@/shared/lib/motion'

/** How long after mount a newly added row is still treated as part of the initial entrance. */
const ENTRANCE_WINDOW_MS = 700
const STAGGER_STEP_S = 0.04
const STAGGER_MAX_INDEX = 6

/**
 * Rows a list animates before it renders the rest plainly.
 *
 * Every animated row is a layout-projected element motion measures on the way in and on every
 * change around it, so a list of hundreds pays for an entrance nobody can watch one row at a
 * time anyway. Past this count the rows are rendered as they are: the cards keep their own hover
 * and focus states, and a row that leaves is simply gone instead of fading.
 */
const ANIMATED_ROWS_MAX = 30

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
 *
 * A list longer than `ANIMATED_ROWS_MAX` rows is rendered without any of that — see the constant.
 * Pass `animate={false}` to skip it sooner, for a list whose rows are many by nature rather than by
 * what the user filtered down to.
 */
export function AnimatedList({
  className,
  itemClassName,
  children,
  grouped = true,
  as = 'div',
  itemAs,
  animate = true,
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
  /** `false` renders plain rows; a list past `ANIMATED_ROWS_MAX` does so on its own. */
  animate?: boolean
}) {
  const [staggering, setStaggering] = useState(true)
  const slide = useSoftSlide(6)
  const item = itemAs ?? (as === 'ul' ? 'li' : 'div')
  const items = Children.toArray(children).filter(isValidElement)
  const animated = animate && items.length <= ANIMATED_ROWS_MAX

  useEffect(() => {
    if (!animated) return
    const timer = window.setTimeout(() => setStaggering(false), ENTRANCE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [animated])

  const rows = items.map((child, index) => {
    const key = child.key ?? index
    // The delay belongs to the entrance alone: a reorder or an exit must never queue behind it.
    const delay = staggering ? Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_S : 0

    if (!animated) {
      return item === 'li' ? (
        <li key={key} className={itemClassName}>
          {child}
        </li>
      ) : (
        <div key={key} className={itemClassName}>
          {child}
        </div>
      )
    }

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
  // list element — the list itself never leaves, the rows do. Plain rows need no such watcher.
  const content = animated ? <AnimatePresence mode="popLayout">{rows}</AnimatePresence> : rows

  if (as === 'ul') {
    return <ul className={listClassName}>{content}</ul>
  }
  return <div className={listClassName}>{content}</div>
}
