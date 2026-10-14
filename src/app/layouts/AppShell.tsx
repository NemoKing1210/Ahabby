import {
  Suspense,
  lazy,
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useMemo,
  type ReactNode,
  type RefObject,
} from 'react'

import {
  Boxes,
  FolderGit2,
  House,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings as SettingsIcon,
  Store,
  Terminal as TerminalIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useOutlet } from 'react-router-dom'

import { formatDuration, formatRelative } from '@/shared/lib/format'
import { softTransition, useSoftSlide } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from '@/shared/ui/ContextMenu'
import { Spinner } from '@/shared/ui/Primitives'
import { Reveal } from '@/shared/ui/Reveal'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { useScanRefresh } from '@/features/agents/api/scan'
import { useLibrary } from '@/features/library/api/queries'
import { useSetLastRoute, useSetSidebarCollapsed, useSettings } from '@/features/settings/api/hooks'
import { useRunAgentInTerminal, useTerminals } from '@/features/terminal/api/hooks'
import { NewTerminalDialog } from '@/features/terminal/components/NewTerminalDialog'
import { useTerminalStore } from '@/features/terminal/store'

import { TourProvider } from '@/features/tour/TourProvider'

import { TrayBridge } from './TrayBridge'
import { TitleBar } from './TitleBar'

/**
 * The screens the rail leads to. Settings is not one of them: it belongs to the app rather than to
 * the machine, so it sits in the rail's foot with the scan, exactly where the reference this rail
 * is drawn from keeps "how do I change this" — one row under the list, one row above the edge.
 */
const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.home', icon: House, end: true, tour: 'nav-home' },
  { to: '/agents', labelKey: 'nav.agents', icon: Boxes, end: false, tour: 'nav-agents' },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderGit2, end: false, tour: 'nav-projects' },
  { to: '/library', labelKey: 'nav.library', icon: Library, end: false, tour: 'nav-library' },
  { to: '/hub', labelKey: 'nav.hub', icon: Store, end: false, tour: 'nav-hub' },
] as const

/**
 * The terminal is a dock of the shell, not a screen, and xterm.js is a few hundred kilobytes only
 * it needs — so the dock is loaded the first time a session exists. React's `lazy` is the one place
 * a dynamic import is unavoidable; the tab store and the event bridge that keeps PTY output from
 * being lost are imported eagerly by `app/providers.tsx`.
 */
const TerminalDock = lazy(async () => {
  const module = await import('@/features/terminal/components/TerminalDock')
  return { default: module.TerminalDock }
})

/**
 * The screen the window is on.
 *
 * The screen that was asked for is mounted with the click and eases in; the one it replaced is
 * gone at once rather than playing an exit first. `AnimatePresence` with `mode="wait"` — what this
 * used to be — held the incoming screen back until the outgoing one had finished leaving, so every
 * navigation answered a fifth of a second late and every query the new screen starts waited behind
 * that. A screen still does not hard-swap: it fades and slides in.
 *
 * The scroll container is returned to the top before the new screen paints, so a screen is entered
 * where it starts rather than wherever the last one was left. The first screen is not animated at
 * all: the window is painted from a hidden state and a fade on top of the splash would read as a
 * second load.
 *
 * Settings is one screen with a sub-route per area, so it is keyed by its section rather than
 * by the full path: remounting the settings layout on every tab would throw away the unsaved
 * draft it holds and re-run its live preview. Its own outlet animates between the areas.
 */
function transitionKey(pathname: string) {
  return pathname.startsWith('/settings') ? '/settings' : pathname
}

function PageTransition({ scrollRef }: { scrollRef: RefObject<HTMLElement | null> }) {
  const outlet = useOutlet()
  const location = useLocation()
  const slide = useSoftSlide(8)
  const key = transitionKey(location.pathname)

  // The container is put back at the top before the new screen paints, so a screen is entered where
  // it starts rather than wherever the last one was left.
  useLayoutEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [key, scrollRef])

  return (
    // No `exit` on the screen itself: a leaving screen takes its leave at once, and the one that was
    // asked for mounts in the same commit. `initial={false}` is AnimatePresence's own "do not
    // animate the screen the window opens on".
    <AnimatePresence initial={false}>
      <motion.div
        key={key}
        initial={slide.initial}
        animate={slide.animate}
        transition={softTransition}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  )
}

