import { useRef } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, ExternalLink, FileText } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import { isKnownNumber } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { SkeletonList } from '@/shared/ui/Primitives'
import { SectionHeader } from '@/shared/ui/SectionHeader'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { HubEntryCard } from './HubEntryCard'

/** Entries asked for per request. The MCP registry is slowest with a *small* page, not a large one. */
export const PAGE_SIZE = 16

/**
 * One source of the hub: its own heading, its own paging, and its own answer.
 *
 * Each section owns one request chain, so a collection that is slow, down or refuses is a note
 * under its own heading — it never holds back, or empties, the other collections. The search text
 * and the kind filter are part of the query key, so retyping the search resets every section to
 * its first page at once.
 */
export function HubSourceSection({
  source,
  kind,
  query,
  tags,
  generation,
  onView,
  onInstall,
  onRefresh,
  refreshingId,
}: {
  source: HubSource
  kind: HubResourceKind | null
  query: string
  /** Tags the toolbar filters by; the backend applies them before the page is cut. */
  tags: string[]
  /** Bumped when the user refreshes: the first page of a new generation ignores the backend cache. */
  generation: number
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  /** The entry whose collection is being re-read right now, if any. */
  refreshingId?: string | null
}) {
  const { t } = useTranslation()
  // The last generation whose first page was already asked for with `refresh`. A ref rather than
  // state: it must not re-render, and it must survive the query key changing under it.
  const forced = useRef(generation)
  const page = useInfiniteQuery({
    queryKey: queryKeys.hubSource(source.id, kind, query, PAGE_SIZE, generation, tags),
    queryFn: ({ pageParam }) => {
      const refresh = pageParam === null && forced.current !== generation
      forced.current = generation
      return ipc.searchHub(source.id, {
        query,
        kind,
        tags,
        cursor: pageParam,
        limit: PAGE_SIZE,
        refresh,
      })
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.report.nextCursor ?? undefined,
    // The backend caches an answer for ten minutes; re-asking sooner is what Refresh is for.
    staleTime: 10 * 60_000,
  })

  const entries = page.data?.pages.flatMap((loaded) => loaded.entries) ?? []
  const report = page.data?.pages.at(-1)?.report
  const link = source.homepage ?? source.docs

  return (
    <section className="flex flex-col gap-3">
      <SectionHeader
        leading={<AgentIcon name={source.name} size="sm" />}
        title={source.name}
        count={report?.total ?? (entries.length > 0 ? entries.length : undefined)}
      >
        {source.builtin ? null : <Badge tone="accent">{t('hub.yourSource')}</Badge>}
        {report ? (
          <span className="text-faint text-[0.75rem]">
            {report.fromCache ? t('hub.cached') : `${report.durationMs} ms`}
          </span>
        ) : null}
        {link ? (
          <Tooltip content={t('hub.openSource')}>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('hub.openSource')}
              onClick={() => {
                void ipc.openUrl(link).catch(toastAppError)
              }}
            >
              <ExternalLink className="size-3.5" />
            </Button>
          </Tooltip>
        ) : null}
      </SectionHeader>

      {source.description ? (
        <p className="text-muted max-w-3xl text-[0.8125rem]">{source.description}</p>
      ) : null}

      {report?.error ? (
        <Card className="border-warning/40 flex flex-wrap items-center justify-between gap-3 p-4">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="text-warning-fg mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-col gap-0.5">
              <p className="text-foreground text-[0.8125rem]">{t('hub.sourceFailed')}</p>
              <p className="text-muted font-mono text-[0.75rem] break-words">{report.error}</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void page.refetch()}>
            {t('common.retry')}
          </Button>
        </Card>
      ) : null}

      {report && report.problems.length > 0 ? (
        <AnimatedList
          as="ul"
          grouped={false}
          className="text-muted flex flex-col gap-1 text-[0.75rem]"
        >
          {report.problems.map((problem, index) => (
            <div key={index} className="flex items-start gap-2">
              <FileText className="text-faint mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>{problem}</span>
            </div>
          ))}
        </AnimatedList>
      ) : null}

      {page.isPending ? <SkeletonList rows={3} /> : null}

      {page.error && entries.length === 0 ? (
        <ErrorState error={page.error} onRetry={() => void page.refetch()} />
      ) : null}

      {!page.isPending && !page.error && entries.length === 0 && !report?.error ? (
        <EmptyState
          title={query.trim().length > 0 ? t('hub.noResults', { query }) : t('hub.sourceEmpty')}
          hint={query.trim().length > 0 ? undefined : (source.description ?? undefined)}
        />
      ) : null}

      {entries.length > 0 ? (
        <AnimatedList>
          {entries.map((entry) => (
            <HubEntryCard
              key={entry.id}
              entry={entry}
              source={source}
              onView={onView}
              onInstall={onInstall}
              onRefresh={onRefresh}
              refreshing={refreshingId === entry.id}
            />
          ))}
        </AnimatedList>
      ) : null}

      {page.hasNextPage ? (
        <div className="flex items-center justify-center gap-3">
          <Button
            variant="secondary"
            size="sm"
            loading={page.isFetchingNextPage}
            onClick={() => void page.fetchNextPage()}
          >
            {t('hub.loadMore')}
          </Button>
          {isKnownNumber(report?.total) ? (
            <span className="text-faint text-[0.75rem] tabular-nums">
              {t('hub.loadedOf', { loaded: entries.length, total: report.total })}
            </span>
          ) : null}
        </div>
      ) : null}
    </section>
  )
}
