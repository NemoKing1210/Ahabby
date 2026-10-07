import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, ChevronUp, Copy, Eraser, Search, TextSelect, X } from 'lucide-react'

import { copyText, readText } from '@/shared/lib/clipboard'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { Input } from '@/shared/ui/Input'
import { toast } from '@/shared/ui/Toast'

import { useBrowser } from '@/features/browser/context'
import { useSettings } from '@/features/settings/api/hooks'

import type { TerminalTab } from '../store'
import { useTerminalStore } from '../store'
import {
  attachTerminal,
  disposeTerminal,
  paintTerminal,
  type TerminalHandle,
} from '../lib/terminals'
import { terminalTokens } from '../lib/theme'

/**
 * One tab's terminal.
 *
 * This is a real emulator (xterm) over a real PTY: the backend streams bytes, the terminal decodes
 * and paints them, and whatever the user types goes straight back. Everything the user expects
 * from a terminal is therefore here by construction — Ctrl+C is SIGINT, full-screen agents work,
 * and the tool can be resized — while the parts a desktop terminal adds on top (copy, paste,
 * find, clear, links through the OS opener) are wired by hand below.
 *
 * The emulator itself is *not* created here: it belongs to the session and lives in
 * `lib/terminals.ts`, so taking this component down and back up — which React does twice for every
 * mount in development — shows the same screen again instead of an empty terminal. What this
 * component owns is the host element, the look, and the keyboard.
 *
 * Every tab mounts its terminal and stays mounted (an inactive one is only made invisible), so a
 * background agent keeps painting into its own buffer instead of losing the frames it printed
 * while the user was looking at another tab. Collapsing the dock is the same trick with a height
 * of zero.
 */