/**
 * The rail's one row, and there is only one: a column for the icon, the row's own name, and
 * whatever the row counts pushed to its far end.
 *
 * A screen, a favourite, a terminal and the scan are all this shape, which is what makes a rail of
 * them read as a list rather than as a set of buttons — and a folded rail is the same row with its
 * name dropped, never a second row design. `active` is the fill of the row the window is on: one
 * step of the surface the rail itself wears, not an accent, because an accent here would compete
 * with the accent of the screen it points at.
 */
function railRow(collapsed: boolean, active = false) {
  return cn(
    'ease-warm flex shrink-0 items-center rounded-lg text-[0.8125rem] font-medium outline-none transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
    // Folded, the row is a square the width of the icon column's own centre line, so every icon in
    // the rail sits on one vertical axis whatever the row is — a screen, a pinned agent, a button.
    collapsed ? 'mx-auto size-9 justify-center' : 'h-9 w-full gap-2.5 px-2.5',
    active
      ? 'bg-surface-3 text-foreground'
      : 'text-muted hover:bg-surface-3/60 hover:text-foreground',
  )
}

/**
 * The icon column of a row: one 20px square that every icon in the rail is drawn in, a line glyph
 * and a pinned agent's tile alike. It is what keeps the icons one size — the glyph is centred in it
 * rather than sized against its neighbours — and what puts every row's name on one left edge.
 */
function RailIcon({ children }: { children: ReactNode }) {
  return (
    <span className="grid size-5 shrink-0 place-items-center [&>svg]:size-[18px]">{children}</span>
  )
}

/** What a row counts, in the quietest ink the rail has: metadata, never a badge. */
function RailCount({ children }: { children: number }) {
  return <span className="text-faint ml-auto text-[0.6875rem] tabular-nums">{children}</span>
}

/** Names a run of the rail's rows — a caption, not a headline, and never an accented one. */
function NavSection({ children }: { children: string }) {
  return (
    <h2 className="text-faint px-2 pt-3 pb-1 text-[0.6875rem] font-medium tracking-wide">
      {children}
    </h2>
  )
}

/**
 * Remembers the screen the window is on, so the next launch opens there — `boot()` reads the value
 * before the first render.
 *
 * Like the rail, this belongs to the shell and not to the Settings page: the backend keeps
 * `lastRoute` out of a whole-document save, so a Settings draft fetched earlier can never roll it
 * back. The comparison against what the backend already holds is what keeps a screen the user
 * stays on from being written again on every render, and a failed write from being retried in a
 * loop.
 */
function RouteMemory() {
  const { pathname } = useLocation()
  const cached = useSettings().data?.lastRoute
  const remember = useSetLastRoute()

  useEffect(() => {
    if (cached === undefined || cached === pathname) return
    remember.mutate(pathname)
  }, [cached, pathname, remember])

  return null
}

function ScanSummary() {
  const { t, i18n } = useTranslation()
  const { data } = useAgents()
  const { isScanning, progress } = useScanRefresh()

  if (!data) return null
  const when = formatRelative(data.scannedAtMs, i18n.language)
  const duration = formatDuration(data.durationMs)

  return (
    <div className="text-faint flex flex-col gap-1 px-2 pt-1 pb-1.5 text-[0.6875rem] leading-relaxed">
      {isScanning ? (
        <span className="text-accent-strong inline-flex items-center gap-1.5">
          <Spinner className="size-2.5" />
          {progress.total > 0
            ? t('agents.refreshingProgress', { done: progress.done, total: progress.total })
            : t('agents.refreshing')}
        </span>
      ) : (
        <span>
          {when && duration ? t('agents.lastScan', { when, duration }) : t('agents.neverScanned')}
        </span>
      )}
      <span>
        {t('agents.installedCount', { count: data.installed })} ·{' '}
        {t('agents.availableCount', { count: data.availableToInstall })}
      </span>
    </div>
  )
}

/**
 * The rail's own entries: one link per screen, each with the count of what that screen holds.
 *
 * Memoized, with its props held still by `AppShell`: the shell re-renders whenever the settings
 * document is replaced — which is once per navigation, when the screen the window is on is written
 * back — so a rail that rebuilt its six links and their tooltips underneath every screen change
 * would be doing it for nothing.
 */
