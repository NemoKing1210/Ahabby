import type { Theme } from '@/shared/bindings/Theme'

/**
 * Theme handling.
 *
 * `system` is resolved against `prefers-color-scheme` and kept in sync while the app runs;
 * the resolved value is what the CSS tokens key off (`html.dark`).
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Must match the token transition in `globals.css`. */
const THEME_FADE_MS = 240

/** Resolved value of the last applied theme; `null` before the app has painted once. */
let appliedTheme: 'light' | 'dark' | null = null
let fadeTimer: number | undefined

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): () => void {
  const root = document.documentElement

  const sync = () => {
    const next = resolveTheme(theme)
    // A crossfade on the very first application would fade the empty window from light to
    // dark, so it is reserved for actual changes while the app is on screen.
    if (appliedTheme !== null && appliedTheme !== next) {
      if (fadeTimer !== undefined) window.clearTimeout(fadeTimer)
      root.dataset.themeAnimating = ''
      fadeTimer = window.setTimeout(() => {
        delete root.dataset.themeAnimating
        fadeTimer = undefined
      }, THEME_FADE_MS)
    }
    appliedTheme = next
    root.classList.toggle('dark', next === 'dark')
    root.dataset.theme = theme
  }

  sync()

  if (theme !== 'system') {
    return () => undefined
  }
  const media = window.matchMedia(DARK_QUERY)
  media.addEventListener('change', sync)
  return () => media.removeEventListener('change', sync)
}
