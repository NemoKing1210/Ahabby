/**
 * The terminal's look, read from the app's design tokens.
 *
 * xterm paints into a canvas, so it cannot use `var(--…)` the way the rest of the interface does:
 * the resolved token values are read from `documentElement` and handed to the terminal as literal
 * colours. Background, foreground, cursor and selection therefore follow the theme *and* the
 * accent the user picked; the 16 ANSI colours come from the palette those tokens describe (they
 * are what a program asks for when it wants "green", not an accent), with a light and a dark
 * variant so neither has unreadable defaults.
 */

import type { ITheme } from '@xterm/xterm'

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

/** `#rgb` / `#rrggbb` → `rgb(… / alpha)`; `undefined` when the value is not a hex. */
export function withAlpha(color: string, alpha: number): string | undefined {
  const hex = color.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined
  const r = Number.parseInt(full.slice(0, 2), 16)
  const g = Number.parseInt(full.slice(2, 4), 16)
  const b = Number.parseInt(full.slice(4, 6), 16)
  return `rgb(${r} ${g} ${b} / ${alpha})`
}

export function terminalTheme(root: HTMLElement = document.documentElement): ITheme {
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
