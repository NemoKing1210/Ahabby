import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { SECRET_HINTS, isSecretKey, maskValue } from './mask'

/**
 * These cases mirror `domain::secrets` in Rust one-for-one. If the backend ever marks a key
 * as secret and the frontend does not (or vice versa), the UI would either leak a value or
 * hide a harmless one — which is why the last three cases read the Rust source instead of a
 * copy of it: two literals kept in step by hand drift the first time only one of them is
 * edited, and the failure is silent in a way a reviewer cannot see.
 */
const SECRETS_RS = join(process.cwd(), 'src-tauri/src/domain/secrets.rs')

/** The hint list `domain::secrets` actually ships. */
function rustHints(): string[] {
  const body =
    readFileSync(SECRETS_RS, 'utf8').match(
      /const SECRET_HINTS: &\[&str\] = &\[([\s\S]*?)\n\];/,
    )?.[1] ?? ''
  return [...body.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)
}

/** Keys the backend explicitly exempts from its own hints (`path` contains "auth"? no — but it
 * would match `apikey`… no: it is the reverse guard, a key that must stay readable). */
function rustExemptions(): string[] {
  const line =
    readFileSync(SECRETS_RS, 'utf8')
      .split('\n')
      .find((candidate) => candidate.includes('normalized ==')) ?? ''
  return [...line.matchAll(/"([^"]+)"/g)].map((match) => match[1]!)
}

describe('isSecretKey', () => {
  it('detects the keys agents actually use', () => {
    for (const key of [
      'GITHUB_PERSONAL_ACCESS_TOKEN',
      'api_key',
      'apiKey',
      'ANTHROPIC_API_KEY',
      'Authorization',
      'CLIENT_SECRET',
      'DATABASE_PASSWORD',
      'SLACK_BOT_TOKEN',
    ]) {
      expect(isSecretKey(key), key).toBe(true)
    }
  })

  it('leaves ordinary keys alone', () => {
    for (const key of ['PATH', 'NODE_ENV', 'HOME', 'LOG_LEVEL', 'PUBLIC_KEY', 'KEY_PATH', '']) {
      expect(isSecretKey(key), key).toBe(false)
    }
  })
})

describe('maskValue', () => {
  it('keeps a short hint but never the whole secret', () => {
    expect(maskValue('')).toBe('')
    expect(maskValue('short')).toBe('•••••')
    expect(maskValue('sk-abcdef1234567890')).toBe('sk-••••••90')
    expect(maskValue('sk-abcdef1234567890')).not.toContain('abcdef')
  })
})

describe('parity with domain::secrets', () => {
  it('ships exactly the backend hint list', () => {
    const rust = rustHints()
    expect(rust.length).toBeGreaterThan(10)
    expect([...SECRET_HINTS].sort()).toEqual([...rust].sort())
  })

  it('marks every backend hint as a secret', () => {
    for (const hint of rustHints()) {
      // `isSecretKey` folds case and strips separators, which is why a wrapped hint still hits.
      expect(isSecretKey(`x-${hint}-x`), hint).toBe(true)
    }
  })

  it('exempts exactly the keys the backend exempts', () => {
    const exemptions = rustExemptions()
    expect(exemptions.length).toBeGreaterThan(0)
    for (const key of exemptions) expect(isSecretKey(key), key).toBe(false)
  })
})