export function TerminalView({
  session,
  active,
  focusable = true,
  className,
}: {
  session: TerminalTab
  /** This tab is the one the dock shows. */
  active: boolean
  /** The dock is open: only then may the terminal take the keyboard (and be fitted). */
  focusable?: boolean
  className?: string
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const hostRef = useRef<HTMLDivElement>(null)
  const handleRef = useRef<TerminalHandle | null>(null)
  const [finding, setFinding] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ index: number; count: number } | null>(null)
  const sessionId = session.sessionId
  // The colour scheme is a saved setting; `useSettings` is backed by the query cache the settings
  // page writes on save, so changing it repaints every open tab (and every new one) without a
  // restart. A missing answer (the query has not resolved yet) means the default scheme.
  const { data: settings } = useSettings()
  const scheme = settings?.terminalTheme ?? 'auto'
  // The chrome inside the terminal (the strip around the canvas, the find bar) is built from the
  // design tokens; for a fixed scheme they are re-declared from the scheme's own palette here, so
  // the panel does not wear the app's colours around a differently painted canvas.
  const surface = useMemo(() => terminalTokens(scheme), [scheme])

  // The emulator outlives this component, and so does the handler that opens a link in it: the
  // ref is what keeps that handler pointing at the browser of the *current* render.
  const openLink = useRef(browser.open)
  useEffect(() => {
    openLink.current = browser.open
  }, [browser.open])

  const fit = useCallback(() => {
    // `fit` on a zero-sized element would resize the terminal to nonsense; that happens while the
    // page is laying out, when the window is minimised, and whenever the dock is collapsed.
    const host = hostRef.current
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return
    handleRef.current?.fit.fit()
  }, [])

  /** Re-read the tokens and repaint: theme, accent, scheme and font can change while we are open. */
  const applyLook = useCallback(() => {
    const handle = handleRef.current
    if (!handle) return
    paintTerminal(handle, scheme)
    // A different font means different cell sizes, so the grid has to be recomputed.
    fit()
  }, [fit, scheme])

  // The observer below outlives this render, so it must not close over a stale `applyLook` — it
  // would happily put the previous scheme back the next time the app theme changed.
  const applyLookRef = useRef(applyLook)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const handle = attachTerminal(sessionId, host, (uri) => openLink.current(uri))
    handleRef.current = handle
    const resultsSub = handle.search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setResults({ index: resultIndex, count: resultCount })
    })

    fit()
    handle.term.focus()

    // The container changes size when the window, the sidebar or another tab's presence changes.
    const observer = new ResizeObserver(() => fit())
    observer.observe(host)
    // The theme and appearance appliers write to `documentElement` outside React.
    const appearance = new MutationObserver(() => applyLookRef.current())
    appearance.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    })

    return () => {
      observer.disconnect()
      appearance.disconnect()
      resultsSub.dispose()
      handleRef.current = null
      // The emulator goes with the *tab*, not with this component: React may take the component
      // down for reasons of its own (development mounts everything twice), and rebuilding the
      // terminal then would throw away the screen the agent has already painted. Only a tab the
      // store no longer lists is really gone.
      if (!useTerminalStore.getState().tabs.some((tab) => tab.sessionId === sessionId)) {
        disposeTerminal(sessionId)
      }
    }
    // Re-attaching would drop nothing (the emulator survives), but the host is bound to the
    // session, not to the callbacks — which only ever touch refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  // Repaints the moment the terminal exists and again whenever the look changes — the colour
  // scheme (a saved setting) or the font scale (which changes `applyLook`'s identity).
  useEffect(() => {
    applyLookRef.current = applyLook
    applyLook()
  }, [applyLook])

  useEffect(() => {
    if (!active || !focusable) {
      // A collapsed dock has no room for the terminal: it must not keep the keyboard either, or
      // every key the rest of the app expects would be typed into the PTY instead.
      if (!focusable) handleRef.current?.term.blur()
      return
    }
    fit()
    handleRef.current?.term.focus()
  }, [active, focusable, fit])

  const copySelection = useCallback(async () => {
    const term = handleRef.current?.term
    if (!term) return
    const selection = term.getSelection()
    if (!selection) return
    if (await copyText(selection)) toast.success(t('toast.copied'), selection)
    else toast.error(t('terminal.copyFailed'))
  }, [t])

  const paste = useCallback(async () => {
    const text = await readText()
    if (text === null) {
      toast.error(t('terminal.pasteUnavailable'))
      return
    }
    if (text.length > 0) handleRef.current?.term.paste(text)
  }, [t])

  const find = useCallback((direction: 'next' | 'previous', value: string) => {
    const search = handleRef.current?.search
    if (!search || value.length === 0) return
    if (direction === 'next') search.findNext(value)
    else search.findPrevious(value)
  }, [])

  const closeFindBar = useCallback(() => {
    setFinding(false)
    handleRef.current?.search.clearDecorations()
    handleRef.current?.term.focus()
  }, [])

  // Terminal key bindings a desktop terminal user expects, on top of xterm's own map. Returning
  // `false` tells xterm the event is ours, so `Ctrl+C` without a modifier still sends SIGINT.
  // The emulator is the session's, so the handler is (re)installed on every attach — xterm keeps
  // exactly one, and this one always closes over the current state.
  const onTerminalKeyDown = useCallback(
    (event: KeyboardEvent): boolean => {
      if (event.type !== 'keydown') return true
      const mod = event.ctrlKey || event.metaKey
      const shift = event.shiftKey
      // On macOS the command key is free (SIGINT is Ctrl+C there); elsewhere Shift is required so
      // that Ctrl+C keeps interrupting the agent.
      const copyKey = event.metaKey || (event.ctrlKey && shift)
      const pasteKey = event.metaKey
        ? event.code === 'KeyV'
        : event.ctrlKey && shift && event.code === 'KeyV'

      if (copyKey && event.code === 'KeyC') {
        void copySelection()
        return false
      }
      if (pasteKey) {
        void paste()
        return false
      }
      if (mod && event.code === 'KeyF') {
        setFinding((open) => {
          if (open) handleRef.current?.search.clearDecorations()
          return !open
        })
        return false
      }
      // `Ctrl+K` is left alone on purpose: readline and PSReadLine use it.
      // `Ctrl+`` belongs to the shell (it toggles the dock), so the PTY never sees it.
      if (mod && event.code === 'Backquote') return false
      if (event.code === 'Escape' && finding) {
        closeFindBar()
        return false
      }
      return true
    },
    [closeFindBar, copySelection, finding, paste],
  )

  useEffect(() => {
    handleRef.current?.term.attachCustomKeyEventHandler(onTerminalKeyDown)
  }, [onTerminalKeyDown])

  // The find bar takes focus while it is open, so a key press there must not reach the agent.
  const onFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      find(event.shiftKey ? 'previous' : 'next', query)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      closeFindBar()
    }
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            'bg-background absolute inset-0',
            active ? 'visible' : 'pointer-events-none invisible',
            className,
          )}
          style={surface}
        >
          <div ref={hostRef} className="h-full w-full px-2 py-1" />

          {finding ? (
            <div className="border-border bg-surface shadow-popover absolute top-2 right-3 flex items-center gap-1 rounded-lg border p-1">
              <Input
                autoFocus
                value={query}
                aria-label={t('terminal.find')}
                placeholder={t('terminal.findPlaceholder')}
                className="h-7 w-44 border-0 bg-transparent px-2 text-[0.8125rem]"
                onChange={(event) => {
                  setQuery(event.target.value)
                  find('next', event.target.value)
                }}
                onKeyDown={onFindKeyDown}
              />
              {results ? (
                <span className="text-faint min-w-10 text-center text-[0.6875rem] tabular-nums">
                  {t('terminal.findCount', { index: results.index, count: results.count })}
                </span>
              ) : null}
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('terminal.findPrevious')}
                onClick={() => find('previous', query)}
              >
                <ChevronUp className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('terminal.findNext')}
                onClick={() => find('next', query)}
              >
                <ChevronDown className="size-3.5" aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.close')}
                onClick={closeFindBar}
              >
                <X className="size-3.5" aria-hidden />
              </Button>
            </div>
          ) : null}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent aria-label={t('terminal.title')}>
        <ContextMenuItem disabled={!session.running} onSelect={() => void paste()}>
          <TextSelect aria-hidden />
          {t('terminal.paste')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => void copySelection()}>
          <Copy aria-hidden />
          {t('terminal.copy')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handleRef.current?.term.selectAll()}>
          <TextSelect aria-hidden />
          {t('terminal.selectAll')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setFinding(true)}>
          <Search aria-hidden />
          {t('terminal.find')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => handleRef.current?.term.clear()}>
          <Eraser aria-hidden />
          {t('terminal.clear')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
