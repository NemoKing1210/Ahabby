import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Boxes,
  ChevronRight,
  FileText,
  HardDrive,
  Library as LibraryIcon,
  Lock,
  Plug,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import type { LibraryStats } from '@/shared/bindings/LibraryStats'
import { formatCount } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { ErrorState } from '@/shared/ui/EmptyState'
import { Skeleton } from '@/shared/ui/Primitives'

import { useFavoriteAgents, useAgents } from '@/features/agents/api/queries'
import { installedAgents } from '@/features/agents/lib/favorites'
import { useLibrary } from '@/features/library/api/queries'

import { AgentLedger } from '../components/AgentLedger'
import { HomeHero } from '../components/HomeHero'

/** The key caps of the terminal shortcut, styled like a keyboard legend, not a control. */
const KBD = cn(
  'border-border bg-surface-2 text-muted inline-flex min-w-6 items-center justify-center rounded-md border px-1.5 py-0.5 font-mono text-[0.6875rem]',
)

/** One number of the summary, and the screen that explains it. */
function SummaryTile({
  to,
  icon: Icon,
  label,
  hint,
  value,
  loading = false,
}: {
  to: string
  icon: LucideIcon
  label: string
  hint: string
  /** `undefined` outside of loading means the number cannot be read right now. */
  value: number | undefined
  loading?: boolean
}) {
  const { i18n } = useTranslation()

  return (
    <Link
      to={to}
      className="group border-border bg-surface hover:border-border-strong hover:bg-surface-2 ease-warm flex flex-col gap-2.5 rounded-xl border p-4 transition-colors duration-150"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-faint text-[0.6875rem] font-medium tracking-wide uppercase">
          {label}
        </span>
        <Icon
          aria-hidden
          className="text-faint group-hover:text-accent-strong size-4 shrink-0 transition-colors duration-150"
        />
      </span>
      {loading ? (
        <Skeleton className="h-8 w-12" />
      ) : (
        <span className="font-serif text-3xl leading-none tabular-nums">
          {value === undefined ? '—' : formatCount(value, i18n.language)}
        </span>
      )}
      <span className="text-muted text-[0.75rem]">{hint}</span>
    </Link>
  )
}

/** A row of the "go to" list: the icon tile matches the group headers the rest of the app uses. */
function SectionLink({
  to,
  icon: Icon,
  label,
  hint,
  count,
}: {
  to: string
  icon: LucideIcon
  label: string
  hint: string
  count?: number
}) {
  return (
    <Link
      to={to}
      className="group hover:bg-surface-2 ease-warm -mx-2 flex items-center gap-3 rounded-lg px-2 py-2.5 transition-colors duration-150"
    >
      <span
        aria-hidden
        className="bg-surface-2 text-muted group-hover:text-foreground inline-flex size-9 shrink-0 items-center justify-center rounded-lg transition-colors duration-150"
      >
        <Icon className="size-4.5" />
      </span>
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center gap-2 text-[0.9375rem]">
          {label}
          {count === undefined ? null : <Badge tone="neutral">{count}</Badge>}
        </span>
        <span className="text-muted text-[0.75rem]">{hint}</span>
      </span>
      <ChevronRight
        aria-hidden
        className="text-faint size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
      />
    </Link>
  )
}

/** One promise the program makes, with the icon that names it. */
function AboutPoint({
  icon: Icon,
  title,
  hint,
}: {
  icon: LucideIcon
  title: string
  hint: string
}) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden
        className="bg-surface-2 text-accent-strong inline-flex size-7 shrink-0 items-center justify-center rounded-lg"
      >
        <Icon className="size-3.5" />
      </span>
      <span className="flex flex-col gap-0.5">
        <span className="text-[0.875rem]">{title}</span>
        <span className="text-muted text-[0.75rem] leading-relaxed">{hint}</span>
      </span>
    </li>
  )
}

/**
 * The front door of the app: what Ahabby is, a summary of what the last scan found, the three
 * screens it leads to, and the roster of the agents installed on this machine.
 *
 * Everything is read from the same two queries the sidebar uses — the agent report and the
 * library — so this page needs no data of its own and is instant after the first scan.
 */
