import { describe, expect, it } from 'vitest'

import type { AccentColor } from '@/shared/bindings/AccentColor'
import type { FontFamily } from '@/shared/bindings/FontFamily'
import type { MonoFont } from '@/shared/bindings/MonoFont'

import {
  APPEARANCE_DEFAULTS,
  accentStylesheet,
  createAppearanceApplier,
  type AppearanceSettings,
} from './appearance'

/** A root element plus the accent stylesheet the applier last installed. */
function createHarness() {
  const root = document.createElement('div')
  let accentCss: string | null = null

  const applier = createAppearanceApplier({
    root,
    setAccentStyles: (css) => {
      accentCss = css
    },
  })

  return {
    applier,
    /** What the browser would compute for a token, as written by the applier. */
    tokens: () => root.getAttribute('style') ?? '',
    accent: () => accentCss,
    apply: (settings: Partial<AppearanceSettings>) =>
      applier.apply({ ...APPEARANCE_DEFAULTS, ...settings }),
  }
}

describe('createAppearanceApplier', () => {
  it('leaves the designed defaults to the stylesheet', () => {
    const harness = createHarness()
    harness.apply({})

    expect(harness.tokens()).toContain('--ah-ui-scale: 1')
    expect(harness.tokens()).toContain('--ah-font-scale: 1')
    expect(harness.tokens()).not.toContain('--ah-font-sans')
    expect(harness.tokens()).not.toContain('--ah-font-mono')
    expect(harness.accent()).toBeNull()
  })

  it('maps both size knobs to their own custom property', () => {
    const harness = createHarness()
    harness.apply({ interfaceScale: 110, textScale: 125 })

    expect(harness.tokens()).toContain('--ah-ui-scale: 1.1')
    expect(harness.tokens()).toContain('--ah-font-scale: 1.25')
  })

  it('clamps a hand-edited settings file into the safe range', () => {
    const harness = createHarness()
    harness.apply({ interfaceScale: 10, textScale: 900 })

    expect(harness.tokens()).toContain('--ah-ui-scale: 0.8')
    expect(harness.tokens()).toContain('--ah-font-scale: 1.5')
  })

  it('installs the font stacks of a non-default choice and drops them again', () => {
    const harness = createHarness()

    harness.apply({ fontFamily: 'serif', monoFont: 'system' })
    expect(harness.tokens()).toContain("--ah-font-sans: 'Lora'")
    expect(harness.tokens()).toContain('--ah-font-mono: ui-monospace')

    harness.apply({ fontFamily: 'system', monoFont: 'jetbrains' })
    expect(harness.tokens()).toContain('--ah-font-sans: ui-sans-serif, system-ui')
    expect(harness.tokens()).toContain('--ah-font-serif: ui-serif')
    expect(harness.tokens()).not.toContain('--ah-font-mono')
  })

  it('applies a presets accent and clears it for the default', () => {
    const harness = createHarness()

    harness.apply({ accent: 'violet' })
    expect(harness.accent()).toContain('--ah-accent:#a682d9')

    harness.apply({ accent: 'clay' })
    expect(harness.accent()).toBeNull()
  })

  it('waits for a usable custom accent instead of painting junk', () => {
    const harness = createHarness()

    harness.apply({ accent: 'custom', accentCustom: '#12' })
    expect(harness.accent()).toBeNull()

    harness.apply({ accent: 'custom', accentCustom: '#ABC' })
    expect(harness.accent()).toContain('--ah-accent:#aabbcc')
  })
})

describe('accentStylesheet', () => {
  it('ignores a custom hex that is not used', () => {
    expect(accentStylesheet('teal', '#ffffff')).toContain('#4aa79b')
    expect(accentStylesheet('clay', '#ffffff')).toBeNull()
  })
})

describe('APPEARANCE_DEFAULTS', () => {
  it('mirrors the backend defaults', () => {
    const accent: AccentColor = APPEARANCE_DEFAULTS.accent
    const fontFamily: FontFamily = APPEARANCE_DEFAULTS.fontFamily
    const monoFont: MonoFont = APPEARANCE_DEFAULTS.monoFont

    expect(accent).toBe('clay')
    expect(APPEARANCE_DEFAULTS.accentCustom).toBeNull()
    expect(APPEARANCE_DEFAULTS.interfaceScale).toBe(100)
    expect(APPEARANCE_DEFAULTS.textScale).toBe(100)
    expect(fontFamily).toBe('inter')
    expect(monoFont).toBe('jetbrains')
  })
})
