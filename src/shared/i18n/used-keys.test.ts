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

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'bindings' ? [] : sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

const keys = new Set(flatten(en))
// i18next plurals are written `${key}_one` / `_other`, but used as the bare key with a `count`.
const pluralBases = new Set(
  [...keys]
    .filter((key) => /_(zero|one|two|few|many|other)$/.test(key))
    .map((key) => key.replace(/_(zero|one|two|few|many|other)$/, '')),
)

/**
 * A key the code asks for but the locales never define renders as the key itself — a visible string
 * nobody wrote. The English file is the yardstick; the parity test already holds every other locale
 * to it, so a key present here is present everywhere.
 */
describe('translated keys', () => {
  it('defines every t() key the app uses', () => {
    const root = join(process.cwd(), 'src')
    const missing: string[] = []

    for (const file of sourceFiles(root)) {
      if (file.includes('locales')) continue
      const text = readFileSync(file, 'utf8')
      for (const match of text.matchAll(/\bt\(\s*['"]([A-Za-z0-9_.]+)['"]/g)) {
        const key = match[1]
        if (!key || keys.has(key) || pluralBases.has(key)) continue
        missing.push(`${key} (${file.slice(root.length + 1).replace(/\\/g, '/')})`)
      }
    }

    expect(missing).toEqual([])
  })
})
