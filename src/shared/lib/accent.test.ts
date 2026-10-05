import { describe, expect, it } from 'vitest'

import {
  ACCENT_PRESETS,
  accentCss,
  DEFAULT_ACCENT_HEX,
  normalizeHex,
  presetHex,
  readableForeground,
  relativeLuminance,
} from './accent'

describe('normalizeHex', () => {
  it('accepts the shapes a person types', () => {
    expect(normalizeHex('#D97757')).toBe('#d97757')
    expect(normalizeHex('d97757')).toBe('#d97757')
    expect(normalizeHex('  #ABC  ')).toBe('#aabbcc')
    expect(normalizeHex('#abc')).toBe('#aabbcc')
  })

  it('rejects anything that is not a colour', () => {
    expect(normalizeHex('')).toBeNull()
    expect(normalizeHex('#12')).toBeNull()
    expect(normalizeHex('#12345g')).toBeNull()
    expect(normalizeHex('rebeccapurple')).toBeNull()
  })
})

describe('readableForeground', () => {
  it('keeps the warm ink on light accents and switches to white on dark ones', () => {
    expect(readableForeground(DEFAULT_ACCENT_HEX)).toBe('#17100c')
    expect(readableForeground('#f4e3a1')).toBe('#17100c')
    expect(readableForeground('#1e3a8a')).toBe('#ffffff')
  })

  it('keeps every shipped preset readable with the warm ink', () => {
    for (const preset of ACCENT_PRESETS) {
      expect(readableForeground(preset.hex), preset.id).toBe('#17100c')
    }
  })
})

describe('relativeLuminance', () => {
  it('spans black to white', () => {
    expect(relativeLuminance('#000000')).toBe(0)
    expect(relativeLuminance('#ffffff')).toBe(1)
  })
})

describe('presetHex', () => {
  it('resolves a preset and leaves custom to the settings field', () => {
    expect(presetHex('clay')).toBe(DEFAULT_ACCENT_HEX)
    expect(presetHex('custom')).toBeNull()
  })
})

describe('accentCss', () => {
  it('repoints every accent token in both themes', () => {
    const css = accentCss('#7B83EB')

    expect(css).toContain('html:root{--ah-accent:#7b83eb;')
    // Light darkens the accent, dark lightens it; the tinted surface is mixed per theme.
    expect(css).toContain('--ah-accent-hover:color-mix(in oklab, #7b83eb 88%, #000)')
    expect(css).toContain('--ah-accent-strong:color-mix(in oklab, #7b83eb 76%, #000)')
    expect(css).toContain('--ah-accent-soft:color-mix(in oklab, #7b83eb 16%, var(--ah-surface))')
    expect(css).toContain('--ah-accent-foreground:#17100c;')
    expect(css).toContain('html.dark{--ah-accent-hover:color-mix(in oklab, #7b83eb 86%, #fff)')
    expect(css).toContain('--ah-accent-soft:color-mix(in oklab, #7b83eb 22%, var(--ah-surface))')
  })

  it('refuses a value it cannot paint', () => {
    expect(() => accentCss('nope')).toThrow(/not a colour/)
  })
})
