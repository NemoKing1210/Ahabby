import { ipc } from '@/shared/api/ipc'
import type { Theme } from '@/shared/bindings/Theme'

/**
 * Theme handling.
 *
 * `system` is resolved against `prefers-color-scheme` and kept in sync while the app runs;
 * the resolved value is what the CSS tokens key off (`html.dark`). The same resolved theme
 * is pushed to the native window chrome, so the title bar never drifts from the palette.
 *
 * Every side effect goes through {@link ThemeHost}, which keeps the logic pure enough to
 * unit test without a DOM, a media query or a backend.
 */

export type ResolvedTheme = 'light' | 'dark'

const DARK_QUERY = '(prefers-color-scheme: dark)'

/** Must match the token transition in `globals.css`. */
export const THEME_FADE_MS = 240

/** Side effects `createThemeApplier` needs; the browser implementation is below. */
export interface ThemeHost {
  /** Element carrying the `dark` class, `data-theme` and the design tokens. */
  root: HTMLElement
  /** Whether the OS is asking for a dark interface right now. */
  systemPrefersDark: () => boolean
  /** Calls the listener whenever the OS preference flips; returns the unsubscribe. */
  watchSystem: (listener: () => void) => () => void
  /** Resolved `--ah-background` / `--ah-foreground`, for the native caption. */
  nativeColors: () => { caption: string; text: string }
  /** Hands the native window its chrome. Never throws: a failure is not worth surfacing. */
  applyNative: (
    theme: Theme,
    resolved: ResolvedTheme,
    colors: { caption: string; text: string },
  ) => void
}

export interface ThemeApplier {
  /** Applies `theme` and returns what it resolved to. */
  apply: (theme: Theme) => ResolvedTheme
  /** Drops the OS subscription and the pending crossfade. */
  dispose: () => void
}

export function resolveTheme(theme: Theme, systemPrefersDark: boolean): ResolvedTheme {
  if (theme === 'light' || theme === 'dark') return theme
  return systemPrefersDark ? 'dark' : 'light'
}

/**
 * Builds an applier over `host`.
 *
 * The applier owns the single OS subscription, so a later `apply` replaces the previous one
 * instead of stacking listeners on top of it — a stale listener would otherwise re-apply a
 * theme the user has already moved on from.
 */
export function createThemeApplier(host: ThemeHost): ThemeApplier {
  let applied: ResolvedTheme | null = null
  let unsubscribe: (() => void) | null = null
  let fadeTimer: number | undefined

  const sync = (theme: Theme) => {
    const next = resolveTheme(theme, host.systemPrefersDark())
    // A crossfade on the very first application would fade the empty window from light to
    // dark, so it is reserved for actual changes while the app is on screen.
    if (applied !== null && applied !== next) {
      window.clearTimeout(fadeTimer)
      host.root.dataset.themeAnimating = ''
      fadeTimer = window.setTimeout(() => {
        delete host.root.dataset.themeAnimating
        fadeTimer = undefined
      }, THEME_FADE_MS)
    }
    applied = next
    host.root.classList.toggle('dark', next === 'dark')
    host.root.dataset.theme = theme
    host.applyNative(theme, next, host.nativeColors())
    return next
  }

  return {
    apply(theme) {
      unsubscribe?.()
      unsubscribe = theme === 'system' ? host.watchSystem(() => sync(theme)) : null
      return sync(theme)
    },
    dispose() {
      unsubscribe?.()
      unsubscribe = null
      if (fadeTimer !== undefined) {
        clearTimeout(fadeTimer)
        fadeTimer = undefined
      }
    },
  }
}

function browserThemeHost(): ThemeHost {
  return {
    root: document.documentElement,
    systemPrefersDark: () => window.matchMedia(DARK_QUERY).matches,
    watchSystem: (listener) => {
      const media = window.matchMedia(DARK_QUERY)
      media.addEventListener('change', listener)
      return () => media.removeEventListener('change', listener)
    },
    nativeColors: () => {
      // The `--ah-*` custom properties are not animatable, so they already hold the new
      // palette even while the derived colours are still crossfading.
      const tokens = getComputedStyle(document.documentElement)
      return {
        caption: tokens.getPropertyValue('--ah-background').trim(),
        text: tokens.getPropertyValue('--ah-foreground').trim(),
      }
    },
    applyNative: (theme, resolved, colors) => {
      // The Vite-only dev server has no backend and a failed repaint is not worth a toast.
      void ipc
        .setWindowTheme(theme, resolved === 'dark', colors.caption, colors.text)
        .catch(() => undefined)
    },
  }
}

/** The app-wide applier: one instance, so exactly one OS subscription ever exists. */
export const themeApplier = createThemeApplier(browserThemeHost())
