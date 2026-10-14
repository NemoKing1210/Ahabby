import { useEffect, useRef, useState, type RefObject } from 'react'

/** Rows a list shows before anything has been scrolled. Roughly a screenful of cards. */
export const LAZY_ROWS_INITIAL = 24

/** Rows added every time the sentinel under them comes into view. */
export const LAZY_ROWS_STEP = 24

/** How far below the viewport the next batch is prepared, so scrolling never waits for it. */
const ROOT_MARGIN = '640px'

/**
 * Whether this environment can watch the sentinel at all.
 *
 * Read once, at module load: a browser that cannot (`IntersectionObserver` is missing in a test
 * environment) gets the whole list, because the alternative is a list that can never grow.
 */
const CAN_OBSERVE = typeof IntersectionObserver !== 'undefined'

export interface LazyRowsOptions {
  /** Rows revealed up front. */
  initial?: number
  /** Rows revealed per step while scrolling. */
  step?: number
  /** How far ahead of the viewport the next step is prepared (`IntersectionObserver` syntax). */
  rootMargin?: string
  /**
   * Names the list on screen: another filter, another query, another source. Pass the array being
   * sliced — an identity the caller memoizes — or the key of the query behind it.
   */
  resetKey?: unknown
}

/**
 * How many rows of a long list to render now.
 *
 * A list a screen can hold is cheap to render whole; a list of hundreds is not, and it is the rows
 * nobody is looking at that cost the most — every one of them is a live component with its own
 * hooks, listeners and layout. This reveals a batch at a time and grows it only when the sentinel
 * placed under the last row comes into view, so what is mounted stays proportional to what the user
 * is near while the rest waits its turn.
 *
 * The data is still the caller's: this decides how much of what is already in hand is mounted,
 * never what is fetched, so "read more" stays an explicit action of the screen that owns the query.
 */
export function useLazyRows(
  total: number,
  {
    initial = LAZY_ROWS_INITIAL,
    step = LAZY_ROWS_STEP,
    rootMargin = ROOT_MARGIN,
    resetKey,
  }: LazyRowsOptions = {},
): { count: number; sentinelRef: RefObject<HTMLDivElement | null> } {
  // The count and the list it belongs to travel together: a count left over from another filter is
  // not a shorter list, it is a different one — so what was revealed is kept only while the list it
  // was revealed for is still the one on screen. Derived rather than reset by an effect, so a new
  // list never paints a batch of the previous one's length first.
  const [revealed, setRevealed] = useState({ list: resetKey, count: initial })
  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const count = revealed.list === resetKey ? revealed.count : initial

  useEffect(() => {
    const sentinel = sentinelRef.current
    if (sentinel === null || !CAN_OBSERVE || count >= total) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed({ list: resetKey, count: Math.min(count + step, total) })
        }
      },
      { rootMargin },
    )
    observer.observe(sentinel)
    return () => observer.disconnect()
    // `count` is a dependency on purpose: every batch moves the sentinel down the list, and the
    // observer is re-created around its new place.
  }, [count, total, step, rootMargin, resetKey])

  // A list shorter than a batch — or one narrowed by a filter after the fact — never reports more
  // rows than it has.
  return { count: Math.min(count, total), sentinelRef }
}
