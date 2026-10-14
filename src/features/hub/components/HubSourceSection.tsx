import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  FileText,
  Star,
  Trophy,
} from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import { cn } from '@/shared/lib/cn'
import { formatCount, isKnownNumber } from '@/shared/lib/format'
import { useSessionState } from '@/shared/lib/sessionState'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Progress } from '@/shared/ui/Progress'
import { Spinner } from '@/shared/ui/Primitives'
import { Reveal } from '@/shared/ui/Reveal'
import { SectionHeader } from '@/shared/ui/SectionHeader'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useBrowser } from '@/features/browser/context'
import { proxiedImage } from '@/features/browser/lib/images'

import { matchesInstalled, type InstalledFilter } from '../installed'
import { fetchGroupSkills } from '../lib/fetchGroup'
import { groupHubEntries, isBatchable } from '../lib/grouping'
import { starTint } from '../lib/starTint'
import { HubBatchActions } from './HubBatchActions'
import { HubEntryList } from './HubEntryList'
import { HubEntrySkeletons } from './HubSkeletons'
import { HubGroupBlock } from './HubGroupBlock'
import { HubSourceContextMenu } from './HubSourceContextMenu'

/** Entries asked for per request. The MCP registry is slowest with a *small* page, not a large one. */
export const PAGE_SIZE = 16

/**
 * One source of the hub: its own heading, its own paging, and its own answer.
 *
 * Each section owns one request chain, so a collection that is slow, down or refuses is a note
 * under its own heading — it never holds back, or empties, the other collections. The search text
 * and the kind filter are part of the query key, so retyping the search resets every section to
 * its first page at once.
 *
 * Skills that name a plugin group (`HubEntry.group`) are shown under that group's heading with
 * select-all / install-all; everything else stays a flat list below. The section itself folds the
 * same way a group does — heading and batch actions stay, the list goes — and it *starts* folded,
 * so the Hub opens as the list of collections it can read; the ones the user opens are remembered
 * for the session (`useSessionState`, `hub.sourceExpanded.<id>`). A folded section still reads its
 * first page: the collection's answer is what its heading counts.
 *
 * The section *is* the card: one bordered surface per source, held by the page's own card run
 * (`AnimatedList`), so the sources sit `--group-gap` apart with the full radius only at the ends of
 * the stack — the Hub opens as one block of collections, the way the Settings index wears its
 * areas. Its strip carries the fold control, the name and the batch actions, and the fold paints it
 * the way a Library group head is painted: a plain card while folded, the tinted caption band with
 * its collection below it while open.
 *
 * A collection is read a page at a time and can be long, so what a section *renders* is capped
 * twice over: a page of entries is revealed in batches as the user scrolls (`useLazyRows`), and the
 * rows themselves are only re-rendered when their own data changes (`memo` below, which is why the
 * callbacks of this section have to be stable — a new function per render would animate every card
 * again on every keystroke).
 */
