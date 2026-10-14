import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import i18next from 'i18next'
import { describe, expect, it } from 'vitest'

import en from '@/shared/i18n/locales/en.json'

/** Flattens nested translation objects into dotted keys. */
function flatten(value: unknown, prefix = ''): string[] {
  if (typeof value !== 'object' || value === null) return [prefix]
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    flatten(child, prefix.length > 0 ? `${prefix}.${key}` : key),
  )
}

/**
 * The suffix i18next hangs off a key to pick a plural form — the CLDR category the count falls in,
 * in the language it was asked for. Each language uses the categories its own rules produce: the
 * English `one`/`other` pair, Russian's `few` (2–4) and `many` (0, 5–20) on top of them, and
 * Chinese's and Japanese's single `other`.
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/

/** One language's keys, split into the messages that never vary by count and the plurals' bases. */
function split(keys: string[]): { plain: string[]; plural: string[] } {
  const plain: string[] = []
  const plural: string[] = []
  for (const key of keys) {
    const base = key.replace(PLURAL_SUFFIX, '')
    if (base === key) plain.push(key)
    else if (!plural.includes(base)) plural.push(base)
  }
  return { plain: plain.sort(), plural: plural.sort() }
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
  it('define the same keys in every language, plural forms aside', () => {
    // A plural is one message, not one message per form: each language defines the forms its own
    // rules ask for, so what every catalogue has to agree on is the *base* (`agents.card.skills`),
    // not the suffixes hanging off it.
    const english = split(flatten(en))
    for (const [code, messages] of Object.entries(locales)) {
      const translated = split(flatten(messages))
      expect(translated.plain, `${code} keys`).toEqual(english.plain)
      expect(translated.plural, `${code} plural keys`).toEqual(english.plural)
    }
  })

  /**
   * Every plural resolves in the language it is asked for, whatever the count is.
   *
   * A form a language does not define is not a small hole: i18next asks for exactly one form per
   * count and falls through to the fallback language for anything else, which is how the Russian
   * interface came to print "Install all 15 on screen" — English in a Russian window — for every
   * count but 1, 21 and 101. The instance here is deliberately given no fallback language, so a
   * form that is missing answers with the key itself and fails the case instead of being papered
   * over by another language's text.
   */
  it('resolve every plural in the language itself, for every count it can be shown with', async () => {
    // Enough counts to reach every category of every language shipped: Russian's `many` is 0 and
    // 5–20, its `few` is 2–4, its `one` is 1 and 21 — English's single split (`other`) is covered
    // by the rest.
    const counts = [0, 1, 2, 3, 4, 5, 11, 15, 21, 22, 25, 100, 101, 111]
    const { plural } = split(flatten(en))
    const catalogues = { en, ...locales }

    const instance = i18next.createInstance()
    await instance.init({
      resources: Object.fromEntries(
        Object.entries(catalogues).map(([code, translation]) => [code, { translation }]),
      ),
      lng: 'en',
      fallbackLng: false,
      interpolation: { escapeValue: false },
      returnNull: false,
    })

    for (const code of Object.keys(catalogues)) {
      for (const base of plural) {
        for (const count of counts) {
          expect(instance.t(base, { count, lng: code }), `${code}: ${base} · ${count}`).not.toBe(
            base,
          )
        }
      }
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
