import type { CSSProperties } from 'react'

/**
 * The two numbers a tag's colour is built from, both hashed out of its name.
 *
 * The hue is which colour it is; the tone is how saturated that colour is painted (a fraction of
 * the theme's chroma). The tone is what keeps a hash honest: two names can hash to the same
 * degree, and two tags that differ only in tone still read as two colours side by side — which is
 * exactly the case the shipped vocabulary hits, so the pair is what has to stay distinct, not the
 * hue alone. `tagColor.test.ts` holds the shipped tags to that.
 *
 * The hash is FNV-1a: a one-letter change moves the result far away instead of nudging it, so
 * `docs` and `docs-api` never end up looking alike. The name is folded to lower case first —
 * the backend treats `Design` and `design` as one tag, and two colours for one tag would be odd.
 */
function hashOf(tag: string): number {
  const name = tag.trim().toLowerCase()
  let hash = 0x811c9dc5
  for (let index = 0; index < name.length; index += 1) {
    hash ^= name.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return hash >>> 0
}

/** How saturated a tag's hue is painted, as a fraction of the theme's own chroma. */
const TONES = [0.8, 1, 1.25]

/** The hue a tag's name hashes to, in degrees. */
export function tagHue(tag: string): number {
  return hashOf(tag) % 360
}

/** The tone a tag's name hashes to. */
export function tagTone(tag: string): number {
  return TONES[(hashOf(tag) >>> 9) % TONES.length] ?? 1
}

/**
 * The inline style that hands a tag's colour to `.ah-tag` (see `globals.css`).
 *
 * Only these two come from the name: how light the colour is and what a tone of 1 means are the
 * theme's, which is what keeps a hashed colour readable in either theme instead of being a
 * random surprise on a dark background. Nothing here depends on the other tags on screen.
 */
export function tagColor(tag: string): CSSProperties {
  return {
    '--ah-tag-hue': `${tagHue(tag)}`,
    '--ah-tag-tone': `${tagTone(tag)}`,
  } as CSSProperties
}
