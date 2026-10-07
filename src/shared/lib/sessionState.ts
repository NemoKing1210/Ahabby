import {
  useCallback,
  useState,
  useSyncExternalStore,
  type Dispatch,
  type SetStateAction,
} from 'react'

/**
 * The view state a screen is left with: its filters and its search box, kept for the length of
 * the session.
 *
 * Leaving a screen unmounts it, so a filter held in `useState` is gone by the time the user comes
 * back. This module keeps one process-lifetime map instead, which `useSessionState` reads on mount
 * and writes on every change. Nothing here reaches the disk: a filter is a way of looking at a
 * list, not a preference, so a restart starts clean — and one key is one screen's own field
 * (`library.query`), never a shared one.
 */
const store = new Map<string, unknown>()

/** The readers of one key, so a write sends them back for the value it just stored. */
const listeners = new Map<string, Set<() => void>>()

function read<T>(key: string, fallback: T): T {
  return store.has(key) ? (store.get(key) as T) : fallback
}

function write<T>(key: string, value: T): void {
  store.set(key, value)
  for (const listener of listeners.get(key) ?? []) listener()
}

function subscribe(key: string, listener: () => void): () => void {
  const reading = listeners.get(key) ?? new Set<() => void>()
  reading.add(listener)
  listeners.set(key, reading)
  return () => {
    reading.delete(listener)
    if (reading.size === 0) listeners.delete(key)
  }
}

/** Forgets one key, or every key — what a test does so one case cannot leak into the next. */
export function resetSessionState(key?: string): void {
  if (key === undefined) store.clear()
  else store.delete(key)
}

/**
 * `useState` that outlives its component: the value lives in the session store above, so the next
 * mount of the same screen starts with the filters the last one was left with. Because it is a
 * store read rather than component state, two readers of one key also agree with each other.
 *
 * `initial` is read only while the key holds nothing, which is why a screen may pass a literal.
 * As with `useState`, an updater must return a new value rather than change the previous one: what
 * the store keeps is the same reference the component renders. A key is assumed to keep one type
 * for the whole session.
 */
export function useSessionState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const [fallback] = useState(initial)
  const getSnapshot = useCallback(() => read(key, fallback), [key, fallback])
  const value = useSyncExternalStore(
    useCallback((listener: () => void) => subscribe(key, listener), [key]),
    getSnapshot,
  )

  const setValue = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      const previous = read(key, fallback)
      write(key, typeof next === 'function' ? (next as (previous: T) => T)(previous) : next)
    },
    [key, fallback],
  )

  return [value, setValue]
}
