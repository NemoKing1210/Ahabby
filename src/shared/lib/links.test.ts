import { describe, expect, it } from 'vitest'

import { addressUrl, hostOf, httpUrl, linkTarget } from './links'

describe('what a link in the app means', () => {
  it('opens an absolute address in the reader', () => {
    expect(linkTarget('https://docs.example.com/guide')).toEqual({
      kind: 'reader',
      url: 'https://docs.example.com/guide',
    })
    expect(linkTarget('http://localhost:3000/')).toEqual({
      kind: 'reader',
      url: 'http://localhost:3000/',
    })
  })

  it('leaves the hash to the router', () => {
    expect(linkTarget('#/agents')).toEqual({ kind: 'inline' })
    expect(linkTarget('')).toEqual({ kind: 'inline' })
    expect(linkTarget(null)).toEqual({ kind: 'inline' })
  })

  /**
   * The bug this whole feature replaces: the WebView followed whatever the document said,
   * and the app was gone. A scheme Ahabby cannot honour is refused instead.
   */
  it('refuses a scheme no desktop app honours', () => {
    for (const href of [
      'mailto:someone@example.com',
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
      'tauri://localhost/index.html',
      'ftp://example.com/file',
    ]) {
      expect(linkTarget(href), href).toEqual({ kind: 'block' })
    }
  })

  it('reads a host written without a scheme', () => {
    expect(linkTarget('docs.example.com/guide')).toEqual({
      kind: 'reader',
      url: 'https://docs.example.com/guide',
    })
    expect(linkTarget('//cdn.example.com/app.js')).toEqual({
      kind: 'reader',
      url: 'https://cdn.example.com/app.js',
    })
  })

  /**
   * A relative href is Ahabby's own routing: the app is hash-routed, so nothing it draws looks
   * like this, and a document's own relative links never get here — `Markdown` renders a link
   * it cannot open as text instead (`shared/ui/Markdown.tsx`).
   */
  it('leaves a relative path to the router', () => {
    for (const href of ['/agents', './notes.md', '../up.md']) {
      expect(linkTarget(href), href).toEqual({ kind: 'inline' })
    }
  })

  /**
   * …but `SKILL.md` is a *file* of the document that linked to it, not a host, and a bare host
   * without a path is a host: the two are told apart by the extension.
   */
  it('does not mistake a sibling file for a host', () => {
    expect(linkTarget('SKILL.md')).toEqual({ kind: 'inline' })
    expect(linkTarget('README.md')).toEqual({ kind: 'inline' })
    expect(linkTarget('example.com')).toEqual({ kind: 'reader', url: 'https://example.com/' })
  })
})

describe('the address bar', () => {
  it('accepts an address, or a host typed the way people type it', () => {
    expect(addressUrl('https://docs.example.com/a?b=1#c')).toBe('https://docs.example.com/a?b=1#c')
    expect(addressUrl('  docs.example.com  ')).toBe('https://docs.example.com/')
    // A development server is what a typed bare host usually is, and it speaks plain HTTP.
    expect(addressUrl('localhost:5173')).toBe('http://localhost:5173/')
    expect(addressUrl('127.0.0.1:8000/app')).toBe('http://127.0.0.1:8000/app')
  })

  it('refuses what is neither', () => {
    for (const value of ['', '   ', 'not an address', 'mailto:someone@example.com', 'file:///x']) {
      expect(addressUrl(value), value).toBeNull()
    }
  })

  it('names the host it will show', () => {
    expect(hostOf('https://docs.example.com/guide')).toBe('docs.example.com')
    expect(hostOf('http://localhost:3000')).toBe('localhost:3000')
    expect(hostOf('nonsense')).toBe('nonsense')
  })

  it('keeps only http(s) in the reader', () => {
    expect(httpUrl('https://a.example.com/x')).toBe('https://a.example.com/x')
    expect(httpUrl('ftp://a.example.com/x')).toBeNull()
    expect(httpUrl('/relative')).toBeNull()
    expect(httpUrl('https://')).toBeNull()
  })
})