export const HubSourceSection = memo(function HubSourceSection({
  source,
  rank,
  kind,
  installed,
  query,
  tags,
  generation,
  selectedIds,
  onView,
  onInstall,
  onRefresh,
  onToggleSelect,
  onSelectEntries,
  onDeselectEntries,
  onBatchInstall,
  refreshingId,
}: {
  source: HubSource
  /**
   * Where the collection stands among the most starred ones — `1` to `3` for the top three, and
   * nothing for everyone else. The Hub is its own leaderboard: the rank says what GitHub reports
   * for the repository, not where the card happens to sit once a filter narrowed the list.
   */
  rank?: number
  kind: HubResourceKind | null
  /** Whether an entry the machine already holds is shown; applied to the entries in hand. */
  installed: InstalledFilter
  query: string
  /** Tags the toolbar filters by; the backend applies them before the page is cut. */
  tags: string[]
  /** Bumped when the user refreshes: the first page of a new generation ignores the backend cache. */
  generation: number
  selectedIds: ReadonlySet<string>
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  onToggleSelect: (entry: HubEntry) => void
  onSelectEntries: (entries: HubEntry[]) => void
  onDeselectEntries: (entries: HubEntry[]) => void
  onBatchInstall: (entries: HubEntry[], groupId?: string) => void
  /** The entry whose collection is being re-read right now, if any. */
  refreshingId?: string | null
}) {
  const { t, i18n } = useTranslation()
  const browser = useBrowser()
  const [opened, setOpened] = useSessionState(`hub.sourceExpanded.${source.id}`, false)
  const collapsed = !opened
  const [loadingGroup, setLoadingGroup] = useState<string | null>(null)
  const [loadingVisible, setLoadingVisible] = useState(false)
  const toggleLabel = collapsed
    ? t('hub.expandSource', { name: source.name })
    : t('hub.collapseSource', { name: source.name })
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

  // Everything below is derived from the answer in hand, and re-derived only when that answer, the
  // filters or the selection actually changed — a card that re-renders is a card that was measured.
  const entries = useMemo(
    () => page.data?.pages.flatMap((loaded) => loaded.entries) ?? [],
    [page.data],
  )
  // The installed filter is the scan's answer, applied to the entries in hand: a collection is
  // read a page at a time and the backend does not know what this machine holds, so narrowing the
  // list is this section's own job while Load more keeps reading the rest of the source.
  const shown = useMemo(
    () => entries.filter((entry) => matchesInstalled(entry, installed)),
    [entries, installed],
  )
  const { groups, ungrouped } = useMemo(() => groupHubEntries(shown), [shown])
  const visibleSkills = useMemo(() => shown.filter(isBatchable), [shown])
  const report = page.data?.pages.at(-1)?.report
  // How much of the collection the section has actually read that this machine already holds.
  // Measured against the entries in hand, never the source's own total: a collection is paged in,
  // the backend does not know what is on disk, and an unseen entry is not a missing one.
  const installedCount = useMemo(
    () => entries.filter((entry) => entry.installed.length > 0).length,
    [entries],
  )
  const link = source.homepage ?? source.docs
  const visibleSelected = visibleSkills.filter((entry) => selectedIds.has(entry.id)).length
  const visibleAllSelected = visibleSkills.length > 0 && visibleSelected >= visibleSkills.length
  // The section's own actions sit on the heading whether or not the page holds plugin groups: a
  // group offers "install all" for itself, and the collection must still be takeable whole from the
  // top — the two are different sets, not duplicates. It installs what the section has read, the
  // accent button is the same "download all" the flat list has always had.
  const showSectionActions = visibleSkills.length > 0

  const installGroup = useCallback(
    async (groupId: string) => {
      setLoadingGroup(groupId)
      try {
        const all = await fetchGroupSkills(source.id, groupId)
        const batchable = all.filter(isBatchable)
        if (batchable.length === 0) {
          onBatchInstall([], groupId)
          return
        }
        onBatchInstall(batchable, groupId)
      } catch (error) {
        toastAppError(error)
      } finally {
        setLoadingGroup(null)
      }
    },
    [source.id, onBatchInstall],
  )

  const installVisible = useCallback(() => {
    setLoadingVisible(true)
    try {
      onBatchInstall(visibleSkills)
    } finally {
      setLoadingVisible(false)
    }
  }, [onBatchInstall, visibleSkills])

  return (
    <section
      className={cn(
        'ease-warm bg-surface flex min-w-0 flex-col overflow-hidden border transition-[border-color,translate] duration-150',
        // The most starred collections wear the accent: a full edge for the leader, a quieter one
        // for the two behind it — a podium at the top of the list, without shouting over the rest.
        rank === 1 ? 'border-accent/40' : rank === undefined ? 'border-border' : 'border-accent/20',
        collapsed && 'hover:border-border-strong hover:-translate-y-px',
      )}
    >
      {/* The card's strip: the tinted caption band while the collection is open, the card itself
          while it is folded. One card per source, and the page's run welds them — the Hub opens as
          a single stack of collections, the way the Settings index wears its areas. */}
      <HubSourceContextMenu
        source={source}
        collapsed={collapsed}
        link={link ?? null}
        selectable={visibleSkills.length}
        allSelected={visibleAllSelected}
        installingAll={loadingVisible}
        onToggleCollapsed={() => setOpened((value) => !value)}
        onSelectAll={() => onSelectEntries(visibleSkills)}
        onDeselectAll={() => onDeselectEntries(visibleSkills)}
        onInstallAll={installVisible}
      >
        <div
          className={cn(
            'ease-warm flex min-w-0 flex-col gap-2 px-3 py-2.5 transition-colors duration-150',
            !collapsed && (rank === 1 ? 'bg-accent-soft' : 'bg-surface-2'),
          )}
        >
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-1">
              <Tooltip content={toggleLabel}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="shrink-0"
                  aria-expanded={!collapsed}
                  aria-label={toggleLabel}
                  onClick={() => setOpened((value) => !value)}
                >
                  {collapsed ? (
                    <ChevronRight className="size-3.5" aria-hidden />
                  ) : (
                    <ChevronDown className="size-3.5" aria-hidden />
                  )}
                </Button>
              </Tooltip>
              <button
                type="button"
                className="focus-visible:outline-ring flex min-w-0 flex-1 items-center rounded-lg px-1 py-0.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
                aria-expanded={!collapsed}
                onClick={() => setOpened((value) => !value)}
              >
                <SectionHeader
                  leading={<SourceAvatar source={source} />}
                  title={source.name}
                  count={report?.total ?? (entries.length > 0 ? entries.length : undefined)}
                >
                  {rank === undefined ? null : <SourceRank rank={rank} />}
                  {source.builtin ? null : <Badge tone="accent">{t('hub.yourSource')}</Badge>}
                  {isKnownNumber(source.stars) ? (
                    // The chip is gold in proportion to the count (`.ah-stars`), so the Hub's most
                    // popular collections say so before the number is read.
                    <span
                      className="ah-stars inline-flex items-center gap-1 text-[0.75rem] tabular-nums"
                      style={starTint(source.stars)}
                    >
                      <Star className="size-3.5" aria-hidden />
                      <span className="sr-only">{t('hub.starsHint')}</span>
                      {formatCount(source.stars, i18n.language)}
                    </span>
                  ) : null}
                  {/* A source read again — for a filter that moved, for an install, or because the user
                  asked — says so here, so a collection that is slow is never mistaken for an empty
                  one. The skeletons below cover the first read of it. */}
                  {page.isFetching && !page.isPending ? (
                    <span className="text-faint inline-flex items-center gap-1.5 text-[0.75rem]">
                      <Spinner className="size-3" aria-hidden />
                      {t('hub.reading')}
                    </span>
                  ) : null}
                  {report && !report.fromCache ? (
                    <span className="text-faint text-[0.75rem]">{report.durationMs} ms</span>
                  ) : null}
                </SectionHeader>
              </button>
              {link ? (
                <Tooltip content={t('hub.openSource')}>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0"
                    aria-label={t('hub.openSource')}
                    onClick={() => browser.open(link)}
                  >
                    <ExternalLink className="size-3.5" />
                  </Button>
                </Tooltip>
              ) : null}
            </div>

            {showSectionActions ? (
              <HubBatchActions
                selectable={visibleSkills.length}
                selectedCount={visibleSelected}
                installingAll={loadingVisible}
                onSelectAll={() =>
                  visibleAllSelected
                    ? onDeselectEntries(visibleSkills)
                    : onSelectEntries(visibleSkills)
                }
                onInstallAll={installVisible}
              />
            ) : null}
          </div>
          <SourceFacts source={source} read={entries.length} installed={installedCount} />
        </div>
      </HubSourceContextMenu>

      <Reveal open={!collapsed}>
        {/* The body keeps the page's own canvas, so the entries inside look exactly as they do
            anywhere else — the card is the frame around them, and its strip the band above. */}
        <div className="border-border bg-background flex flex-col gap-3 border-t px-3 pt-3 pb-3">
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

          {page.isPending ? <HubEntrySkeletons rows={3} /> : null}

          {page.error && entries.length === 0 ? (
            <ErrorState error={page.error} onRetry={() => void page.refetch()} />
          ) : null}

          {!page.isPending && !page.error && entries.length === 0 && !report?.error ? (
            <EmptyState
              title={query.trim().length > 0 ? t('hub.noResults', { query }) : t('hub.sourceEmpty')}
              hint={query.trim().length > 0 ? undefined : (source.description ?? undefined)}
            />
          ) : null}

          {/* Entries were read, the filter just hid them all — said plainly, and pointing at the
              rest of the collection when there is more of it to read. */}
          {!page.isPending && !page.error && entries.length > 0 && shown.length === 0 ? (
            <EmptyState
              title={t('hub.filteredEmpty')}
              hint={page.hasNextPage ? t('hub.filteredEmptyHint') : undefined}
            />
          ) : null}

          {groups.length > 0 ? (
            /* The groups are one card run of their own — welded `--group-gap` apart, exactly as the
               sources are in the page's run, so a collection reads the same way at every level. */
            <div className="ah-card-stack">
              {groups.map((group) => (
                <HubGroupBlock
                  key={group.id}
                  source={source}
                  group={group}
                  selectedIds={selectedIds}
                  loadingInstall={loadingGroup === group.id}
                  onView={onView}
                  onInstall={onInstall}
                  onRefresh={onRefresh}
                  onToggleSelect={onToggleSelect}
                  onSelectEntries={onSelectEntries}
                  onDeselectEntries={onDeselectEntries}
                  onInstallAll={installGroup}
                  refreshingId={refreshingId}
                />
              ))}
            </div>
          ) : null}

          {ungrouped.length > 0 ? (
            <div className="flex flex-col gap-2">
              {groups.length > 0 ? (
                <p className="text-faint text-[0.75rem] font-medium tracking-wide uppercase">
                  {t('hub.ungrouped')}
                </p>
              ) : null}
              <HubEntryList
                entries={ungrouped}
                source={source}
                selectedIds={selectedIds}
                refreshingId={refreshingId}
                onView={onView}
                onInstall={onInstall}
                onRefresh={onRefresh}
                onToggleSelect={onToggleSelect}
              />
            </div>
          ) : null}

          {/* Reading the next page is shown as the list growing; the button that asks for it stays
              the only way to ask. */}
          {page.isFetchingNextPage ? (
            <HubEntrySkeletons rows={2} />
          ) : page.hasNextPage ? (
            <div className="flex items-center justify-center gap-3">
              <Button variant="secondary" size="sm" onClick={() => void page.fetchNextPage()}>
                {t('hub.loadMore')}
              </Button>
              {isKnownNumber(report?.total) ? (
                <span className="text-faint text-[0.75rem] tabular-nums">
                  {t('hub.loadedOf', { loaded: entries.length, total: report.total })}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      </Reveal>
    </section>
  )
})

/**
 * The facts a source card carries below its heading: what the collection offers, who publishes it,
 * and how much of it this machine already holds.
 *
 * The progress is measured against the entries the section has read, never the collection's own
 * total — a source is paged in, and the backend does not know what is on disk — so it reads "N of M
 * read" and grows as `Load more` reads on. A source with nothing read yet shows no bar, because a
 * percentage of nothing is not a fact.
 */
const SourceFacts = memo(function SourceFacts({
  source,
  read,
  installed,
}: {
  source: HubSource
  /** Entries the section has read so far. */
  read: number
  /** How many of them this machine already holds. */
  installed: number
}) {
  const { t } = useTranslation()
  const percent = read > 0 ? Math.round((installed / read) * 100) : 0

  return (
    <div className="flex min-w-0 flex-col gap-2">
      {source.description ? (
        <p className="text-muted max-w-3xl text-[0.8125rem]">{source.description}</p>
      ) : null}
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          {source.provides.map((kind) => (
            <Badge key={kind} tone="neutral">
              {t(`hub.kind.${kind}`)}
            </Badge>
          ))}
          <Badge tone="outline">{t(`hub.sourceKind.${source.kind}`)}</Badge>
          {source.vendor ? (
            <span className="text-muted text-[0.75rem]">{source.vendor}</span>
          ) : null}
          {source.license ? (
            <span className="text-faint text-[0.75rem]">{source.license}</span>
          ) : null}
          {source.repository ? (
            <span className="text-faint font-mono text-[0.75rem]">{source.repository}</span>
          ) : null}
        </div>
        {read > 0 ? (
          <div className="flex w-full min-w-0 flex-col gap-1 sm:w-44 sm:shrink-0">
            <div className="flex items-center justify-between gap-2 text-[0.75rem]">
              <span className="text-muted">{t('hub.installedOfRead', { installed, read })}</span>
              <span className="text-faint tabular-nums">{percent}%</span>
            </div>
            <Progress value={percent} label={t('hub.progressLabel')} />
          </div>
        ) : null}
      </div>
    </div>
  )
})

/**
 * Where a collection stands among the most starred ones — the Hub's own leaderboard.
 *
 * Its place comes from what GitHub reports for the source's repository, so a screen narrowed by a
 * filter still names the three most starred collections of the whole Hub.
 */
function SourceRank({ rank }: { rank: number }) {
  const { t } = useTranslation()
  const label = t('hub.topRank', { rank })
  return (
    <Tooltip content={label}>
      <span
        role="img"
        aria-label={label}
        className={cn(
          'inline-flex shrink-0 items-center gap-0.5 rounded-full py-0.5 pr-1.5 pl-1 text-[0.6875rem] font-semibold tabular-nums',
          rank === 1 ? 'bg-accent text-accent-foreground' : 'bg-accent/15 text-accent-strong',
        )}
      >
        <Trophy className="size-3" aria-hidden />
        {rank}
      </span>
    </Tooltip>
  )
}

/**
 * The picture of the account that publishes a collection.
 *
 * GitHub keeps an avatar for a repository's owner, and the Hub reads its address together with the
 * star count; the bytes come back through the reader's image proxy, because the window's CSP lets
 * it load nothing but `data:` URLs. A source that is not on GitHub, or whose avatar cannot be
 * read, keeps the monogram tile the rest of the app shows.
 */
const SourceAvatar = memo(function SourceAvatar({ source }: { source: HubSource }) {
  const [resolved, setResolved] = useState<{ url: string; image: string | null } | null>(null)
  const url = source.avatar ?? null
  // The picture is kept with the URL it was read for, so a section whose source changed — or whose
  // avatar arrived — paints the new one without a state reset inside the effect.
  const image = resolved && resolved.url === url ? resolved.image : null

  useEffect(() => {
    if (!url) return
    // The fetch itself is cached and shared per URL (`proxiedImage`), so re-mounting a section —
    // or showing the same owner under two sources — costs no second request.
    let attached = true
    void proxiedImage(url).then((dataUrl) => {
      if (attached) setResolved({ url, image: dataUrl })
    })
    return () => {
      attached = false
    }
  }, [url])

  return <AgentIcon name={source.name} image={image} size="sm" />
})
