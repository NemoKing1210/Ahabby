/**
 * Images of a page Ahabby is reading, carried through the backend.
 *
 * The CSP keeps `img-src 'self' data:`, so a remote `<img>` can never load on its own: every
 * picture of a page is fetched by Rust, turned into a `data:` URL here, and remembered for the
 * session. A page can declare hundreds of them, so the fetching is bounded twice — a handful in
 * flight at once, and a byte budget for what is kept.
 */

import { ipc } from '@/shared/api/ipc'

/** How many images are fetched at once: enough to fill a screen, few enough not to flood the IPC. */
const CONCURRENCY = 4

/** How much decoded image data stays in memory before the oldest is dropped. */
const BYTES_LIMIT = 12 * 1024 * 1024

const cache = new Map<string, Promise<string | null>>()
const sizes = new Map<string, number>()
let bytes = 0
let running = 0
const waiting: (() => void)[] = []

/**
 * The `data:` URL of a remote image, or `null` when it cannot be shown.
 *
 * The same URL is fetched once however many times it appears on the page: a logo in the header
 * and the footer is one request.
 */
export function proxiedImage(url: string): Promise<string | null> {
  const cached = cache.get(url)
  if (cached) return cached

  const pending = queue(async () => {
    try {
      const image = await ipc.fetchWebImage(url)
      const dataUrl = `data:${image.mime};base64,${image.base64}`
      remember(url, dataUrl.length)
      return dataUrl
    } catch {
      // A picture the backend refused is not one to ask for again — the reader hides it.
      remember(url, 0)
      return null
    }
  })
  cache.set(url, pending)
  return pending
}

/** Forget everything: the reader has no other lifetime than the window's, and tests start clean. */
export function clearProxiedImages() {
  cache.clear()
  sizes.clear()
  bytes = 0
}

function remember(url: string, size: number) {
  sizes.set(url, size)
  bytes += size
  while (bytes > BYTES_LIMIT) {
    const oldest = sizes.keys().next().value
    // The entry that was just added is never the one to drop: the reader is about to show it.
    if (oldest === undefined || oldest === url) break
    bytes -= sizes.get(oldest) ?? 0
    sizes.delete(oldest)
    cache.delete(oldest)
  }
}

/** Run `task` once a slot is free, so a page's images trickle in instead of arriving at once. */
function queue<T>(task: () => Promise<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const run = () => {
      running += 1
      void task()
        .then(resolve, reject)
        .finally(() => {
          running -= 1
          waiting.shift()?.()
        })
    }
    if (running < CONCURRENCY) run()
    else waiting.push(run)
  })
}
