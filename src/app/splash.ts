/**
 * Boot splash teardown.
 *
 * `index.html` paints the splash before this module — or the stylesheet — exists, so a cold
 * start never opens on a blank window. All this module does is take the splash away once the
 * app has painted, holding it for {@link SPLASH_MIN_MS} so a warm start does not blink.
 *
 * Every side effect goes through {@link SplashHost}, which keeps the timing testable without a
 * real clock (the same shape as `theme.ts`).
 */

const SPLASH_ID = 'ah-splash'

/** A branded start, not a flicker: the splash stays up at least this long. */
export const SPLASH_MIN_MS = 420

/** Must match the exit transition on `#ah-splash` in `index.html`. */
export const SPLASH_EXIT_MS = 240

/** Side effects `createSplashDismisser` needs; the browser implementation is below. */
export interface SplashHost {
  /** The splash element, or `null` once it is gone. */
  splash: () => HTMLElement | null
  /** Monotonic milliseconds; only differences matter. */
  now: () => number
  /** Whether the OS asked for less motion: the exit then has no transition to wait for. */
  reducedMotion: () => boolean
}

/**
 * Builds the one-shot dismissal of `host`'s splash.
 *
 * The first call wins: the splash is flagged `leaving` (which fades it out over the app) and
 * removed once the exit transition has run its course. Later calls are no-ops, so a caller
 * cannot take the splash down twice.
 */
export function createSplashDismisser(host: SplashHost): () => void {
  const shownAt = host.now()
  let dismissed = false

  return function dismissSplash() {
    if (dismissed) return
    dismissed = true

    const splash = host.splash()
    if (!splash) return

    const remaining = Math.max(0, SPLASH_MIN_MS - (host.now() - shownAt))
    window.setTimeout(() => {
      splash.dataset.state = 'leaving'
      window.setTimeout(() => splash.remove(), host.reducedMotion() ? 0 : SPLASH_EXIT_MS)
    }, remaining)
  }
}

function browserSplashHost(): SplashHost {
  return {
    splash: () => document.getElementById(SPLASH_ID),
    now: () => performance.now(),
    reducedMotion: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  }
}

/** The app-wide dismissal: called once from `main.tsx`, after the first render. */
export const dismissSplash = createSplashDismisser(browserSplashHost())
