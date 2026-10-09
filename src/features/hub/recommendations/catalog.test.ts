import { describe, expect, it } from 'vitest'

import { RECOMMENDATION_ROLES, entryIdsForRole, recommendationSourceIds, roleById } from './catalog'

describe('recommendations catalog', () => {
  it('lists every role with at least one pick', () => {
    expect(RECOMMENDATION_ROLES.length).toBeGreaterThanOrEqual(8)
    for (const role of RECOMMENDATION_ROLES) {
      expect(role.picks.length).toBeGreaterThan(0)
    }
  })

  it('uses unique pick ids inside each role', () => {
    for (const role of RECOMMENDATION_ROLES) {
      const ids = role.picks.map((pick) => pick.id)
      expect(new Set(ids).size).toBe(ids.length)
    }
  })

  it('addresses every pick as a hub entry id', () => {
    for (const role of RECOMMENDATION_ROLES) {
      for (const pick of role.picks) {
        expect(pick.entryId).toMatch(/^[a-z0-9_-]+\/.+/)
      }
    }
  })

  it('resolves a role and its entry ids', () => {
    const role = roleById('frontend')
    expect(role.id).toBe('frontend')
    expect(entryIdsForRole('frontend')).toEqual(role.picks.map((pick) => pick.entryId))
  })

  it('covers the collections the shortlists install from', () => {
    const sources = recommendationSourceIds()
    expect(sources).toEqual(
      expect.arrayContaining([
        'anthropic-skills',
        'obra-superpowers',
        'vercel-skills',
        'sentry-skills',
        'trailofbits-skills',
        'cloudflare-skills',
        'expo-skills',
      ]),
    )
  })
})
