import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import type { ConfigFormat } from '@/shared/bindings/ConfigFormat'

import { fileFormat } from './fileFormat'

/**
 * The viewer highlights a file with this function; the backend validates and patches the *same*
 * file with `ConfigFormat::from_extension`. The two must agree about what a document is — a
 * `.mdx` the backend treats as markdown but the viewer as plain text is a file edited without
 * validation, so the extension table is read out of Rust rather than copied here.
 */
const CONFIG_RS = join(process.cwd(), 'src-tauri/src/domain/config.rs')

/** `json` → `json`, `Jsonc` → `jsonc` — the names the bindings use for the Rust variants. */
function variantToFormat(variant: string): ConfigFormat {
  return (variant[0]?.toLowerCase() + variant.slice(1)) as ConfigFormat
}

/** The extensions `from_extension` maps, and to what. */
function backendFormats(): Map<string, ConfigFormat> {
  const body =
    readFileSync(CONFIG_RS, 'utf8').split('pub fn from_extension')[1]?.split('\n    }')[0] ?? ''
  const formats = new Map<string, ConfigFormat>()
  for (const line of body.split('\n')) {
    const arm = line.match(/^\s*("[a-z0-9]+"(?:\s*\|\s*"[a-z0-9]+")*)\s*=>\s*ConfigFormat::(\w+)/)
    if (!arm) continue
    for (const extension of arm[1]!.matchAll(/"([a-z0-9]+)"/g)) {
      formats.set(extension[1]!, variantToFormat(arm[2]!))
    }
  }
  return formats
}

describe('fileFormat', () => {
  it('reads the backend extension table', () => {
    const formats = backendFormats()
    // A parse that quietly found nothing would make the parity case below vacuous.
    expect(formats.size).toBeGreaterThan(6)
    expect(formats.get('json')).toBe('json')
    expect(formats.get('yml')).toBe('yaml')
  })

  it('agrees with the backend about every extension it maps', () => {
    for (const [extension, format] of backendFormats()) {
      expect(fileFormat(`/home/me/prompts/agent.${extension}`), extension).toBe(format)
      expect(fileFormat(`/home/me/settings.${extension}`), extension).toBe(format)
      expect(fileFormat(`/home/me/AGENT.${extension.toUpperCase()}`), extension).toBe(format)
    }
  })

  it('never claims a format the backend would call text', () => {
    const known = new Set(backendFormats().keys())
    for (const extension of ['js', 'ts', 'py', 'lock', 'env', 'gz', 'bak', 'exe']) {
      expect(known.has(extension), extension).toBe(false)
      expect(fileFormat(`/tmp/file.${extension}`), extension).toBe('text')
    }
  })

  it('reads a path with no extension at all as text', () => {
    expect(fileFormat('/home/me/.bashrc')).toBe('text')
    expect(fileFormat('/home/me/Makefile')).toBe('text')
    expect(fileFormat('')).toBe('text')
  })
})
