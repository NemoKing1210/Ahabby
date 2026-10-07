/**
 * A fetched document, turned into something safe and readable.
 *
 * The reader shows a page Ahabby did not write, so this is the boundary that has to hold:
 * the HTML is parsed *inert* (`DOMParser` runs no script, loads no image), the chrome around
 * the article is dropped, the rest is sanitized against an allow-list, and every URL is
 * rewritten so the window only ever sees addresses the reader will fetch through the backend.
 *
 * Nothing here touches the live document: it works on a detached parse, which is what makes it
 * testable — and what keeps a broken page from reaching Ahabby's own DOM before it is cleaned.
 */

import DOMPurify from 'dompurify'

import type { WebPageKind } from '@/shared/bindings/WebPageKind'

/** A link the page offered, as the fallback card lists it. */
export interface ReadableLink {
  url: string
  text: string
}

export interface Readable {
  /** The page's own `<title>`, when it declares one. */
  title: string | null
  /** The page's favicon, absolute — shown through the same image proxy as the rest. */
  icon: string | null
  /** Sanitized markup, ready for `dangerouslySetInnerHTML`. Empty for a plain-text document. */
  html: string
  /** The text the reader will show, whitespace collapsed — what the reader judges the page by. */
  text: string
  /** Every link the article kept, in document order. */
  links: ReadableLink[]
  /** Absolute image URLs, to be proxied: the markup carries `data-src`, never `src`. */
  images: string[]
  /** True when there is too little text to be worth showing: the caller offers the page itself. */
  empty: boolean
}

/** Elements that are structure, not content, in a document that is being read as an article. */
const CHROME = [
  'script',
  'style',
  'noscript',
  'template',
  'iframe',
  'object',
  'embed',
  'form',
  'input',
  'select',
  'textarea',
  'button',
  'svg',
  'canvas',
  'video',
  'audio',
  'link',
  'meta',
  'nav',
  'header',
  'footer',
  'aside',
  '[role="navigation"]',
  '[role="banner"]',
  '[role="contentinfo"]',
  '[role="complementary"]',
  '[aria-hidden="true"]',
  '[hidden]',
].join(',')

/** Containers a page keeps its article in, most specific first. */
const CONTENT = ['article', 'main', '[role="main"]', '#content', '.markdown-body', '.prose', 'body']

/** Markup the reader is willing to render. Everything else is dropped, keeping its text. */
const ALLOWED_TAGS = [
  'a',
  'abbr',
  'address',
  'article',
  'b',
  'blockquote',
  'br',
  'caption',
  'cite',
  'code',
  'col',
  'colgroup',
  'dd',
  'del',
  'details',
  'dfn',
  'div',
  'dl',
  'dt',
  'em',
  'figcaption',
  'figure',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'i',
  'img',
  'ins',
  'kbd',
  'li',
  'mark',
  'ol',
  'p',
  'pre',
  'q',
  's',
  'samp',
  'section',
  'small',
  'span',
  'strong',
  'sub',
  'summary',
  'sup',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'time',
  'tr',
  'u',
  'ul',
  'var',
  'wbr',
]

const ALLOWED_ATTR = [
  'alt',
  'cite',
  'colspan',
  'datetime',
  'dir',
  'height',
  'href',
  'id',
  'lang',
  'open',
  'rowspan',
  'scope',
  'src',
  'start',
  'title',
  'type',
  'width',
]

/** Under this many characters of text a page is not worth showing as an article. */
const TOO_LITTLE = 120

/**
 * Read `body` as an article. `baseUrl` is the address the document was fetched from: every
 * relative link and image in it is resolved against that, never against Ahabby's own origin.
 */
export function readable(body: string, kind: WebPageKind, baseUrl: string): Readable {
  if (kind === 'text') {
    return {
      title: null,
      icon: null,
      html: '',
      text: body,
      links: [],
      images: [],
      empty: body.trim().length === 0,
    }
  }

  const doc = new DOMParser().parseFromString(body, 'text/html')
  const source = pickContent(doc)

  // The chrome goes before sanitizing, so the sanitizer has less to walk and the fallback card
  // does not offer a link out of a nav bar.
  source.querySelectorAll(CHROME).forEach((node) => node.remove())

  const holder = doc.createElement('div')
  holder.innerHTML = String(
    DOMPurify.sanitize(source.innerHTML, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      KEEP_CONTENT: true,
    }),
  )

  const links = rewriteLinks(holder, baseUrl)
  const images = rewriteImages(holder, baseUrl)
  const text = oneLine(holder.textContent ?? '')

  return {
    title: oneLine(doc.title) || null,
    icon: favicon(doc, baseUrl),
    html: holder.innerHTML,
    text,
    links,
    images,
    empty: text.length < TOO_LITTLE,
  }
}

