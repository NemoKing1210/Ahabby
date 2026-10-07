import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'

import { addressUrl, linkTarget } from '@/shared/lib/links'

import { BrowserDialog } from './components/BrowserDialog'

/**
 * Ahabby's own browser.
 *
 * Two things live here, and they are the same thing seen from both ends:
 *
 * * the **door** — one document-level click listener that catches every external link in the
 *   app. A documentation link inside a `SKILL.md`, an agent's website on a card, a URL printed
 *   in the terminal: none of them navigate the window away, because the WebView must never be
 *   the one that answers "where does this link go". That was the bug this replaces — a link
 *   the app did not handle took the whole interface with it;
 * * the **window** — the modal itself, with its own history, so a link inside a page opens in
 *   the same reader the page is in.
 *
 * The state is a plain stack: `history` is everything browsed in this modal session, `index`
 * is where the user is in it. It is deliberately not persisted — a browser session is not a
 * preference.
 */
interface BrowserApi {
  /** Open a link in Ahabby's own browser, instead of leaving the app. */
  open: (url: string) => void
}

const BrowserContext = createContext<BrowserApi | null>(null)

/** The browser of the app this component is in. */
export function useBrowser(): BrowserApi {
  const browser = useContext(BrowserContext)
  if (!browser) {
    throw new Error('useBrowser must be used inside <BrowserProvider>')
  }
  return browser
}

interface BrowserState {
  open: boolean
  history: string[]
  index: number
}

const CLOSED: BrowserState = { open: false, history: [], index: -1 }

export function BrowserProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<BrowserState>(CLOSED)
  const url = state.index >= 0 ? (state.history[state.index] ?? null) : null

  const open = useCallback((raw: string) => {
    // A link written without a scheme (`docs.example.com`) is what people type and what a
    // markdown file often carries; anything else is handed over as it is, so the backend's own
    // refusal — and its message — is what the reader shows.
    const value = addressUrl(raw) ?? raw.trim()
    if (!value) return
    setState((current) =>
      current.open
        ? {
            ...current,
            history: [...current.history.slice(0, current.index + 1), value],
            index: current.index + 1,
          }
        : { open: true, history: [value], index: 0 },
    )
  }, [])

  const go = useCallback((index: number) => {
    setState((current) =>
      index < 0 || index >= current.history.length ? current : { ...current, index },
    )
  }, [])

  const close = useCallback(() => setState((current) => ({ ...current, open: false })), [])

  /**
   * The door: whatever an external link is attached to, the click ends in the reader.
   *
   * It listens in the capture phase so it runs before anything else — including a router link
   * handler — and it decides on the *attribute*, not on `anchor.href`: a `href` the WebView
   * already resolved points at Ahabby's own origin, which is exactly the wrong answer.
   */
  useEffect(() => {
    const onActivate = (event: MouseEvent) => {
      if (event.defaultPrevented) return
      // Left click, and the middle click a browser user expects to open a link with.
      if (event.button !== 0 && event.button !== 1) return
      const anchor =
        event.target instanceof Element ? event.target.closest('a[href], a[data-anchor]') : null
      if (!anchor) return
      // An in-page anchor of the reader: the article scrolls to it, nothing navigates.
      if (anchor.hasAttribute('data-anchor')) return

      const target = anchor.getAttribute('href')
      const resolved = linkTarget(target)
      if (resolved.kind === 'inline') return
      event.preventDefault()
      if (resolved.kind === 'reader') open(resolved.url)
    }

    document.addEventListener('click', onActivate, true)
    document.addEventListener('auxclick', onActivate, true)
    return () => {
      document.removeEventListener('click', onActivate, true)
      document.removeEventListener('auxclick', onActivate, true)
    }
  }, [open])

  const api = useMemo<BrowserApi>(() => ({ open }), [open])

  return (
    <BrowserContext.Provider value={api}>
      {children}
      {state.open && url ? (
        <BrowserDialog
          // One dialog per address: a new page is a new browser window, with its own toolbar
          // state, and Back returns to the previous one as its own mount.
          key={url}
          url={url}
          onNavigate={open}
          onBack={state.index > 0 ? () => go(state.index - 1) : null}
          onForward={state.index < state.history.length - 1 ? () => go(state.index + 1) : null}
          onClose={close}
        />
      ) : null}
    </BrowserContext.Provider>
  )
}
