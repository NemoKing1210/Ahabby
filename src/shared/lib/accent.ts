import type { AccentColor } from '@/shared/bindings/AccentColor'

/**
 * Accent colours.
 *
 * A preset is nothing but a base hex: the hover, pressed, tinted-surface and readable-ink
 * tokens are derived from it in CSS with `color-mix`, which gives light and dark their own
 * mix direction without a second hand-written table.
 *
 * The default preset is deliberately not derived — while no accent is chosen, `globals.css`
 * keeps its hand-tuned palette untouched.
 */

export interface AccentPreset {
  id: Exclude<AccentColor, 'custom'>
  hex: string
}

/** Mirrors the accent literals in `globals.css` for the default (clay) case. */
export const DEFAULT_ACCENT_HEX = '#d97757'

export const ACCENT_PRESETS: readonly AccentPreset[] = [
  { id: 'clay', hex: DEFAULT_ACCENT_HEX },
  { id: 'indigo', hex: '#7b83eb' },
  { id: 'sky', hex: '#5b9bd5' },
  { id: 'teal', hex: '#4aa79b' },
  { id: 'green', hex: '#7fa05f' },
  { id: 'amber', hex: '#d99a4e' },
  { id: 'violet', hex: '#a682d9' },
  { id: 'rose', hex: '#d97a94' },
  { id: 'graphite', hex: '#8a877e' },
]

/** The preset's hex, or `null` for `custom` (which reads `Settings.accentCustom`). */
export function presetHex(accent: AccentColor): string | null {
  return ACCENT_PRESETS.find((preset) => preset.id === accent)?.hex ?? null
}

/** `#abc` / `abc` / `#AABBCC` → `#aabbcc`; anything else is not a colour. */
export function normalizeHex(value: string): string | null {
  const digits = value.trim().replace(/^#/, '')
  if (/^[0-9a-f]{3}$/i.test(digits)) {
    const expanded = digits
      .split('')
      .map((digit) => digit + digit)
      .join('')
    return `#${expanded.toLowerCase()}`
  }
  if (/^[0-9a-f]{6}$/i.test(digits)) {
    return `#${digits.toLowerCase()}`
  }
  return null
}

/** sRGB relative luminance, as defined by WCAG. */
export function relativeLuminance(hex: string): number {
  const digits = normalizeHex(hex)?.slice(1)
  if (!digits) return 1
  const channels = [0, 2, 4].map((offset) => Number.parseInt(digits.slice(offset, offset + 2), 16))
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue
}

/**
 * Ink that stays readable on `hex`: the warm near-black the design already uses on the
 * default accent for anything reasonably light, white only for genuinely dark colours.
 */
export function readableForeground(hex: string): string {
  return relativeLuminance(hex) > 0.22 ? '#17100c' : '#ffffff'
}

/**
 * A stylesheet repointing every accent token at `hex`, for both themes.
 *
 * `html:root` / `html.dark` carry one element of specificity more than the `.dark` block in
 * `globals.css`, so the override wins no matter where the document places it — a Vite HMR
 * round can inject the app stylesheet *after* this one.
 */
export function accentCss(hex: string): string {
  const normal = normalizeHex(hex)
  if (!normal) {
    throw new Error(`accentCss: not a colour: ${hex}`)
  }
  const soft = `color-mix(in oklab, ${normal} 16%, var(--ah-surface))`
  const softDark = `color-mix(in oklab, ${normal} 22%, var(--ah-surface))`
  return [
    'html:root{',
    `--ah-accent:${normal};`,
    `--ah-accent-hover:color-mix(in oklab, ${normal} 88%, #000);`,
    `--ah-accent-strong:color-mix(in oklab, ${normal} 76%, #000);`,
    `--ah-accent-soft:${soft};`,
    `--ah-accent-foreground:${readableForeground(normal)};`,
    '}',
    'html.dark{',
    `--ah-accent-hover:color-mix(in oklab, ${normal} 86%, #fff);`,
    `--ah-accent-strong:color-mix(in oklab, ${normal} 80%, #fff);`,
    `--ah-accent-soft:${softDark};`,
    '}',
  ].join('')
}
