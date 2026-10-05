import type { FontFamily } from '@/shared/bindings/FontFamily'
import type { MonoFont } from '@/shared/bindings/MonoFont'
import type { Settings } from '@/shared/bindings/Settings'
import { accentCss, normalizeHex, presetHex } from '@/shared/lib/accent'

/**
 * Appearance handling: accent colour, interface size, text size and fonts.
 *
 * Everything is expressed as CSS custom properties on the root element, which is why the
 * change is instant and needs no re-render — the two size knobs and the font stacks are all
 * read by the stylesheet (`globals.css`). The default of every knob is left to the
 * stylesheet: an untouched property is removed instead of re-written, so the designed
 * palette and stacks stay the single source of truth for anyone who never opens Settings.
 *
 * Kept behind a {@link AppearanceHost} so the mapping can be unit tested without a DOM.
 */

/** The appearance slice of `Settings`: everything applied at runtime. */
export type AppearanceSettings = Pick<
  Settings,
  'accent' | 'accentCustom' | 'interfaceScale' | 'textScale' | 'fontFamily' | 'monoFont'
>

/** Mirror of the Rust defaults in `services/settings.rs`; used by "reset appearance". */
export const APPEARANCE_DEFAULTS: AppearanceSettings = {
  accent: 'clay',
  accentCustom: null,
  interfaceScale: 100,
  textScale: 100,
  fontFamily: 'inter',
  monoFont: 'jetbrains',
}

/** The Rust clamp, mirrored: a hand-edited settings file cannot distort the layout. */
const MIN_SCALE = 80
const MAX_SCALE = 150

/**
 * Stacks for the non-default choices. `inter` and `jetbrains` are absent on purpose — they
 * are the defaults, and those live in `globals.css`.
 */
const SANS_STACKS: Partial<Record<FontFamily, { sans: string; serif: string }>> = {
  system: {
    sans: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif",
    serif: "ui-serif, Georgia, 'Times New Roman', serif",
  },
  serif: {
    sans: "'Lora', ui-serif, Georgia, 'Times New Roman', serif",
    serif: "'Lora', ui-serif, Georgia, 'Times New Roman', serif",
  },
}

const MONO_STACKS: Partial<Record<MonoFont, string>> = {
  system: "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace",
}

export interface AppearanceHost {
  /** Element carrying the design tokens. */
  root: HTMLElement
  /** Installs the accent override stylesheet; `null` removes it. */
  setAccentStyles: (css: string | null) => void
}

export interface AppearanceApplier {
  apply: (settings: AppearanceSettings) => void
}

/**
 * The accent stylesheet for a choice, or `null` when the stylesheet's own palette applies
 * (the default preset, or a `custom` accent whose hex the user has not finished typing).
 */
export function accentStylesheet(accent: Settings['accent'], custom: string | null): string | null {
  if (accent === 'clay') return null
  const hex = accent === 'custom' ? normalizeHex(custom ?? '') : presetHex(accent)
  return hex ? accentCss(hex) : null
}

export function createAppearanceApplier(host: AppearanceHost): AppearanceApplier {
  const setStack = (property: string, stack: string | undefined) => {
    if (stack) host.root.style.setProperty(property, stack)
    else host.root.style.removeProperty(property)
  }

  return {
    apply(settings) {
      const uiScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, settings.interfaceScale)) / 100
      const textScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, settings.textScale)) / 100
      host.root.style.setProperty('--ah-ui-scale', String(uiScale))
      host.root.style.setProperty('--ah-font-scale', String(textScale))

      const family = SANS_STACKS[settings.fontFamily]
      setStack('--ah-font-sans', family?.sans)
      setStack('--ah-font-serif', family?.serif)
      setStack('--ah-font-mono', MONO_STACKS[settings.monoFont])

      host.setAccentStyles(accentStylesheet(settings.accent, settings.accentCustom))
    },
  }
}

function browserAppearanceHost(): AppearanceHost {
  const STYLE_ID = 'ah-accent-styles'
  return {
    root: document.documentElement,
    setAccentStyles: (css) => {
      const existing = document.getElementById(STYLE_ID)
      if (!css) {
        existing?.remove()
        return
      }
      const style =
        existing instanceof HTMLStyleElement ? existing : document.createElement('style')
      if (!existing) {
        style.id = STYLE_ID
        document.head.append(style)
      }
      style.textContent = css
    },
  }
}

/** The app-wide applier: one instance, so Settings and boot cannot disagree. */
export const appearanceApplier = createAppearanceApplier(browserAppearanceHost())
