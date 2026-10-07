import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import { tagColor, tagHue, tagTone } from './tagColor'

/**
 * Every tag the hub's shipped sources declare, read out of the source files themselves.
 *
 * Reading them instead of listing them keeps the test honest about what is actually on screen: a
 * tag added to a source file is a tag the row has to be able to tell apart from the others.
 */
function shippedTags(): string[] {
  const directory = join(process.cwd(), 'src-tauri', 'catalog', 'hub')
  const tags = new Set<string>()
  for (const file of readdirSync(directory)) {
    const source = readFileSync(`${directory}/${file}`, 'utf8')
    for (const match of source.matchAll(/tags = \[([^\]]*)\]/g)) {
      for (const tag of (match[1] ?? '').split(',')) {
        const name = tag.trim().replace(/^"|"$/g, '')
        if (name !== '') tags.add(name)
      }
    }
  }
  return [...tags]
}

describe('tagColor', () => {
  it('gives one tag one colour, whatever case it is written in', () => {
    expect(tagHue('Design')).toBe(tagHue('design'))
    expect(tagHue(' design ')).toBe(tagHue('design'))
    expect(tagTone('Design')).toBe(tagTone('design'))
    expect(tagHue('design')).toBeGreaterThanOrEqual(0)
    expect(tagHue('design')).toBeLessThan(360)
    expect(tagColor('design')).toEqual({
      '--ah-tag-hue': String(tagHue('design')),
      '--ah-tag-tone': String(tagTone('design')),
    })
  })

  it('moves a name that differs by one letter, instead of nudging it', () => {
    // The doc comment promises this: two tags that read alike must not come out looking alike.
    for (const [one, other] of [
      ['docs', 'docs-api'],
      ['design', 'design-system'],
      ['test', 'tests'],
    ]) {
      const distance = Math.abs(tagHue(one ?? '') - tagHue(other ?? ''))
      expect(Math.min(distance, 360 - distance), `${one} vs ${other}`).toBeGreaterThan(5)
    }
  })

  it('gives every tag the hub ships with a colour of its own', () => {
    const tags = shippedTags()
    expect(tags.length).toBeGreaterThan(20)

    const taken = new Map<string, string>()
    for (const tag of tags) {
      const color = `${tagHue(tag)}/${tagTone(tag)}`
      expect(
        taken.get(color),
        `'${tag}' wears the colour of '${taken.get(color) ?? ''}'`,
      ).toBeUndefined()
      taken.set(color, tag)
    }
  })
})
