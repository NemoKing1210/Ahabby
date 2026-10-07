/**
 * Where a link in Ahabby leads.
 *
 * Ahabby's window never navigates: a link that would leave the app is handed to the reader
 * (Ahabby's own browser, `features/browser`), a scheme no desktop app can honour is refused
 * outright, and the router keeps what is left. The decision lives here because more than one
 * place has to agree on it — the global click handler, the reader's address bar, and the
 * markdown renderer, which turns a link it cannot open into plain text.
 */

/** What should happen to a link. */
export type LinkTarget =
  /** Open it in Ahabby's own browser. */
  | { kind: 'reader'; url: string }
  /** Leave it alone: an in-page anchor, or a route the app itself owns. */
  | { kind: 'inline' }
  /** Refuse it: the WebView must not follow this at all (`mailto:`, `file:`, `javascript:`…). */
  | { kind: 'block' }

/** A scheme at the start of a URL, as in `https:` or `mailto:`. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i

/** A host written on its own, the way people write it in a markdown file: `docs.example.com/x`. */
const BARE_HOST = /^[^\s/?#]+\.[a-z]{2,}(?::\d+)?(?:[/?#]|$)/i

/**
 * Extensions that make a bare word a *file* rather than a host.
 *
 * `SKILL.md` and `README.md` are the links a document about agents carries; `example.sh` is
 * a host only to someone who meant a website, which is not how a sibling file is written.
 */
const DOC_FILE =
  /\.(?:md|markdown|txt|json|jsonc|toml|ya?ml|ini|cfg|conf|sh|bash|ps1|bat|cmd|py|rb|go|rs|ts|tsx|js|jsx|mjs|cjs|html?|css|sql|log|lock|env|png|jpe?g|gif|svg|webp|ico|pdf|csv|xml)$/i

/**
 * A host typed into the address bar: the two above, plus the local names a development server
 * answers on — `localhost:5173` and `127.0.0.1:8000`, which have no dot to recognise them by.
 */
const TYPED_HOST = /^(?:localhost|[\w-]+(?:\.[\w-]+)+|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/i

/** A local development server is nearly always plain HTTP, and `https` would never answer. */
const LOCAL_HOST = /^(?:localhost|(?:\d{1,3}\.){3}\d{1,3})(?::\d+)?(?:[/?#]|$)/i

/**
 * A URL the reader can fetch: trimmed, absolute and `http(s)` with a host. Everything else —
 * a relative path, a `mailto:`, a `javascript:` payload, a host someone typed without a
 * scheme — is `null`, because the reader has no meaning for it.
 */
export function httpUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
  if (!url.hostname) return null
  return url.toString()
}

/**
 * What the address bar accepts.
 *
 * Typing `docs.example.com` is what a browser user does; the reader is not a search engine,
 * so a host without a scheme gets `https://` and anything else is refused instead of guessed.
 */
export function addressUrl(value: string): string | null {
  const raw = value.trim()
  if (!raw) return null
  const direct = httpUrl(raw)
  if (direct) return direct
  if (!TYPED_HOST.test(raw)) return null
  return httpUrl(`${LOCAL_HOST.test(raw) ? 'http' : 'https'}://${raw}`)
}

/** The host to show: `docs.example.com`, or the raw value when it cannot be parsed. */
export function hostOf(value: string): string {
  try {
    return new URL(value).host
  } catch {
    return value
  }
}

/**
 * What a click on `rawHref` means.
 *
 * The decision is made on the attribute, never on `anchor.href`: a href the WebView has already
 * resolved points at Ahabby's own origin, which is exactly the wrong answer. An in-page `#…`
 * anchor is left to the caller — inside the reader it is a scroll, and anywhere else the hash
 * belongs to the router.
 */
export function linkTarget(rawHref: string | null): LinkTarget {
  const raw = (rawHref ?? '').trim()
  if (!raw || raw.startsWith('#')) return { kind: 'inline' }

  const scheme = SCHEME.exec(raw)
  if (scheme) {
    const name = scheme[1]?.toLowerCase()
    if (name === 'http' || name === 'https') {
      const url = httpUrl(raw)
      return url ? { kind: 'reader', url } : { kind: 'block' }
    }
    return { kind: 'block' }
  }

  // `//docs.example.com/x` keeps the page's own scheme, which says nothing about the host it
  // points at, so it is read as `https` like an absolute one.
  if (raw.startsWith('//')) {
    const url = httpUrl(`https:${raw}`)
    return url ? { kind: 'reader', url } : { kind: 'block' }
  }

  const host = hostSegment(raw)
  if (BARE_HOST.test(host) && !DOC_FILE.test(host)) {
    const url = httpUrl(`https://${raw}`)
    if (url) return { kind: 'reader', url }
  }

  // A relative path is Ahabby's own routing, not a link out of the app: nothing the router draws
  // looks like this (Ahabby is hash-routed) and nothing else can navigate here — a document's own
  // relative links are handed to `Markdown`, which renders what it cannot open as text.
  return { kind: 'inline' }
}

/** The first segment of a raw href — the part that would be a host, if this is one. */
function hostSegment(raw: string): string {
  return raw.split(/[/?#]/)[0] ?? ''
}