/**
 * The element that holds the article.
 *
 * The densest candidate usually wins, but an `<article>` that keeps most of that text beats the
 * `<main>` wrapping it — that pairing is what a documentation page looks like.
 */
function pickContent(doc: Document): HTMLElement {
  const candidates = CONTENT.map((selector) => doc.querySelector(selector)).filter(
    (node): node is HTMLElement => node !== null,
  )
  const ranked = candidates
    .map((node) => ({ node, length: oneLine(node.textContent ?? '').length }))
    .sort((left, right) => right.length - left.length)

  const best = ranked[0]
  if (!best) return doc.body
  const article = ranked.find((candidate) => candidate.node.tagName === 'ARTICLE')
  if (article && article.length * 2 >= best.length) return article.node
  return best.node
}

/** The page's favicon, resolved against the address it was read from. */
function favicon(doc: Document, baseUrl: string): string | null {
  const icon = [...doc.querySelectorAll('link[rel]')].find((link) =>
    /icon/i.test(link.getAttribute('rel') ?? ''),
  )
  return icon ? absolute(icon.getAttribute('href'), baseUrl) : null
}

/**
 * Point every link at its absolute address, and take the ones the reader cannot honour out of
 * the markup entirely — a `mailto:` stays readable text, not a link that does nothing.
 *
 * An in-page `#…` anchor loses its `href`: Ahabby's router owns the hash, so the reader keeps
 * the target in `data-anchor` and scrolls to it itself. The target's id is renamed on the way,
 * so a page's own id can never collide with one of Ahabby's.
 */
function rewriteLinks(holder: HTMLElement, baseUrl: string): ReadableLink[] {
  const links: ReadableLink[] = []
  const anchors = new Set<string>()

  for (const anchor of holder.querySelectorAll('a')) {
    const raw = anchor.getAttribute('href')
    const text = oneLine(anchor.textContent ?? '')

    if ((raw ?? '').startsWith('#')) {
      anchor.removeAttribute('href')
      const target = findById(holder, (raw ?? '').slice(1))
      if (!target) continue
      const scoped = `reader-${(raw ?? '').slice(1).replace(/[^a-zA-Z0-9_-]+/g, '-')}`
      target.setAttribute('id', scoped)
      anchors.add(scoped)
      anchor.setAttribute('data-anchor', `#${scoped}`)
      continue
    }

    const url = absolute(raw, baseUrl)
    if (!url) {
      unwrap(anchor)
      continue
    }
    anchor.setAttribute('href', url)
    anchor.setAttribute('rel', 'noreferrer')
    if (text) links.push({ url, text })
  }

  // What is left of the page's own ids goes: the reader has no use for them, and an id the app
  // also uses would be a collision rather than a name.
  for (const element of holder.querySelectorAll('[id]')) {
    if (!anchors.has(element.id)) element.removeAttribute('id')
  }
  return links.slice(0, 40)
}

function findById(holder: HTMLElement, id: string): HTMLElement | null {
  return (
    [...holder.querySelectorAll<HTMLElement>('[id]')].find((element) => element.id === id) ?? null
  )
}

/**
 * Hand every image to the caller instead of the DOM.
 *
 * The `src` is removed and the address moved to `data-src`: the reader proxies it through the
 * backend and sets the real `src` to the `data:` URL it gets back, so the window never talks to
 * the site that serves the picture.
 */
function rewriteImages(holder: HTMLElement, baseUrl: string): string[] {
  const images: string[] = []
  for (const image of [...holder.querySelectorAll('img')]) {
    const url = absolute(image.getAttribute('src'), baseUrl)
    if (!url) {
      image.remove()
      continue
    }
    image.removeAttribute('src')
    image.setAttribute('data-src', url)
    image.setAttribute('loading', 'lazy')
    image.setAttribute('decoding', 'async')
    image.removeAttribute('srcset')
    images.push(url)
  }
  return images
}

/** An absolute `http(s)` address for `value`, or `null` when the reader has no use for it. */
function absolute(value: string | null, baseUrl: string): string | null {
  if (!value) return null
  try {
    const url = new URL(value, baseUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return url.toString()
  } catch {
    return null
  }
}

/** Replace an element with its own text, so `KEEP_CONTENT` and this agree. */
function unwrap(element: Element) {
  element.replaceWith(...element.childNodes)
}

/** Text with every run of whitespace collapsed — markup brings its own indentation. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}
