import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import en from '@/shared/i18n/locales/en.json'

/** Flattens nested translation objects into dotted keys. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix.length > 0 ? `${prefix}.${key}` : key),
  )
}

const localeDir = join(process.cwd(), 'src/shared/i18n/locales')
const localeFiles = readdirSync(localeDir).filter(
  (name) => name.endsWith('.json') && name !== 'en.json',
)

const locales = Object.fromEntries(
  localeFiles.map((file) => {
    const code = file.replace(/\.json$/, '')
    const raw = readFileSync(join(localeDir, file), 'utf8')
    return [code, JSON.parse(raw) as Record<string, unknown>]
  }),
)

describe('locales', () => {
  it('define exactly the same keys in every language', () => {
    const english = flatten(en).sort()
    for (const [code, messages] of Object.entries(locales)) {
      expect(flatten(messages).sort(), `${code} keys`).toEqual(english)
    }
  })

  it('have no empty strings', () => {
    const entries = (value: unknown, prefix = ''): [string, string][] => {
      if (typeof value === 'string') return [[prefix, value]]
      if (typeof value !== 'object' || value === null) return []
      return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
        entries(child, prefix.length > 0 ? `${prefix}.${key}` : key),
      )
    }

    for (const [code, messages] of Object.entries({ en, ...locales })) {
      for (const [key, text] of entries(messages)) {
        expect(text.trim().length, `${code}: empty translation: ${key}`).toBeGreaterThan(0)
      }
    }
  })
})
