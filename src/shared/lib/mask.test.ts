import { describe, expect, it } from 'vitest'

import { isSecretKey, maskValue } from './mask'

/**
 * These cases mirror `domain::secrets` in Rust one-for-one. If the backend ever marks a key
 * as secret and the frontend does not (or vice versa), the UI would either leak a value or
 * hide a harmless one.
 */
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
