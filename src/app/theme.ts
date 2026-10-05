import type { Theme } from '@/shared/bindings/Theme'

/**
 * Theme handling.
 *
 * `system` is resolved against `prefers-color-scheme` and kept in sync while the app runs;
 * the resolved value is what the CSS tokens key off (`html.dark`).
 */

const DARK_QUERY = '(prefers-color-scheme: dark)'

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'light' || theme === 'dark') return theme
  return window.matchMedia(DARK_QUERY).matches ? 'dark' : 'light'
}

export function applyTheme(theme: Theme): () => void {
  const root = document.documentElement
  const sync = () => {
    root.classList.toggle('dark', resolveTheme(theme) === 'dark')
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
