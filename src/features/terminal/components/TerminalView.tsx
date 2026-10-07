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
import { SearchAddon } from '@xterm/addon-search'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'

import { ipc } from '@/shared/api/ipc'
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
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useSettings } from '@/features/settings/api/hooks'

import type { TerminalTab } from '../store'
import { registerTerminal, unregisterTerminal } from '../lib/session'
import { terminalFont, terminalTheme, terminalTokens } from '../lib/theme'

/**
 * One tab's terminal.
 *
 * This is a real emulator (xterm) over a real PTY: the backend streams bytes, the terminal decodes
 * and paints them, and whatever the user types goes straight back. Everything the user expects
 * from a terminal is therefore here by construction — Ctrl+C is SIGINT, full-screen agents work,
 * and the tool can be resized — while the parts a desktop terminal adds on top (copy, paste,
 * find, clear, links through the OS opener) are wired by hand below.
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
  const hostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
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
  const fit = useCallback(() => {
    // `fit` on a zero-sized element would resize the terminal to nonsense; that happens while the
    // page is laying out, when the window is minimised, and whenever the dock is collapsed.
    const host = hostRef.current
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) return
    fitRef.current?.fit()
  }, [])

  /** Re-read the tokens and repaint: theme, accent, scheme and font can change while we are open. */
  const applyLook = useCallback(() => {
    const term = termRef.current
    if (!term) return
    const font = terminalFont()
    term.options.theme = terminalTheme(scheme)
    term.options.fontFamily = font.fontFamily
    term.options.fontSize = font.fontSize
    // A different font means different cell sizes, so the grid has to be recomputed.
    fit()
  }, [fit, scheme])

  // The observer below outlives this render, so it must not close over a stale `applyLook` — it
  // would happily put the previous scheme back the next time the app theme changed.
  const applyLookRef = useRef(applyLook)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const font = terminalFont()
    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: font.fontFamily,
      fontSize: font.fontSize,
      lineHeight: 1.2,
      macOptionIsMeta: true,
      // A terminal is a scrollback, not a document: keep a generous history, like a desktop one.
      scrollback: 10_000,
      theme: terminalTheme(scheme),
    })
    const fitAddon = new FitAddon()
    const search = new SearchAddon()
    term.loadAddon(fitAddon)
    term.loadAddon(search)
    term.loadAddon(
      new WebLinksAddon((event, uri) => {
        event.preventDefault()
        void ipc.openUrl(uri).catch(toastAppError)
      }),
    )
    term.open(host)
    termRef.current = term
    fitRef.current = fitAddon
    searchRef.current = search

    const dataSub = term.onData((data) => {
      void ipc.writeTerminal(sessionId, data).catch(() => undefined)
    })
    const resizeSub = term.onResize(({ cols, rows }) => {
      void ipc.resizeTerminal(sessionId, cols, rows).catch(() => undefined)
    })
    const resultsSub = search.onDidChangeResults(({ resultIndex, resultCount }) => {
      setResults({ index: resultIndex, count: resultCount })
    })

    registerTerminal(sessionId, (data) => term.write(data))
    fit()
    term.focus()

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
      dataSub.dispose()
      resizeSub.dispose()
      resultsSub.dispose()
      unregisterTerminal(sessionId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
      searchRef.current = null
    }
    // Recreating the terminal would drop its scrollback, so it is bound to the session, not to
    // the callbacks (which only ever touch refs).
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
      if (!focusable) termRef.current?.blur()
      return
    }
    fit()
    termRef.current?.focus()
  }, [active, focusable, fit])

  const copySelection = useCallback(async () => {
    const term = termRef.current
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
    if (text.length > 0) termRef.current?.paste(text)
  }, [t])

  const find = useCallback((direction: 'next' | 'previous', value: string) => {
    const search = searchRef.current
    if (!search || value.length === 0) return
    if (direction === 'next') search.findNext(value)
    else search.findPrevious(value)
  }, [])

  // Terminal key bindings a desktop terminal user expects, on top of xterm's own map. Returning
  // `false` tells xterm the event is ours, so `Ctrl+C` without a modifier still sends SIGINT.
  useEffect(() => {
    const term = termRef.current
    if (!term) return
    term.attachCustomKeyEventHandler((event) => {
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
          if (open) searchRef.current?.clearDecorations()
          return !open
        })
        return false
      }
      // `Ctrl+K` is left alone on purpose: readline and PSReadLine use it.
      // `Ctrl+`` belongs to the shell (it toggles the dock), so the PTY never sees it.
      if (mod && event.code === 'Backquote') return false
      if (event.code === 'Escape' && finding) {
        setFinding(false)
        term.focus()
        return false
      }
      return true
    })
  }, [copySelection, finding, paste])

  // The find bar takes focus while it is open, so a key press there must not reach the agent.
  const onFindKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault()
      find(event.shiftKey ? 'previous' : 'next', query)
    }
    if (event.key === 'Escape') {
      event.preventDefault()
      setFinding(false)
      searchRef.current?.clearDecorations()
      termRef.current?.focus()
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
                onClick={() => {
                  setFinding(false)
                  searchRef.current?.clearDecorations()
                  termRef.current?.focus()
                }}
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
        <ContextMenuItem onSelect={() => termRef.current?.selectAll()}>
          <TextSelect aria-hidden />
          {t('terminal.selectAll')}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => setFinding(true)}>
          <Search aria-hidden />
          {t('terminal.find')}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => termRef.current?.clear()}>
          <Eraser aria-hidden />
          {t('terminal.clear')}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}