const SidebarNav = memo(function SidebarNav({
  collapsed,
  counts,
  label,
}: {
  collapsed: boolean
  /** The badge of a screen, by path; a screen that holds nothing to count has none. */
  counts: Readonly<Record<string, number | undefined>>
  /** What the run of links is called — the `nav` landmark's own name. */
  label: string
}) {
  const { t } = useTranslation()

  return (
    <nav aria-label={label} className="flex flex-col gap-0.5">
      {NAV_ITEMS.map((item) => {
        const count = counts[item.to]
        return (
          <Tooltip key={item.to} content={collapsed ? t(item.labelKey) : null} side="right">
            {/* The Radix trigger must be a plain element: `asChild` merges `className`,
              which would stringify NavLink's className function and drop every class. */}
            <div className="flex">
              <NavLink
                to={item.to}
                end={item.end}
                data-tour={item.tour}
                aria-label={collapsed ? t(item.labelKey) : undefined}
                className={({ isActive }) => railRow(collapsed, isActive)}
              >
                <RailIcon>
                  <item.icon aria-hidden />
                </RailIcon>
                {collapsed ? null : (
                  <span className="min-w-0 flex-1 truncate">{t(item.labelKey)}</span>
                )}
                {!collapsed && count ? <RailCount>{count}</RailCount> : null}
              </NavLink>
            </div>
          </Tooltip>
        )
      })}
    </nav>
  )
})

