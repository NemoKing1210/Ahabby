import { describe, expect, it } from 'vitest'

import type { ITheme } from '@xterm/xterm'

import type { TerminalTheme } from '@/shared/bindings/TerminalTheme'
import en from '@/shared/i18n/locales/en.json'
import ru from '@/shared/i18n/locales/ru.json'

import { terminalTheme, terminalTokens } from './theme'
import { isLight, mix, TERMINAL_PRESET_THEMES, TERMINAL_THEME_ORDER } from './themes'

const ANSI_KEYS: readonly (keyof ITheme)[] = [
  'black',
  'red',
  'green',
  'yellow',
  'blue',
  'magenta',
  'cyan',
  'white',
  'brightBlack',
  'brightRed',
  'brightGreen',
  'brightYellow',
  'brightBlue',
  'brightMagenta',
  'brightCyan',
  'brightWhite',
]

describe('terminal colour schemes', () => {
  it('shows every fixed palette exactly once, with `auto` first', () => {
    expect(TERMINAL_THEME_ORDER[0]).toBe('auto')
    expect(new Set(TERMINAL_THEME_ORDER).size).toBe(TERMINAL_THEME_ORDER.length)
    expect(
      TERMINAL_THEME_ORDER.filter((id) => id !== 'auto')
        .slice()
        .sort(),
    ).toEqual(Object.keys(TERMINAL_PRESET_THEMES).sort())
  })

  it('labels every scheme in both languages', () => {
    for (const id of TERMINAL_THEME_ORDER) {
      expect(en.settings.terminalThemes[id], `en label: ${id}`).toBeTruthy()
      expect(ru.settings.terminalThemes[id], `ru label: ${id}`).toBeTruthy()
    }
  })

  it('defines a complete palette for every scheme', () => {
    for (const [id, theme] of Object.entries(TERMINAL_PRESET_THEMES)) {
      for (const key of [
        'background',
        'foreground',
        'cursor',
        'selectionBackground',
        ...ANSI_KEYS,
      ]) {
        expect(
          (theme as Record<string, string | undefined>)[key],
          `${id}.${String(key)}`,
        ).toBeTruthy()
      }
    }
  })

  it('paints `auto` from the design tokens and a fixed scheme regardless of them', () => {
    const root = document.createElement('div')
    document.body.append(root)

    root.classList.remove('dark')
    const light = terminalTheme('auto', root)
    const draculaLight = terminalTheme('dracula', root)

    root.classList.add('dark')
    const dark = terminalTheme('auto', root)
    const draculaDark = terminalTheme('dracula', root)
    root.remove()

    // `auto` reads the tokens of the root element; a detached one has no tokens, so the
    // built-in fallbacks are what shows here.
    expect(light.background).toBe('#faf9f5')
    expect(dark.background).toBe('#1f1e1d')

    // A fixed scheme is its own palette: the app theme must not bleed into it.
    expect(draculaLight.background).toBe('#282a36')
    expect(draculaDark.background).toBe(draculaLight.background)
    expect(draculaDark.foreground).toBe(draculaLight.foreground)
    expect(draculaDark.red).toBe(draculaLight.red)
  })

  it('falls back to `auto` for a scheme it does not know', () => {
    const root = document.createElement('div')
    expect(terminalTheme('nonsense' as TerminalTheme, root)).toEqual(terminalTheme('auto', root))
  })
})

/** The tokens as plain strings: `CSSProperties` does not model custom properties. */
function tokensOf(scheme: TerminalTheme): Record<string, string> {
  return (terminalTokens(scheme) ?? {}) as unknown as Record<string, string>
}

describe('colour arithmetic', () => {
  it('walks from one colour to another', () => {
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080')
    expect(mix('#282a36', '#f8f8f2', 0)).toBe('#282a36')
    expect(mix('#282a36', '#f8f8f2', 1)).toBe('#f8f8f2')
    expect(mix('#abc', '#ffffff', 0)).toBe('#aabbcc')
    expect(mix('not a colour', '#ffffff', 0.5)).toBeUndefined()
  })

  it('tells a paper background from a night one', () => {
    expect(isLight('#fdf6e3')).toBe(true)
    expect(isLight('#282a36')).toBe(false)
    expect(isLight('rgba(0, 0, 0, 0.5)')).toBeUndefined()
  })
})

describe('terminal surface tokens', () => {
  it('gives `auto` nothing to re-declare', () => {
    expect(terminalTokens('auto')).toBeUndefined()
  })

  it('re-declares the interface tokens from a fixed palette', () => {
    const tokens = tokensOf('dracula')
    expect(tokens['--ah-background']).toBe('#282a36')
    expect(tokens['--ah-foreground']).toBe('#f8f8f2')
    // Opaque surfaces: the find bar floats on the canvas, so nothing may bleed through it.
    expect(tokens['--ah-surface']).toMatch(/^#[0-9a-f]{6}$/)
    expect(tokens['--ah-surface']).not.toBe(tokens['--ah-background'])
    expect(tokens['--ah-border']).not.toBe(tokens['--ah-background'])
  })

  it('re-declares every token under the name the base layer reads', () => {
    for (const [name, value] of Object.entries(tokensOf('nord'))) {
      if (name.startsWith('--ah-')) {
        expect(tokensOf('nord')[name.replace('--ah-', '--color-')], name).toBe(value)
      }
    }
  })

  it('takes its accent from the scheme, at the end of the pair that reads', () => {
    expect(tokensOf('solarized-light')['--ah-accent']).toBe('#268bd2')
    expect(tokensOf('gruvbox')['--ah-accent']).toBe('#83a598')
  })

  it('paints the same palette whatever the app theme is', () => {
    const root = document.createElement('div')
    document.body.append(root)
    root.classList.remove('dark')
    const light = tokensOf('gruvbox')
    root.classList.add('dark')
    const dark = terminalTokens('gruvbox', root)
    root.remove()

    expect(dark).toEqual(light)
  })
})
