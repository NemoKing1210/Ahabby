import { describe, expect, it } from 'vitest'

import { readable } from './readable'

const PAGE = 'https://docs.example.com/guide'

/** A page shaped like the ones this reads: chrome around an article, and every kind of link. */
const HTML = `<!doctype html>
<html lang="en">
  <head>
    <title>Docs — Ahabby</title>
    <link rel="shortcut icon" href="/favicon.ico">
    <script>window.analytics = 'alert(1)'</script>
    <style>.hero { color: red }</style>
  </head>
  <body>
    <nav><a href="/">Home</a> nav text</nav>
    <header>header text</header>
    <main>
      <article>
        <h1>Getting started</h1>
        <p>Read the <a href="guide.html">guide</a>, write to
           <a href="mailto:hello@example.com">the team</a>, or jump to
           <a href="#install">Install</a>.</p>
        <h2 id="install">Install</h2>
        <p>
          <img src="./diagram.png" alt="Diagram" width="400" onerror="alert(2)" srcset="./d2.png 2x">
        </p>
        <p onclick="alert(3)" style="color:red">Styled paragraph.</p>
      </article>
    </main>
    <aside>aside text</aside>
    <footer>footer text</footer>
  </body>
</html>`

describe('reading a page', () => {
  const content = readable(HTML, 'html', PAGE)

  it('takes the article, and leaves the chrome of the page behind', () => {
    expect(content.html).toContain('<h1>Getting started</h1>')
    expect(content.html).toContain('Styled paragraph.')
    for (const gone of ['nav text', 'header text', 'aside text', 'footer text', 'alert(1)']) {
      expect(content.html, gone).not.toContain(gone)
    }
    // The stripped chrome is not part of what the reader reports as the page's text either.
    expect(content.text.startsWith('Getting started')).toBe(true)
  })

  it('shows the page its own title, and its favicon as an absolute address', () => {
    expect(content.title).toBe('Docs — Ahabby')
    expect(content.icon).toBe('https://docs.example.com/favicon.ico')
  })

  it('points every link at an absolute address', () => {
    expect(content.html).toContain('href="https://docs.example.com/guide.html"')
    expect(content.links).toContainEqual({
      url: 'https://docs.example.com/guide.html',
      text: 'guide',
    })
  })

  it('keeps the text of a link the reader cannot open, without the link', () => {
    expect(content.html).toContain('the team')
    expect(content.html).not.toContain('mailto:')
  })

  /**
   * The hash belongs to Ahabby's router, so an in-page anchor must not carry one — the reader
   * scrolls to the target itself, and the target's id is renamed out of the page's namespace.
   */
  it('turns an in-page anchor into something the reader scrolls to', () => {
    expect(content.html).toContain('data-anchor="#reader-install"')
    expect(content.html).toContain('id="reader-install"')
    expect(content.html).not.toContain('href="#install"')
  })

  it('drops attributes a page must not bring with it', () => {
    expect(content.html).not.toContain('onerror')
    expect(content.html).not.toContain('onclick')
    expect(content.html).not.toContain('style=')
  })

  it('hands the images over instead of letting the window load them', () => {
    expect(content.images).toEqual(['https://docs.example.com/diagram.png'])
    expect(content.html).toContain('data-src="https://docs.example.com/diagram.png"')
    expect(content.html).toContain('loading="lazy"')
    expect(content.html).toContain('alt="Diagram"')
    expect(content.html).not.toContain('srcset')
    expect(content.html).not.toMatch(/<img[^>]*\ssrc=/)
  })

  it('drops the ids a page brought that nothing points at', () => {
    const withId = readable('<p id="root">text of the page</p>', 'html', PAGE)
    expect(withId.html).toBe('<p>text of the page</p>')
  })

  it('prefers the article when the main element around it is mostly chrome', () => {
    const nested = readable(
      `<main><div>${'chrome '.repeat(40)}</div><article><p>${'content '.repeat(40)}</p></article></main>`,
      'html',
      PAGE,
    )
    expect(nested.text.startsWith('content')).toBe(true)
  })

  it('falls back to the whole body when the page has no article at all', () => {
    const plain = readable(`<body><p>${'Just text. '.repeat(20)}</p></body>`, 'html', PAGE)
    expect(plain.empty).toBe(false)
    expect(plain.text.startsWith('Just text.')).toBe(true)
  })

  /**
   * A page that draws itself with its own scripts — the reader must say so instead of showing
   * an empty frame, which is what `empty` is for.
   */
  it('reports a page with nothing to read', () => {
    const shell = readable(
      `<body><div id="app"></div><script>render()</script></body>`,
      'html',
      PAGE,
    )
    expect(shell.empty).toBe(true)
  })

  it('never parses a plain-text document as markup', () => {
    const content = readable('<b>not markup</b>', 'text', PAGE)
    expect(content.html).toBe('')
    expect(content.text).toBe('<b>not markup</b>')
    expect(content.empty).toBe(false)
  })
})
