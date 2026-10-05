import { Boxes, Library, RefreshCw, Settings as SettingsIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { NavLink, Outlet } from 'react-router-dom'

import { formatDuration, formatRelative } from '@/shared/lib/format'
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

  return (
    <div className="bg-background flex h-full">
      <aside className="border-border bg-surface-2/60 flex w-60 shrink-0 flex-col justify-between border-r px-3 py-4">
        <div className="flex flex-col gap-6">
          <div className="flex items-center gap-2 px-2">
            <span
              aria-hidden
              className="bg-foreground text-background flex size-7 items-center justify-center rounded-lg font-serif text-sm"
            >
              A
            </span>
            <div className="flex flex-col">
              <span className="font-serif text-sm leading-tight">{t('app.name')}</span>
              <span className="text-faint text-[10px] leading-tight">{t('app.tagline')}</span>
            </div>
          </div>

          <nav aria-label={t('nav.sections')} className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    'ease-warm flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors duration-150',
                    isActive
                      ? 'bg-surface text-foreground'
                      : 'text-muted hover:bg-surface hover:text-foreground',
                  )
                }
              >
                <item.icon className="size-4" aria-hidden />
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>
        </div>

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

      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-5xl flex-col gap-6 px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  )
}
