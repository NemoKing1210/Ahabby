/**
 * The terminal's look.
 *
 * xterm paints into a canvas, so it cannot use `var(--…)` the way the rest of the interface does:
 * the resolved token values are read from `documentElement` and handed to the terminal as literal
 * colours. That is what the `auto` scheme does — background, foreground, cursor and selection
 * follow the theme *and* the accent the user picked, and the 16 ANSI colours come from the palette
 * those tokens describe (they are what a program asks for when it wants "green", not an accent),
 * with a light and a dark variant so neither has unreadable defaults.
 *
 * Any other scheme is a fixed palette from `themes.ts`, chosen in Settings and painted as-is. The
 * canvas is only part of the terminal, though: the strip around it and the find bar floating over
 * it are ordinary elements built from the design tokens. For a fixed scheme those tokens are
 * re-declared on the terminal's own root (`terminalTokens`), so the whole panel — not just the
 * text area — is in the chosen palette.
 */

import type { CSSProperties } from 'react'
import type { ITheme } from '@xterm/xterm'

import type { TerminalTheme } from '@/shared/bindings/TerminalTheme'

import { isLight, mix, presetTheme, withAlpha } from './themes'

/** Dark-mode ANSI colours, matching the warm token palette in `globals.css`. */
const DARK_ANSI = {
  black: '#3a3935',
  red: '#c0573f',
  green: '#788c5d',
  yellow: '#c08a3e',
  blue: '#6a9bcc',
  magenta: '#b06b9a',
  cyan: '#4aa79b',
  white: '#d9d5c6',
  brightBlack: '#83817a',
  brightRed: '#e08a6f',
  brightGreen: '#a3b884',
  brightYellow: '#ddb172',
  brightBlue: '#8cb4dc',
  brightMagenta: '#c98cbb',
  brightCyan: '#6fc3b6',
  brightWhite: '#faf9f5',
} as const

/** Light-mode ANSI colours: the same hues, darkened until they read on a paper background. */
const LIGHT_ANSI = {
  black: '#141413',
  red: '#a8472f',
  green: '#5f7048',
  yellow: '#8a6122',
  blue: '#4a79a8',
  magenta: '#8f4f7d',
  cyan: '#2f7d72',
  white: '#5e5d59',
  brightBlack: '#5e5d59',
  brightRed: '#c0573f',
  brightGreen: '#788c5d',
  brightYellow: '#c08a3e',
  brightBlue: '#6a9bcc',
  brightMagenta: '#b06b9a',
  brightCyan: '#4aa79b',
  brightWhite: '#141413',
} as const

/** The theme currently painted by `src/app/theme.ts`. */
export function isDarkTheme(root: HTMLElement = document.documentElement): boolean {
  return root.classList.contains('dark')
}

function token(styles: CSSStyleDeclaration, name: string, fallback: string): string {
  return styles.getPropertyValue(name).trim() || fallback
}

/**
 * The palette to paint with: the chosen scheme, or — for `auto` — the resolved design tokens.
 */
export function terminalTheme(
  scheme: TerminalTheme = 'auto',
  root: HTMLElement = document.documentElement,
): ITheme {
  return presetTheme(scheme) ?? autoTheme(root)
}

/**
 * The fixed scheme as the app's own CSS variables, to be put on the element that wraps a
 * terminal. Everything inside then reads the scheme through the very tokens the rest of the
 * interface reads — the padding around the canvas, the find bar and its buttons, the input's
 * caret and focus ring — instead of the app theme showing through next to a repainted canvas.
 *
 * `auto` needs none of it and gets `undefined`: its scheme *is* the interface, so the tokens the
 * element inherits are already the ones its canvas was painted with.
 */
export function terminalTokens(
  scheme: TerminalTheme = 'auto',
  root: HTMLElement = document.documentElement,
): CSSProperties | undefined {
  if (scheme === 'auto') return undefined
  const theme = terminalTheme(scheme, root)
  const background = theme.background
  const foreground = theme.foreground
  if (!background || !foreground) return undefined

  const light = isLight(background) ?? true
  const blend = (to: string, t: number) => mix(background, to, t) ?? to
  // The scheme's blue at the end of its pair that reads on this background — the bright variant is
  // a grey on Solarized Light, the base variant is a shadow of itself on Gruvbox.
  const accent = (light ? theme.blue : theme.brightBlue) ?? foreground
  // A wash of a colour over the background: surfaces, hairlines and dimmed text, all solid so an
  // opaque bar can float on the terminal without the text behind it bleeding through.
  const palette: Record<string, string> = {
    background,
    foreground,
    surface: blend(foreground, 0.06),
    'surface-2': blend(foreground, 0.12),
    'surface-3': blend(foreground, 0.18),
    border: blend(foreground, 0.18),
    'border-strong': blend(foreground, 0.32),
    muted: blend(foreground, 0.62),
    faint: blend(foreground, 0.45),
    accent,
    'accent-soft': blend(accent, 0.22),
    'accent-hover': accent,
    'accent-strong': accent,
    'accent-foreground': background,
    ring: accent,
    // The find bar floats one step above the terminal either way, so its shadow has to be
    // stronger on a dark canvas than on the app's own light one.
    'shadow-popover': `0 12px 32px -12px rgb(0 0 0 / ${light ? 0.3 : 0.6})`,
  }

  const tokens: Record<string, string> = {}
  for (const [name, value] of Object.entries(palette)) {
    // `--ah-*` is what the utilities read, `--color-*` is the name the base layer gives the same
    // value (scrollbars, `::selection`, `:focus-visible`). Both have to be re-declared: a `var()`
    // is substituted where it is *declared*, so the alias inherited from `:root` keeps the app's
    // resolved value and cannot pick the scheme up on its own.
    tokens[`--ah-${name}`] = value
    tokens[`--color-${name}`] = value
  }
  // Custom properties only exist through `setProperty`, which is what React does with every `--*`
  // key of a `style` object: the record is exactly that shape.
  return tokens
}

/** The `auto` scheme: the interface's own colours, re-read from the design tokens. */
function autoTheme(root: HTMLElement): ITheme {
  const dark = isDarkTheme(root)
  const styles = getComputedStyle(root)
  const background = token(styles, '--ah-background', dark ? '#1f1e1d' : '#faf9f5')
  const foreground = token(styles, '--ah-foreground', dark ? '#faf9f5' : '#141413')
  const accent = token(styles, '--ah-accent', '#d97757')

  return {
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: withAlpha(accent, 0.3),
    selectionInactiveBackground: withAlpha(accent, 0.16),
    ...(dark ? DARK_ANSI : LIGHT_ANSI),
  }
}

/**
 * Font family and size for the terminal.
 *
 * Both follow the appearance settings: the mono stack is the one the code editor uses, and the
 * size is the app's text scale applied to a 13px base — a terminal with its own zoom would drift
 * from everything else on screen.
 */
export function terminalFont(root: HTMLElement = document.documentElement): {
  fontFamily: string
  fontSize: number
} {
  const styles = getComputedStyle(root)
  const scale = Number.parseFloat(styles.getPropertyValue('--ah-font-scale')) || 1
  return {
    fontFamily: token(styles, '--ah-font-mono', 'monospace'),
    fontSize: Math.round(13 * Math.min(1.5, Math.max(0.8, scale))),
  }
}
