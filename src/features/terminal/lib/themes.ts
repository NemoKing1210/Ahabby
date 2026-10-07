/**
 * Colour schemes for the built-in terminal.
 *
 * `auto` is deliberately absent from the table: it is derived from the interface at read time
 * (see `terminalTheme`), so it keeps following the app theme and the accent. Every other scheme is
 * a fixed palette — a terminal that is meant to look like Dracula has to look like Dracula in
 * either app theme, so the hexes are literals rather than token references. They are the palettes
 * the projects themselves publish (the same values their official themes ship).
 *
 * The ids are validated by the backend (`services::settings::TerminalTheme`), which is the list a
 * hand-edited `settings.json` is checked against; `TERMINAL_THEME_ORDER` is what the settings page
 * renders, and `TERMINAL_PRESET_THEMES` is exhaustive by construction, so adding a scheme in Rust
 * fails to compile until its palette is here.
 */

import type { ITheme } from '@xterm/xterm'

import type { TerminalTheme } from '@/shared/bindings/TerminalTheme'

/** Every scheme but `auto`, which cannot have a palette of its own. */
export type TerminalPresetId = Exclude<TerminalTheme, 'auto'>

/** The 16 ANSI colours; xterm reads exactly these keys off `ITheme`. */
type AnsiPalette = Pick<
  ITheme,
  | 'black'
  | 'red'
  | 'green'
  | 'yellow'
  | 'blue'
  | 'magenta'
  | 'cyan'
  | 'white'
  | 'brightBlack'
  | 'brightRed'
  | 'brightGreen'
  | 'brightYellow'
  | 'brightBlue'
  | 'brightMagenta'
  | 'brightCyan'
  | 'brightWhite'
>

/** The channels of `#rgb` / `#rrggbb`; `undefined` when the value is not a hex. */
function channels(color: string): [number, number, number] | undefined {
  const hex = color.trim().replace(/^#/, '')
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((digit) => digit + digit)
          .join('')
      : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return undefined
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ]
}

function toHex([r, g, b]: [number, number, number]): string {
  const pair = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, '0')
  return `#${pair(r)}${pair(g)}${pair(b)}`
}

/** `#rgb` / `#rrggbb` → `rgb(… / alpha)`; `undefined` when the value is not a hex. */
export function withAlpha(color: string, alpha: number): string | undefined {
  const rgb = channels(color)
  return rgb ? `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / ${alpha})` : undefined
}

/**
 * `t` of the way from `from` to `to` — `0` is `from`, `1` is `to`. Solid, unlike {@link withAlpha},
 * so it can paint an opaque surface; `undefined` when either colour is not a hex.
 */
export function mix(from: string, to: string, t: number): string | undefined {
  const a = channels(from)
  const b = channels(to)
  if (!a || !b) return undefined
  return toHex([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t])
}

