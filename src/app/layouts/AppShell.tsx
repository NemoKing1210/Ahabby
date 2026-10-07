import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useRef,
  useState,
  useMemo,
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
import { glideTransition, softTransition, useSoftSlide } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
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

import { TrayBridge } from './TrayBridge'

const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.home', icon: House, end: true },
  { to: '/agents', labelKey: 'nav.agents', icon: Boxes, end: false },
  { to: '/projects', labelKey: 'nav.projects', icon: FolderGit2, end: false },
  { to: '/library', labelKey: 'nav.library', icon: Library, end: false },
  { to: '/hub', labelKey: 'nav.hub', icon: Store, end: false },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon, end: false },
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
 * Screens cross-fade instead of hard-swapping.
 *
 * `mode="wait"` finishes the outgoing screen before the next one paints, so the two never
 * overlap, and the scroll container is returned to the top once the old screen is gone.
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

  return (
    <AnimatePresence
      mode="wait"
      initial={false}
      onExitComplete={() => scrollRef.current?.scrollTo({ top: 0 })}
    >
      <motion.div
        key={transitionKey(location.pathname)}
        initial={slide.initial}
        animate={slide.animate}
        exit={slide.exit}
        transition={softTransition}
      >
        {outlet}
      </motion.div>
    </AnimatePresence>
  )
}

