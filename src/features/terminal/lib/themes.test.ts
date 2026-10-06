import { describe, expect, it } from 'vitest'

import type { ITheme } from '@xterm/xterm'

import type { TerminalTheme } from '@/shared/bindings/TerminalTheme'
import en from '@/shared/i18n/locales/en.json'
import ru from '@/shared/i18n/locales/ru.json'

import { terminalTheme } from './theme'
import { TERMINAL_PRESET_THEMES, TERMINAL_THEME_ORDER } from './themes'

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
