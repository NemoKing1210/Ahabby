import { describe, expect, it } from 'vitest'

import en from '@/shared/i18n/locales/en.json'
import ru from '@/shared/i18n/locales/ru.json'

/** Flattens nested translation objects into dotted keys. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix.length > 0 ? `${prefix}.${key}` : key),
  )
}

describe('locales', () => {
  it('define exactly the same keys in every language', () => {
    const english = flatten(en).sort()
    const russian = flatten(ru).sort()
    expect(russian).toEqual(english)
  })

  it('have no empty strings', () => {
    const entries = (value: unknown, prefix = ''): [string, string][] => {
      if (typeof value === 'string') return [[prefix, value]]
      if (typeof value !== 'object' || value === null) return []
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        entries(child, prefix.length > 0 ? `${prefix}.${key}` : key),
      )
    }

    for (const [key, text] of [...entries(en), ...entries(ru)]) {
      expect(text.trim().length, `empty translation: ${key}`).toBeGreaterThan(0)
    }
  })
})