/** Whether a hex colour reads as a light background; `undefined` when it is not a hex. */
export function isLight(color: string): boolean | undefined {
  const rgb = channels(color)
  if (!rgb) return undefined
  // Perceived brightness rather than a channel average: `#82999f` has to count as dark, and
  // green has to count as light.
  return (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255 > 0.6
}

/** One scheme, from its four display colours and its ANSI set. */
function preset(
  background: string,
  foreground: string,
  cursor: string,
  selection: string,
  ansi: AnsiPalette,
): ITheme {
  return {
    background,
    foreground,
    cursor,
    // The text the cursor sits on: the background is the only colour known to contrast with it.
    cursorAccent: background,
    selectionBackground: selection,
    // Dragging the mouse over a terminal that has lost focus must not shout as loudly.
    selectionInactiveBackground: withAlpha(selection, 0.45) ?? selection,
    ...ansi,
  }
}

const ONE_DARK: AnsiPalette = {
  black: '#282c34',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  brightBlack: '#5c6370',
  brightRed: '#e06c75',
  brightGreen: '#98c379',
  brightYellow: '#e5c07b',
  brightBlue: '#61afef',
  brightMagenta: '#c678dd',
  brightCyan: '#56b6c2',
  brightWhite: '#ffffff',
}

const DRACULA: AnsiPalette = {
  black: '#21222c',
  red: '#ff5555',
  green: '#50fa7b',
  yellow: '#f1fa8c',
  blue: '#bd93f9',
  magenta: '#ff79c6',
  cyan: '#8be9fd',
  white: '#f8f8f2',
  brightBlack: '#6272a4',
  brightRed: '#ff6e6e',
  brightGreen: '#69ff94',
  brightYellow: '#ffffa5',
  brightBlue: '#d6acff',
  brightMagenta: '#ff92df',
  brightCyan: '#a4ffff',
  brightWhite: '#ffffff',
}

const NORD: AnsiPalette = {
  black: '#3b4252',
  red: '#bf616a',
  green: '#a3be8c',
  yellow: '#ebcb8b',
  blue: '#81a1c1',
  magenta: '#b48ead',
  cyan: '#88c0d0',
  white: '#e5e9f0',
  brightBlack: '#4c566a',
  brightRed: '#bf616a',
  brightGreen: '#a3be8c',
  brightYellow: '#ebcb8b',
  brightBlue: '#81a1c1',
  brightMagenta: '#b48ead',
  brightCyan: '#8fbcbb',
  brightWhite: '#eceff4',
}

const GRUVBOX: AnsiPalette = {
  black: '#282828',
  red: '#cc241d',
  green: '#98971a',
  yellow: '#d79921',
  blue: '#458588',
  magenta: '#b16286',
  cyan: '#689d6a',
  white: '#a89984',
  brightBlack: '#928374',
  brightRed: '#fb4934',
  brightGreen: '#b8bb26',
  brightYellow: '#fabd2f',
  brightBlue: '#83a598',
  brightMagenta: '#d3869b',
  brightCyan: '#8ec07c',
  brightWhite: '#ebdbb2',
}

const TOKYO_NIGHT: AnsiPalette = {
  black: '#15161e',
  red: '#f7768e',
  green: '#9ece6a',
  yellow: '#e0af68',
  blue: '#7aa2f7',
  magenta: '#bb9af7',
  cyan: '#7dcfff',
  white: '#a9b1d6',
  brightBlack: '#414868',
  brightRed: '#f7768e',
  brightGreen: '#9ece6a',
  brightYellow: '#e0af68',
  brightBlue: '#7aa2f7',
  brightMagenta: '#bb9af7',
  brightCyan: '#7dcfff',
  brightWhite: '#c0caf5',
}

const CATPPUCCIN: AnsiPalette = {
  black: '#45475a',
  red: '#f38ba8',
  green: '#a6e3a1',
  yellow: '#f9e2af',
  blue: '#89b4fa',
  magenta: '#f5c2e7',
  cyan: '#94e2d5',
  white: '#bac2de',
  brightBlack: '#585b70',
  brightRed: '#f38ba8',
  brightGreen: '#a6e3a1',
  brightYellow: '#f9e2af',
  brightBlue: '#89b4fa',
  brightMagenta: '#f5c2e7',
  brightCyan: '#94e2d5',
  brightWhite: '#a6adc8',
}

/** Solarized keeps one palette for both variants: only the base colours flip. */
const SOLARIZED_ANSI: AnsiPalette = {
  black: '#073642',
  red: '#dc322f',
  green: '#859900',
  yellow: '#b58900',
  blue: '#268bd2',
  magenta: '#d33682',
  cyan: '#2aa198',
  white: '#eee8d5',
  brightBlack: '#586e75',
  brightRed: '#cb4b16',
  brightGreen: '#93a1a1',
  brightYellow: '#657b83',
  brightBlue: '#839496',
  brightMagenta: '#6c71c4',
  brightCyan: '#2aa198',
  brightWhite: '#fdf6e3',
}

const ONE_LIGHT: AnsiPalette = {
  black: '#383a42',
  red: '#e45649',
  green: '#50a14f',
  yellow: '#c18401',
  blue: '#4078f2',
  magenta: '#a626a4',
  cyan: '#0184bc',
  white: '#a0a1a7',
  brightBlack: '#696c77',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#ffffff',
}

/**
 * The schemes in the order Settings shows them: the one that follows the app first, then the dark
 * palettes from the most to the least saturated, then the light ones.
 */
export const TERMINAL_THEME_ORDER = [
  'auto',
  'one-dark',
  'dracula',
  'tokyo-night',
  'catppuccin',
  'nord',
  'gruvbox',
  'solarized-dark',
  'solarized-light',
  'one-light',
] as const satisfies readonly TerminalTheme[]

/**
 * Every fixed scheme. `Record<TerminalPresetId, …>` is on purpose: a scheme added to the Rust enum
 * but not painted here does not compile.
 */
export const TERMINAL_PRESET_THEMES: Record<TerminalPresetId, ITheme> = {
  'one-dark': preset('#282c34', '#abb2bf', '#528bff', '#3e4451', ONE_DARK),
  dracula: preset('#282a36', '#f8f8f2', '#f8f8f2', '#44475a', DRACULA),
  'tokyo-night': preset('#1a1b26', '#c0caf5', '#c0caf5', '#33467c', TOKYO_NIGHT),
  catppuccin: preset('#1e1e2e', '#cdd6f4', '#f5e0dc', '#585b70', CATPPUCCIN),
  nord: preset('#2e3440', '#d8dee9', '#88c0d0', '#434c5e', NORD),
  gruvbox: preset('#282828', '#ebdbb2', '#fe8019', '#504945', GRUVBOX),
  'solarized-dark': preset('#002b36', '#839496', '#93a1a1', '#073642', SOLARIZED_ANSI),
  'solarized-light': preset('#fdf6e3', '#657b83', '#586e75', '#eee8d5', SOLARIZED_ANSI),
  'one-light': preset('#fafafa', '#383a42', '#526fff', '#e5e5e6', ONE_LIGHT),
}

/** The palette of a fixed scheme; `null` for `auto`, which has to be derived from the tokens. */
export function presetTheme(id: TerminalTheme): ITheme | null {
  return id === 'auto' ? null : TERMINAL_PRESET_THEMES[id]
}
