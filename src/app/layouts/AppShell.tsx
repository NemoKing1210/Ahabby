import { useRef, useState, useMemo, type RefObject } from 'react'

import {
  Boxes,
  Library,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  Settings as SettingsIcon,
} from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useOutlet } from 'react-router-dom'

import { formatDuration, formatRelative } from '@/shared/lib/format'
import { glideTransition, softTransition, useSoftSlide } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Primitives'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useAgents, useFavoriteAgents } from '@/features/agents/api/queries'
import { useScanRefresh } from '@/features/agents/api/scan'
import { useLibrary } from '@/features/library/api/queries'

const NAV_ITEMS = [
  { to: '/', labelKey: 'nav.agents', icon: Boxes, end: true },
  { to: '/library', labelKey: 'nav.library', icon: Library, end: false },
  { to: '/settings', labelKey: 'nav.settings', icon: SettingsIcon, end: false },
] as const

/**
 * Screens cross-fade instead of hard-swapping.
 *
 * `mode="wait"` finishes the outgoing screen before the next one paints, so the two never
 * overlap, and the scroll container is returned to the top once the old screen is gone.
 */
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
        key={location.pathname}
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
  const [collapsed, setCollapsed] = useState(false)
  const toggleLabel = collapsed ? t('nav.expand') : t('nav.collapse')

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
    '/': report?.installed,
    '/library': library
      ? library.stats.skills + library.stats.mcpServers + library.stats.other
      : undefined,
  }

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside
          className={cn(
            'border-border bg-surface-2/60 ease-warm flex shrink-0 flex-col justify-between border-r py-4 transition-[width,padding] duration-200',
            collapsed ? 'w-[4.75rem] px-2' : 'w-60 px-3',
          )}
        >
          <div className="flex min-h-0 flex-col gap-3 overflow-y-auto">
            <div className={cn('flex', collapsed ? 'justify-center' : 'justify-end')}>
              <Tooltip content={toggleLabel} side="right">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={toggleLabel}
                  aria-expanded={!collapsed}
                  onClick={() => setCollapsed((value) => !value)}
                >
                  {collapsed ? (
                    <PanelLeftOpen className="size-4.5" aria-hidden />
                  ) : (
                    <PanelLeftClose className="size-4.5" aria-hidden />
                  )}
                </Button>
              </Tooltip>
            </div>

            <nav aria-label={t('nav.sections')} className="flex flex-col gap-1">
              {NAV_ITEMS.map((item) => (
                <Tooltip key={item.to} content={collapsed ? t(item.labelKey) : null} side="right">
                  {/* The Radix trigger must be a plain element: `asChild` merges `className`,
                      which would stringify NavLink's className function and drop every class. */}
                  <div className="flex">
                    <NavLink
                      to={item.to}
                      end={item.end}
                      className={({ isActive }) =>
                        cn(
                          'ease-warm relative flex flex-1 items-center rounded-xl text-[15px] transition-colors duration-150',
                          collapsed ? 'justify-center px-0 py-3' : 'gap-3 px-3 py-2.5',
                          isActive
                            ? 'text-foreground'
                            : 'text-muted hover:bg-surface-3/50 hover:text-foreground',
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
                              className="bg-surface-3 absolute inset-0 rounded-xl"
                            />
                          ) : null}
                          <item.icon className="relative size-5 shrink-0" aria-hidden />
                          {collapsed ? null : (
                            <span className="relative flex-1 whitespace-nowrap">
                              {t(item.labelKey)}
                            </span>
                          )}
                          {!collapsed && navCounts[item.to] ? (
                            <Badge tone="neutral" className="relative tabular-nums">
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

            {favoriteAgents.length > 0 ? (
              <div className="flex flex-col gap-1">
                {collapsed ? (
                  <span aria-hidden className="border-border mx-auto my-1 w-6 border-t" />
                ) : (
                  <h2 className="text-faint px-3 pt-1 pb-0.5 text-[0.6875rem] font-medium tracking-wide uppercase">
                    {t('nav.favorites')}
                  </h2>
                )}
                <nav aria-label={t('nav.favorites')} className="flex flex-col gap-1">
                  {favoriteAgents.map((agent) => (
                    <Tooltip key={agent.id} content={collapsed ? agent.name : null} side="right">
                      <div className="flex">
                        <NavLink
                          to={`/agents/${agent.id}`}
                          className={({ isActive }) =>
                            cn(
                              'ease-warm relative flex flex-1 items-center rounded-xl text-[13px] transition-colors duration-150',
                              collapsed ? 'justify-center px-0 py-2.5' : 'gap-2.5 px-3 py-2',
                              isActive
                                ? 'bg-surface-3 text-foreground'
                                : 'text-muted hover:bg-surface-3/50 hover:text-foreground',
                            )
                          }
                        >
                          <AgentIcon name={agent.name} icon={agent.icon} size="xs" />
                          {collapsed ? null : (
                            <span className="relative min-w-0 flex-1 truncate">{agent.name}</span>
                          )}
                        </NavLink>
                      </div>
                    </Tooltip>
                  ))}
                </nav>
              </div>
            ) : null}
          </div>

          <div className={cn('flex flex-col gap-3', collapsed ? 'px-0' : 'px-1')}>
            {collapsed ? null : <ScanSummary />}
            <Tooltip content={t('agents.rescan')} side={collapsed ? 'right' : 'top'}>
              <Button
                variant="secondary"
                size="sm"
                className={cn('w-full', collapsed ? 'justify-center px-0' : 'justify-start')}
                disabled={isScanning}
                onClick={rescan}
              >
                {isScanning ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
                {collapsed ? null : (
                  <span>{isScanning ? t('agents.rescanning') : t('agents.rescan')}</span>
                )}
              </Button>
            </Tooltip>
          </div>
        </aside>

        <main ref={scrollRef} className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
            <PageTransition scrollRef={scrollRef} />
          </div>
        </main>
      </div>
    </div>
  )
}
