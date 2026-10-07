import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import { Markdown } from './Markdown'

afterEach(cleanup)

function renderLink(href: string, label = 'link') {
  return render(<Markdown source={`[${label}](${href})`} />).container
}

describe('the links of a rendered document', () => {
  it('keeps a link the reader can open', () => {
    const container = renderLink('https://docs.example.com/guide')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://docs.example.com/guide',
    )
  })

  it('completes a host written without a scheme', () => {
    const container = renderLink('docs.example.com/guide')
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      'https://docs.example.com/guide',
    )
  })

  /**
   * The bug this replaces: a relative or in-page href was resolved by the WebView against
   * Ahabby's own origin, and following it took the whole interface with it. The text stays,
   * so the document still reads; the link goes, so nothing can navigate.
   */
  it('renders a link it cannot open as its own text', () => {
    for (const href of ['./notes.md', '#installation', '/agents', 'mailto:hello@example.com']) {
      const container = renderLink(href, 'see this')
      expect(container.querySelector('a'), href).toBeNull()
      expect(container.textContent, href).toContain('see this')
    }
  })

  it('drops what a document must not bring with it', () => {
    const { container } = render(
      <Markdown source={'<script>alert(1)</script><p onclick="alert(2)">hello</p>'} />,
    )
    expect(container.innerHTML).not.toContain('script')
    expect(container.innerHTML).not.toContain('onclick')
    expect(container.textContent).toContain('hello')
  })
})
