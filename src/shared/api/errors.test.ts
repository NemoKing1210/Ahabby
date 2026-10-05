import { describe, expect, it } from 'vitest'

import { isStaleFileError, toAppError } from './errors'

describe('toAppError', () => {
  it('keeps the backend code and message', () => {
    const error = toAppError({ code: 'stale_file', message: '/tmp/x.json changed on disk' })
    expect(error.code).toBe('stale_file')
    expect(error.message).toBe('/tmp/x.json changed on disk')
  })

  it('maps unknown shapes to the unknown code', () => {
    expect(toAppError({ code: 'not_a_real_code', message: 'x' }).code).toBe('unknown')
    expect(toAppError({ nope: true }).code).toBe('unknown')
    expect(toAppError(new Error('boom')).code).toBe('unknown')
    expect(toAppError(null).code).toBe('unknown')
    expect(toAppError('plain string')).toEqual({ code: 'unknown', message: 'plain string' })
  })

  it('always yields a non-empty message', () => {
    const inputs = [undefined, null, {}, { code: 'io' }, '', 42]
    for (const [index, input] of inputs.entries()) {
      expect(toAppError(input).message.length, `input #${index}`).toBeGreaterThan(0)
    }
  })

  it('recognises the stale file error used by the editor', () => {
    expect(isStaleFileError({ code: 'stale_file', message: 'x' })).toBe(true)
    expect(isStaleFileError({ code: 'io', message: 'x' })).toBe(false)
  })
})
