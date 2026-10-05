import { useRef, type RefObject } from 'react'

import { Boxes, Library, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { NavLink, useLocation, useOutlet } from 'react-router-dom'

import { formatDuration, formatRelative } from '@/shared/lib/format'
import { glideTransition, softTransition, useSoftSlide } from '@/shared/lib/motion'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Spinner } from '@/shared/ui/Primitives'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useRescan, useAgents } from '@/features/agents/api/queries'

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

  if (!data) return null
  const when = formatRelative(data.scannedAtMs, i18n.language)
  const duration = formatDuration(data.durationMs)

  return (
    <div className="text-faint flex flex-col gap-1 text-[11px] leading-relaxed">
      <span>
        {when && duration ? t('agents.lastScan', { when, duration }) : t('agents.neverScanned')}
      </span>
      <span>
        {t('agents.installedCount', { count: data.installed })} ·{' '}
        {t('agents.availableCount', { count: data.availableToInstall })}
      </span>
    </div>
  )
}

export function AppShell() {
  const { t } = useTranslation()
  const rescan = useRescan()
  const scrollRef = useRef<HTMLElement>(null)

  return (
    <div className="bg-background flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        <aside className="border-border bg-surface-2/60 flex w-60 shrink-0 flex-col justify-between border-r px-3 py-4">
          <nav aria-label={t('nav.sections')} className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'ease-warm relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150',
                    isActive
                      ? 'text-foreground'
                      : 'text-muted hover:bg-surface hover:text-foreground',
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
                        className="bg-surface absolute inset-0 rounded-lg"
                      />
                    ) : null}
                    <item.icon className="relative size-4" aria-hidden />
                    <span className="relative">{t(item.labelKey)}</span>
                  </>
                )}
              </NavLink>
            ))}
          </nav>

          <div className="flex flex-col gap-3 px-1">
            <ScanSummary />
            <Tooltip content={t('agents.rescan')}>
              <Button
                variant="secondary"
                size="sm"
                className="w-full justify-start"
                disabled={rescan.isPending}
                onClick={() =>
                  rescan.mutate(undefined, {
                    onError: (error) => toastAppError(error),
                  })
                }
              >
                {rescan.isPending ? <Spinner /> : <RefreshCw className="size-3.5" aria-hidden />}
                {rescan.isPending ? t('agents.rescanning') : t('agents.rescan')}
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
