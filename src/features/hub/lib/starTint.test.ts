import { describe, expect, it } from 'vitest'

import { starShare, starTint } from './starTint'

describe('starShare', () => {
  it('leaves a collection with no stars the muted ink every count had before', () => {
    expect(starShare(0)).toBe(0)
    expect(starShare(1)).toBe(0)
    expect(starShare(9)).toBe(0)
    expect(starShare(10)).toBe(0)
  })

  it('turns golder with every tenfold, and is full gold only at the top of the scale', () => {
    // A step of the same size for each tenfold: the scale is logarithmic, not linear.
    const a = starShare(100)
    const b = starShare(1_000)
    const c = starShare(10_000)
    expect(a).toBeGreaterThan(0)
    expect(b - a).toBeCloseTo(c - b, 5)
    expect(c).toBeGreaterThan(b)
    expect(starShare(250_000)).toBe(1)
    // Past the last anchor it stays the gold it is, rather than running off the end of the mix.
    expect(starShare(9_000_000)).toBe(1)
  })

  it('never leaves the range the mix can take, whatever the number is', () => {
    for (const stars of [
      -5,
      0,
      1,
      42,
      2_048,
      99_999,
      400_000,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      const share = starShare(stars)
      expect(share).toBeGreaterThanOrEqual(0)
      expect(share).toBeLessThanOrEqual(1)
    }
  })

  it('hands the share over as the percentage `.ah-stars` mixes with', () => {
    expect(starTint(0)).toMatchObject({ '--ah-star-share': '0.0%' })
    expect(starTint(18_432)).toMatchObject({ '--ah-star-share': '74.3%' })
    expect(starTint(300_000)).toMatchObject({ '--ah-star-share': '100.0%' })
  })
})
