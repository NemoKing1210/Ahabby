import type { CSSProperties } from 'react'

/**
 * How golden a collection's star count is painted.
 *
 * The count alone decides it: the more stars a repository has, the closer its star and its number
 * are painted to the palette's gold (`globals.css`, `.ah-stars`), and a repository nobody starred
 * keeps exactly the muted ink every count had before. Stars are a heavy-tailed number — the step
 * between a hundred of them and a thousand is the one that means something, not the one between a
 * hundred thousand and a hundred thousand and one — so the scale is logarithmic, and these two
 * counts are its ends.
 */

/** Below this many stars a count is painted the muted ink of any other number. */
const QUIET_STARS = 10

/** At this many stars and past it a count is the full gold; nearly every collection sits under. */
const LOUD_STARS = 250_000

/**
 * How far from the muted ink a count is painted, as a fraction of the way to the gold: `0` for a
 * collection with `QUIET_STARS` or fewer, `1` for one with `LOUD_STARS` or more, and a step of the
 * same size for every tenfold in between.
 */
export function starShare(stars: number): number {
  // `null` is not the only surprise a number from GitHub can carry; a value that is not a finite
  // number is a count nobody has, and gets the ink of one nobody has.
  if (!Number.isFinite(stars) || stars <= QUIET_STARS) return 0
  const span = Math.log10(LOUD_STARS) - Math.log10(QUIET_STARS)
  return Math.min(1, (Math.log10(stars) - Math.log10(QUIET_STARS)) / span)
}

/**
 * The inline style that hands the share to `.ah-stars` (see `globals.css`).
 *
 * Only the share comes from the count: the two ends of the mix — the muted ink and the theme's
 * gold — are the stylesheet's, which is what keeps the tint readable in either theme instead of
 * being a brightness that only works on one of them.
 */
export function starTint(stars: number): CSSProperties {
  return { '--ah-star-share': `${(starShare(stars) * 100).toFixed(1)}%` } as CSSProperties
}
