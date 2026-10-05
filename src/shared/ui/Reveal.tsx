import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

import { softTransition } from '@/shared/lib/motion'

/**
 * Reveal for content a disclosure control mounts and unmounts: the row grows open instead
 * of appearing fully formed.
 *
 * Someone who asked their OS for less motion gets a plain fade — animating height is
 * exactly the movement that setting is about.
 */
export function Reveal({ open, children }: { open: boolean; children: ReactNode }) {
  const reduceMotion = useReducedMotion()

  return (
    <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          initial={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          animate={reduceMotion ? { opacity: 1 } : { height: 'auto', opacity: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
          transition={softTransition}
          className="overflow-hidden"
        >
          {children}
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
