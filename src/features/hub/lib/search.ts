import { useEffect, useState } from 'react'

/**
 * Entries asked for per request. The MCP registry is slowest with a *small* page, not a large one.
 */
export const PAGE_SIZE = 16

/** How long typing settles before the collections are asked again. */
export const SEARCH_DEBOUNCE_MS = 350

/**
 * A search box's text, after typing has settled.
 *
 * A collection is a real request, not a local list, so the box settles before it is asked — and the
 * settled copy starts from what the box already holds, so a restored filter asks for the filtered
 * first page directly instead of asking twice.
 */
export function useSettledSearch(value: string): string {
  const [settled, setSettled] = useState(() => value.trim())

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [value])

  return settled
}
