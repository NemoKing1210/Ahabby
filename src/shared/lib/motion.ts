import { useReducedMotion, type Transition } from 'motion/react'

/**
 * Motion tokens.
 *
 * One easing curve and one duration for everything that is not a spring, so unrelated
 * animations read as one system instead of a pile of effects. `WARM_EASE` mirrors
 * `--ease-warm` in `globals.css` — keep the two in sync, the CSS keyframes rely on it.
 */
export const WARM_EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]

export const DURATION = {
  fast: 0.15,
  base: 0.22,
  slow: 0.32,
} as const

/** Default enter/leave for a surface: a screen, a tab panel, a list row. */
export const softTransition: Transition = { duration: DURATION.base, ease: WARM_EASE }

/** Shared-layout moves (the sidebar pill) want a spring to feel physical. */
export const glideTransition: Transition = { type: 'spring', stiffness: 480, damping: 40 }

/**
 * Enter/leave targets for a surface that slides `offset` pixels into place.
 *
 * Someone who asked for less motion gets a plain fade instead: motion's own
 * `reducedMotion="user"` keeps the offset for the whole tween and then snaps it away, which
 * reads as a pop rather than as less motion.
 */
export function useSoftSlide(offset: number) {
  const reduceMotion = useReducedMotion()

  if (reduceMotion) {
    return { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
  }
  return {
    initial: { opacity: 0, y: offset },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -offset * 0.75 },
  }
}
