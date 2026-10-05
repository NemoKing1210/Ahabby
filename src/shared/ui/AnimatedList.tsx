import { motion } from 'motion/react'
import { Children, isValidElement, useEffect, useState, type ReactNode } from 'react'

import { softTransition, useSoftSlide } from '@/shared/lib/motion'

/** How long after mount a newly added row is still treated as part of the initial entrance. */
const ENTRANCE_WINDOW_MS = 700
const STAGGER_STEP_S = 0.04
const STAGGER_MAX_INDEX = 6

/**
 * Vertical stack of cards that eases in once, on first paint.
 *
 * Rows that arrive later (filtering, rescanning) fade in on their own without a stagger
 * delay, so typing in a filter never feels like the list is catching up.
 */
export function AnimatedList({ className, children }: { className?: string; children: ReactNode }) {
  const [staggering, setStaggering] = useState(true)
  const slide = useSoftSlide(6)

  useEffect(() => {
    const timer = window.setTimeout(() => setStaggering(false), ENTRANCE_WINDOW_MS)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <div className={className}>
      {Children.map(children, (child, index) =>
        isValidElement(child) ? (
          <motion.div
            key={child.key ?? index}
            initial={slide.initial}
            animate={slide.animate}
            transition={{
              ...softTransition,
              delay: staggering ? Math.min(index, STAGGER_MAX_INDEX) * STAGGER_STEP_S : 0,
            }}
          >
            {child}
          </motion.div>
        ) : null,
      )}
    </div>
  )
}