export function HomePage() {
  const { t } = useTranslation()
  const report = useAgents()
  const library = useLibrary()
  const favoriteIds = useFavoriteAgents()

  const installed = useMemo(
    () => installedAgents(report.data?.agents ?? [], favoriteIds),
    [report.data, favoriteIds],
  )

  if (report.isLoading && !report.data) {
    return (
      <div className="flex flex-col gap-6" aria-busy="true">
        <Skeleton className="h-56 rounded-xl" />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <Skeleton key={index} className="h-28 rounded-xl" />
          ))}
        </div>
      </div>
    )
  }

  if (report.error && !report.data) {
    return <ErrorState error={report.error} onRetry={() => void report.refetch()} />
  }

  const stats = library.data?.stats
  const count = (pick: (value: LibraryStats) => number) => (stats ? pick(stats) : undefined)
  const loadingStats = library.isLoading && !stats

  return (
    <div className="flex flex-col gap-6">
      <HomeHero report={report.data} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg">{t('home.summary')}</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryTile
            to="/agents"
            icon={Boxes}
            label={t('home.agentsInstalled')}
            value={report.data?.installed}
            hint={
              (report.data?.availableToInstall ?? 0) > 0
                ? t('home.agentsFree', { count: report.data?.availableToInstall ?? 0 })
                : t('home.agentsComplete')
            }
          />
          <SummaryTile
            to="/library"
            icon={Sparkles}
            label={t('home.skills')}
            value={count((value) => value.skills)}
            hint={t('home.skillsHint')}
            loading={loadingStats}
          />
          <SummaryTile
            to="/library"
            icon={Plug}
            label={t('home.mcpServers')}
            value={count((value) => value.mcpServers)}
            hint={t('home.mcpHint')}
            loading={loadingStats}
          />
          <SummaryTile
            to="/library"
            icon={FileText}
            label={t('home.otherResources')}
            value={count((value) => value.other)}
            hint={t('home.otherHint')}
            loading={loadingStats}
          />
        </div>
      </section>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t('home.sections')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-1">
            <SectionLink
              to="/agents"
              icon={Boxes}
              label={t('nav.agents')}
              hint={t('home.agentsHint')}
              count={report.data?.installed}
            />
            <SectionLink
              to="/library"
              icon={LibraryIcon}
              label={t('nav.library')}
              hint={t('home.libraryHint')}
              count={stats ? stats.skills + stats.mcpServers + stats.other : undefined}
            />
            <SectionLink
              to="/settings"
              icon={SettingsIcon}
              label={t('nav.settings')}
              hint={t('home.settingsHint')}
            />
          </CardContent>
        </Card>

        <Card className="flex flex-col">
          <CardHeader>
            <CardTitle>{t('home.about')}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted text-[0.8125rem]">{t('home.aboutBody')}</p>
            <ul className="flex flex-col gap-3">
              <AboutPoint
                icon={HardDrive}
                title={t('home.localTitle')}
                hint={t('home.localHint')}
              />
              <AboutPoint
                icon={ShieldCheck}
                title={t('home.backupTitle')}
                hint={t('home.backupHint')}
              />
              <AboutPoint
                icon={Lock}
                title={t('home.commandsTitle')}
                hint={t('home.commandsHint')}
              />
            </ul>
            <div className="border-border flex flex-wrap items-center justify-between gap-3 border-t pt-3">
              <span className="text-faint text-[0.75rem]">{t('home.shortcut')}</span>
              <span className="text-muted flex items-center gap-1">
                <kbd className={KBD}>Ctrl</kbd>
                <kbd className={KBD}>⌘</kbd>
                <span aria-hidden>+</span>
                <kbd className={KBD}>`</kbd>
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg">
          {t('home.machine')}
          <Badge tone="neutral">{installed.length}</Badge>
        </h2>
        <AgentLedger agents={installed} />
      </section>
    </div>
  )
}
