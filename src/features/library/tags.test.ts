import type { Skill } from '@/shared/bindings/Skill'
import { describe, expect, it } from 'vitest'

import { matchesTags, tagVocabulary } from './tags'

function skill(name: string, tags: string[]): Skill {
  return {
    id: name,
    name,
    path: `/skills/${name}`,
    scope: { kind: 'global' },
    agents: [],
    frontmatter: [],
    tags,
    enabled: true,
    removable: true,
    unverified: false,
  }
}

describe('tagVocabulary', () => {
  it('lists each tag once, most-used first, then by name', () => {
    const vocabulary = tagVocabulary([
      skill('a', ['docs', 'pdf']),
      skill('b', ['pdf', 'forms']),
      skill('c', ['PDF']),
    ])

    // `pdf` is carried by three skills, and the spelling of the first one to declare it survives.
    expect(vocabulary).toEqual(['pdf', 'docs', 'forms'])
  })

  it('offers nothing for a library whose skills declare no tags', () => {
    expect(tagVocabulary([skill('a', []), skill('b', [])])).toEqual([])
  })
})

describe('matchesTags', () => {
  it('keeps every skill when no tag is selected', () => {
    expect(matchesTags([], [])).toBe(true)
    expect(matchesTags(['pdf'], ['', '  '])).toBe(true)
  })

  it('keeps a skill carrying any of the selected tags, whatever the case', () => {
    expect(matchesTags(['pdf', 'forms'], ['design', 'PDF'])).toBe(true)
    expect(matchesTags(['forms'], ['pdf'])).toBe(false)
    expect(matchesTags([], ['pdf'])).toBe(false)
  })
})