/** Small uppercase label that names a run of sidebar links. */
function NavSection({ children }: { children: string }) {
  return (
    <h2 className="text-faint px-3 pt-1 pb-1.5 text-[0.6875rem] font-medium tracking-wider uppercase">
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
    <div className="text-faint flex flex-col gap-1 text-[0.6875rem] leading-relaxed">
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

export function AppShell() {
  const { t } = useTranslation()
  const { rescan, isScanning } = useScanRefresh()
  const scrollRef = useRef<HTMLElement>(null)
  // The rail's state is remembered between launches, so it lives in settings rather than in this
  // component — `boot()` primes it before the first render and the rail opens the way it was left.
  const collapsed = useSettings().data?.sidebarCollapsed ?? false
  const setSidebarCollapsed = useSetSidebarCollapsed()
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse')

  const tabs = useTerminalStore((state) => state.tabs)
  const expanded = useTerminalStore((state) => state.expanded)
  const catalog = useTerminals()
  const runInTerminal = useRunAgentInTerminal()
  const [newOpen, setNewOpen] = useState(false)

  const openNew = useCallback(() => {
    if (!catalog.data) {
      if (catalog.error) toastAppError(catalog.error)
      return
    }
    setNewOpen(true)
  }, [catalog.data, catalog.error])

  /** The sidebar's Terminal entry: show the dock, or ask for a first session when there is none. */
  const openTerminal = useCallback(() => {
    if (useTerminalStore.getState().tabs.length === 0) openNew()
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
  const navCounts: Record<string, number | undefined> = {
    '/agents': report?.installed,
    '/projects': report?.projects.projects.length,
    '/library': library
      ? library.stats.skills + library.stats.mcpServers + library.stats.other
      : undefined,
  }

  // The window is one flat background; the sidebar floats over it as an inset panel, so the
  // rail never fuses with the window edges and reads as its own surface.
  return (
    <div className="bg-background flex h-full gap-3 p-3">
      <RouteMemory />
      <TrayBridge />
      <aside
        className={cn(
          'border-border bg-surface shadow-panel ease-warm flex shrink-0 flex-col gap-2 rounded-2xl border p-2.5 transition-[width] duration-200',
          collapsed ? 'w-[4.5rem]' : 'w-64',
        )}
      >
        <div
          className={cn('flex shrink-0 items-center', collapsed ? 'justify-center' : 'justify-end')}
        >
          <Tooltip content={toggleLabel} side="right">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={toggleLabel}
              aria-expanded={!collapsed}
              onClick={() => setSidebarCollapsed.mutate(!collapsed)}
            >
              {collapsed ? (
                <PanelLeftOpen className="size-4.5" aria-hidden />
              ) : (
                <PanelLeftClose className="size-4.5" aria-hidden />
              )}
            </Button>
          </Tooltip>
        </div>

        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-x-hidden overflow-y-auto">
          <div className="flex flex-col">
            {collapsed ? null : <NavSection>{t('nav.sections')}</NavSection>}
            <nav aria-label={t('nav.sections')} className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Tooltip key={item.to} content={collapsed ? t(item.labelKey) : null} side="right">
                  {/* The Radix trigger must be a plain element: `asChild` merges `className`,
                      which would stringify NavLink's className function and drop every class. */}
                  <div className="flex">
                    <NavLink
                      to={item.to}
                      end={item.end}
                      aria-label={collapsed ? t(item.labelKey) : undefined}
                      className={({ isActive }) =>
                        cn(
                          'ease-warm relative flex items-center rounded-xl text-[0.9375rem] font-medium transition-colors duration-150',
                          collapsed ? 'mx-auto size-11 justify-center' : 'flex-1 gap-3 px-3 py-2.5',
                          isActive
                            ? 'text-accent-strong'
                            : 'text-muted hover:bg-surface-2 hover:text-foreground',
                        )
                      }
                    >
                      {({ isActive }) => (
                        <>
                          {isActive ? (
                            <motion.span
                              aria-hidden
                              layoutId="nav-active-pill"
                              transition={glideTransition}
                              className="bg-accent-soft absolute inset-0 rounded-xl"
                            />
                          ) : null}
                          <item.icon className="relative size-5 shrink-0" aria-hidden />
                          {collapsed ? null : (
                            <span className="relative flex-1 truncate">{t(item.labelKey)}</span>
                          )}
                          {!collapsed && navCounts[item.to] ? (
                            <Badge
                              tone={isActive ? 'accent' : 'neutral'}
                              className="relative tabular-nums"
                            >
                              {navCounts[item.to]}
                            </Badge>
                          ) : null}
                        </>
                      )}
                    </NavLink>
                  </div>
                </Tooltip>
              ))}
            </nav>
          </div>

          <Reveal open={favoriteAgents.length > 0}>
            <div className="flex flex-col">
              {collapsed ? (
                <span aria-hidden className="border-border mx-auto my-1.5 w-6 border-t" />
              ) : (
                <NavSection>{t('nav.favorites')}</NavSection>
              )}
              <nav aria-label={t('nav.favorites')}>
                <AnimatedList grouped={false} className="flex flex-col gap-1">
                  {favoriteAgents.map((agent) => (
                    <ContextMenu key={agent.id}>
                      <ContextMenuTrigger asChild>
                        <div className={cn('group flex items-center', !collapsed && 'gap-1')}>
                          <Tooltip content={collapsed ? agent.name : null} side="right">
                            <NavLink
                              to={`/agents/${agent.id}`}
                              aria-label={collapsed ? agent.name : undefined}
                              className={({ isActive }) =>
                                cn(
                                  'ease-warm relative flex items-center rounded-xl text-[0.8125rem] transition-colors duration-150',
                                  collapsed
                                    ? 'mx-auto size-10 justify-center'
                                    : 'min-w-0 flex-1 gap-2.5 px-3 py-2',
                                  isActive
                                    ? 'bg-accent-soft text-accent-strong'
                                    : 'text-muted hover:bg-surface-2 hover:text-foreground',
                                )
                              }
                            >
                              <AgentIcon name={agent.name} icon={agent.icon} size="xs" />
                              {collapsed ? null : (
                                <span className="relative min-w-0 flex-1 truncate">
                                  {agent.name}
                                </span>
                              )}
                            </NavLink>
                          </Tooltip>

                          {/* A favourite is one click away from running: the button keeps its place
                            (so nothing shifts on hover) and only the installed agents get one, so
                            the row never offers a command that would be refused. */}
                          {!collapsed && agent.status === 'installed' ? (
                            <Tooltip content={t('agents.runInTerminal')} side="left">
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                className="size-7 shrink-0 opacity-0 transition-opacity duration-150 group-hover:opacity-100 focus-visible:opacity-100"
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

        <div
          className={cn(
            'border-border flex shrink-0 flex-col gap-2 border-t pt-2.5',
            collapsed && 'items-center',
          )}
        >
          {collapsed ? null : <ScanSummary />}
          <Tooltip content={t('nav.terminal')} side={collapsed ? 'right' : 'top'}>
            <Button
              variant="subtle"
              size="sm"
              className={cn('w-full', collapsed && 'justify-center px-0')}
              aria-label={collapsed ? t('nav.terminal') : undefined}
              aria-expanded={tabs.length > 0 ? expanded : undefined}
              onClick={openTerminal}
            >
              <TerminalIcon className="size-3.5" aria-hidden />
              {collapsed ? null : <span>{t('nav.terminal')}</span>}
              {!collapsed && tabs.length > 0 ? (
                <Badge tone="neutral" className="ml-auto tabular-nums">
                  {tabs.length}
                </Badge>
              ) : null}
            </Button>
          </Tooltip>
          <Tooltip content={t('agents.rescan')} side={collapsed ? 'right' : 'top'}>
            <Button
              variant="subtle"
              size="sm"
              className={cn('w-full', collapsed && 'justify-center px-0')}
              aria-label={collapsed ? t('agents.rescan') : undefined}
              onClick={rescan}
              loading={isScanning}
            >
              {isScanning ? null : <RefreshCw className="size-3.5" aria-hidden />}
              {collapsed ? null : <span>{t('agents.rescan')}</span>}
            </Button>
          </Tooltip>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
            <PageTransition scrollRef={scrollRef} />
          </div>
        </main>

        {/* The terminal sits under every screen, in the content column: the tab strip stays
            visible while the pages above keep working, and the sidebar keeps its full height. */}
        {tabs.length > 0 ? (
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

      {newOpen && catalog.data ? (
        <NewTerminalDialog catalog={catalog.data} onOpenChange={() => setNewOpen(false)} />
      ) : null}
    </div>
  )
}