export function AppShell() {
  const { t } = useTranslation()
  const { rescan, isScanning } = useScanRefresh()
  const scrollRef = useRef<HTMLElement>(null)
  // The rail's state is remembered between launches, so it lives in settings rather than in this
  // component — `boot()` primes it before the first render and the rail opens the way it was left.
  const collapsed = useSettings().data?.sidebarCollapsed ?? false
  const setSidebarCollapsed = useSetSidebarCollapsed()
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse')

  const workspaces = useTerminalStore((state) => state.workspaces)
  const expanded = useTerminalStore((state) => state.expanded)
  const maximized = useTerminalStore((state) => state.maximized)
  const catalog = useTerminals()
  const runInTerminal = useRunAgentInTerminal()
  /** The session a dialog was asked for: into a pane, or as a workspace of its own. */
  const [newSession, setNewSession] = useState<{ into?: { paneId: string; cwd: string } } | null>(
    null,
  )

  const openNew = useCallback(
    (into?: { paneId: string; cwd: string }) => {
      if (!catalog.data) {
        if (catalog.error) toastAppError(catalog.error)
        return
      }
      setNewSession({ into })
    },
    [catalog.data, catalog.error],
  )

  /** The sidebar's Terminal entry: show the dock, or ask for a first session when there is none. */
  const openTerminal = useCallback(() => {
    if (useTerminalStore.getState().workspaces.length === 0) openNew()
    else useTerminalStore.getState().toggleExpanded()
  }, [openNew])

  // `Ctrl+`` (and `Cmd+`` on macOS) toggles the dock, the way every editor's terminal does.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return
      if (event.code !== 'Backquote') return
      event.preventDefault()
      openTerminal()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [openTerminal])

  const { data: report } = useAgents()
  const { data: library } = useLibrary()
  const favoriteIds = useFavoriteAgents()
  // Sidebar entries in the order the user pinned them; ids with no agent in the report
  // (a hidden or removed agent) are dropped rather than rendered as a dead link.
  const favoriteAgents = useMemo(() => {
    const byId = new Map((report?.agents ?? []).map((agent) => [agent.id, agent]))
    return favoriteIds.flatMap((id) => {
      const agent = byId.get(id)
      return agent ? [agent] : []
    })
  }, [report, favoriteIds])
  // Held still for the memoized rail: a fresh object per render would redraw every link.
  const navCounts = useMemo<Record<string, number | undefined>>(
    () => ({
      '/agents': report?.installed,
      '/projects': report?.projects.projects.length,
      '/library': library
        ? library.stats.skills + library.stats.mcpServers + library.stats.other
        : undefined,
    }),
    [report, library],
  )

  // The rail is the window's own left edge: a full-height panel of its own tone, held apart from
  // the screens by a hairline and nothing else. Everything in it is the same row — `railRow` — and
  // the rows are grouped by what they are: what the rail does at its head (fold itself, open a
  // terminal), where it leads in the middle, and what the app itself does at its foot (scan the
  // machine, open Settings). The header is not above it but beside it — the content column's own
  // top row — so the rail keeps the window's full height.
  return (
    <TourProvider>
      <div className="bg-background flex h-full">
        <RouteMemory />
        <TrayBridge />
        <aside
          className={cn(
            'bg-surface-2 border-border ease-warm flex shrink-0 flex-col border-r transition-[width] duration-200',
            collapsed ? 'w-16' : 'w-64',
            // A terminal that took the window takes the rail with it; the dock's own restore
            // button is the way back, and the rail keeps its state while it stands down.
            maximized && 'hidden',
          )}
        >
          {/* The head: the rail's own controls. The one action a rail can offer that is not a
              screen — a terminal — sits here, under the fold, the way "new chat" does. */}
          <div className="flex shrink-0 flex-col gap-0.5 p-2">
            <Tooltip content={toggleLabel} side={collapsed ? 'right' : 'top'}>
              <button
                type="button"
                aria-label={collapsed ? toggleLabel : undefined}
                aria-expanded={!collapsed}
                onClick={() => setSidebarCollapsed.mutate(!collapsed)}
                className={railRow(collapsed)}
              >
                <RailIcon>
                  {collapsed ? <PanelLeftOpen aria-hidden /> : <PanelLeftClose aria-hidden />}
                </RailIcon>
                {collapsed ? null : (
                  <span className="min-w-0 flex-1 truncate text-left">{toggleLabel}</span>
                )}
              </button>
            </Tooltip>

            <Tooltip content={t('nav.terminal')} side={collapsed ? 'right' : 'top'}>
              <button
                type="button"
                data-tour="nav-terminal"
                aria-label={collapsed ? t('nav.terminal') : undefined}
                aria-expanded={workspaces.length > 0 ? expanded : undefined}
                onClick={openTerminal}
                className={railRow(collapsed)}
              >
                <RailIcon>
                  <TerminalIcon aria-hidden />
                </RailIcon>
                {collapsed ? null : (
                  <span className="min-w-0 flex-1 truncate text-left">{t('nav.terminal')}</span>
                )}
                {!collapsed && workspaces.length > 0 ? (
                  <RailCount>{workspaces.length}</RailCount>
                ) : null}
              </button>
            </Tooltip>
          </div>

          <div className="border-border mx-2 shrink-0 border-t" aria-hidden />

          <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-x-hidden overflow-y-auto px-2 py-2">
            <div className="flex flex-col">
              {collapsed ? null : <NavSection>{t('nav.sections')}</NavSection>}
              <SidebarNav collapsed={collapsed} counts={navCounts} label={t('nav.sections')} />
            </div>

            <Reveal open={favoriteAgents.length > 0}>
              <div className="flex flex-col">
                {collapsed ? (
                  <span aria-hidden className="border-border mx-auto my-1.5 w-6 border-t" />
                ) : (
                  <NavSection>{t('nav.favorites')}</NavSection>
                )}
                <nav aria-label={t('nav.favorites')}>
                  <AnimatedList grouped={false} className="flex flex-col gap-0.5">
                    {favoriteAgents.map((agent) => (
                      <ContextMenu key={agent.id}>
                        <ContextMenuTrigger asChild>
                          <div className="group relative flex">
                            <Tooltip content={collapsed ? agent.name : null} side="right">
                              {/* A plain element for the Radix trigger, as in the screens above:
                                  `asChild` would merge into NavLink's `className` function and
                                  drop every class of the row. */}
                              <div className="flex w-full">
                                <NavLink
                                  to={`/agents/${agent.id}`}
                                  aria-label={collapsed ? agent.name : undefined}
                                  className={({ isActive }) => railRow(collapsed, isActive)}
                                >
                                  <RailIcon>
                                    <AgentIcon name={agent.name} icon={agent.icon} size="xs" />
                                  </RailIcon>
                                  {collapsed ? null : (
                                    <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                                  )}
                                </NavLink>
                              </div>
                            </Tooltip>

                            {/* A favourite is one click away from running: the button floats over the
                            row's far end on hover (so the name keeps the whole row and nothing
                            shifts) and only the installed agents get one, so the row never offers
                            a command that would be refused. */}
                            {!collapsed && agent.status === 'installed' ? (
                              <Tooltip content={t('agents.runInTerminal')} side="left">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  className="absolute top-1 right-1 size-7 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
                                  aria-label={`${t('agents.runInTerminal')} — ${agent.name}`}
                                  onClick={() => runInTerminal(agent)}
                                >
                                  <TerminalIcon className="size-3.5" aria-hidden />
                                </Button>
                              </Tooltip>
                            ) : null}
                          </div>
                        </ContextMenuTrigger>

                        {/* The collapsed rail has no room for a second button, so the same action is
                        a right click — the pattern every other surface with actions uses. */}
                        <ContextMenuContent aria-label={agent.name}>
                          <ContextMenuLabel>{agent.name}</ContextMenuLabel>
                          {agent.status === 'installed' ? (
                            <ContextMenuItem onSelect={() => runInTerminal(agent)}>
                              <TerminalIcon aria-hidden />
                              {t('agents.runInTerminal')}
                            </ContextMenuItem>
                          ) : null}
                        </ContextMenuContent>
                      </ContextMenu>
                    ))}
                  </AnimatedList>
                </nav>
              </div>
            </Reveal>
          </div>

          {/* The foot: what the app itself does — read the machine again, and change how it
              behaves. The scan is a sentence about the machine, not a control, so it sits above
              the rows the way a plan does above an account. */}
          <div className="border-border flex shrink-0 flex-col gap-0.5 border-t p-2">
            {collapsed ? null : <ScanSummary />}
            <Tooltip content={t('agents.rescan')} side={collapsed ? 'right' : 'top'}>
              <button
                type="button"
                className={railRow(collapsed)}
                aria-label={collapsed ? t('agents.rescan') : undefined}
                aria-busy={isScanning || undefined}
                disabled={isScanning}
                onClick={rescan}
              >
                <RailIcon>
                  {isScanning ? <Spinner className="size-4" /> : <RefreshCw aria-hidden />}
                </RailIcon>
                {collapsed ? null : (
                  <span className="min-w-0 flex-1 truncate text-left">{t('agents.rescan')}</span>
                )}
              </button>
            </Tooltip>

            <Tooltip content={t('nav.settings')} side={collapsed ? 'right' : 'top'}>
              <div className="flex">
                <NavLink
                  to="/settings"
                  data-tour="nav-settings"
                  aria-label={collapsed ? t('nav.settings') : undefined}
                  className={({ isActive }) => railRow(collapsed, isActive)}
                >
                  <RailIcon>
                    <SettingsIcon aria-hidden />
                  </RailIcon>
                  {collapsed ? null : (
                    <span className="min-w-0 flex-1 truncate">{t('nav.settings')}</span>
                  )}
                </NavLink>
              </div>
            </Tooltip>
          </div>
        </aside>

        <div className="flex min-w-0 flex-1 flex-col gap-3 p-3">
          <TitleBar />
          {/* A maximized terminal takes the screen's room, not its place in the tree: hidden and
              never unmounted, so the page it covered comes back as it was — same scroll position,
              same filters, no query re-run. */}
          <main
            ref={scrollRef}
            className={cn('min-w-0 flex-1 overflow-y-auto', maximized && 'hidden')}
          >
            <div className="mx-auto flex max-w-[var(--ah-content-width)] flex-col gap-6 px-8 py-8">
              <PageTransition scrollRef={scrollRef} />
            </div>
          </main>

          {/* The terminal sits under every screen, in the content column: the tab strip stays
            visible while the pages above keep working, and the sidebar keeps its full height.
            Maximized, it is that column's flexible row and the two give way to it. */}
          {workspaces.length > 0 ? (
            <Suspense
              fallback={
                <div
                  aria-hidden
                  className="border-border bg-surface h-11 shrink-0 animate-pulse rounded-2xl border"
                />
              }
            >
              <TerminalDock onNew={openNew} />
            </Suspense>
          ) : null}
        </div>

        {newSession && catalog.data ? (
          <NewTerminalDialog
            catalog={catalog.data}
            into={newSession.into}
            onOpenChange={() => setNewSession(null)}
          />
        ) : null}
      </div>
    </TourProvider>
  )
}
