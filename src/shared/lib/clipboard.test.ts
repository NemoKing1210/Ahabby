import { afterEach, describe, expect, it, vi } from 'vitest'

import { copyText, readText } from './clipboard'

/**
 * The clipboard is the one surface that is not the same in the packaged app as in a browser:
 * `navigator.clipboard` needs a secure context, which the Tauri custom protocol is not
 * guaranteed to be, so the legacy `execCommand` path is what the user actually gets when the
 * modern one is refused. That fallback, and the element it leaves behind, is what these cases
 * are about.
 */
function stubClipboard(value: {
  writeText?: () => Promise<void>
  readText?: () => Promise<string>
}) {
  Object.defineProperty(navigator, 'clipboard', { value, configurable: true })
}

/** Runs `execCommand('copy')` and remembers the value that was selected at that moment. */
function stubExecCommand(result: boolean | (() => never)): { selected: string | null } {
  const seen: { selected: string | null } = { selected: null }
  document.execCommand = vi.fn(() => {
    seen.selected = document.querySelector('textarea')?.value ?? null
    if (typeof result === 'function') result()
    return result as boolean
  })
  return seen
}

afterEach(() => {
  Reflect.deleteProperty(navigator, 'clipboard')
})

describe('copyText', () => {
  it('uses the modern clipboard when the webview offers one', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    stubClipboard({ writeText })

    expect(await copyText('claude --resume')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('claude --resume')
    // No legacy element is left in the document.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('falls back to the legacy path when the modern one is refused', async () => {
    // A refused write is exactly the insecure-context case the fallback exists for.
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error('denied')) })
    const seen = stubExecCommand(true)

    expect(await copyText('sk-ant-api03-secret')).toBe(true)
    expect(seen.selected).toBe('sk-ant-api03-secret')
  })

  it('falls back when the webview has no clipboard at all', async () => {
    stubClipboard({})
    const seen = stubExecCommand(true)

    expect(await copyText('a path')).toBe(true)
    expect(seen.selected).toBe('a path')
  })

  it('reports failure instead of throwing, and still cleans up', async () => {
    stubClipboard({})
    stubExecCommand(() => {
      throw new Error('copy is disabled')
    })

    expect(await copyText('anything')).toBe(false)
    // The temporary field is removed even on the throwing path — it must not stay in the body
    // of a window the user is still typing into.
    expect(document.querySelector('textarea')).toBeNull()
  })

  it('reports a refused copy as failure', async () => {
    stubClipboard({})
    stubExecCommand(false)

    expect(await copyText('anything')).toBe(false)
  })
})

describe('readText', () => {
  it('returns what the clipboard holds', async () => {
    stubClipboard({ readText: vi.fn().mockResolvedValue('pasted from the terminal') })

    expect(await readText()).toBe('pasted from the terminal')
  })

  it('answers null rather than an empty string when the read is refused', async () => {
    // A caller has to be able to tell "nothing there" from "the webview said no".
    stubClipboard({ readText: vi.fn().mockRejectedValue(new Error('denied')) })

    expect(await readText()).toBeNull()
  })

  it('answers null when there is no clipboard API to read from', async () => {
    stubClipboard({})

    expect(await readText()).toBeNull()
  })
})
