import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useInfiniteQuery } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import { isKnownNumber } from '@/shared/lib/format'
import { useSessionState } from '@/shared/lib/sessionState'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import {
  FilterBar,
  FilterChipGroup,
  FilterClear,
  FilterRow,
  FilterSearch,
} from '@/shared/ui/FilterBar'
import { Select } from '@/shared/ui/Select'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRefreshHubEntry } from '../api/hooks'
import { useHubSources } from '../api/queries'
import { matchesInstalled, type InstalledFilter } from '../installed'
import { isBatchable } from '../lib/grouping'
import { PAGE_SIZE, useSettledSearch } from '../lib/search'
import { HubBatchActions } from './HubBatchActions'
import { HubBatchInstallDialog } from './HubBatchInstallDialog'
import { HubEntryDialog } from './HubEntryDialog'
import { HubEntryList } from './HubEntryList'
import { HubEntrySkeletons } from './HubSkeletons'
import { HubInstallDialog } from './HubInstallDialog'

/**
 * Install one entry of a collection without leaving the owner's own page.
 *
 * The Hub screen is where collections are *browsed*: a section per source, ranks, plugin groups,
 * batch installs. An agent's own tab only needs to answer "what of this kind exists, and gets it
 * into this agent" — so this dialog reads one collection at a time (the backend searches one
 * source per request, and a picker is honest about that), searches it, and hands the entry to the
 * very same review the Hub uses. The owner is the page's own, so the review offers no choice of
 * one: `HubInstallDialog` is given it and shows it as a fact.
 *
 * Nothing here is a second install path: the write is `install_hub_resource` through the owner's
 * adapter, with the same preview, confirmation and path checks as any other install.
 *
 * Several skills can be taken together — the ticks, the batch review and the one-confirmation loop
 * the Hub's own lists use — while a server stays a one-at-a-time review, because installing it asks
 * for the launch recipe and the values it needs.
 */
export function HubQuickInstallDialog({
  kind,
  owner,
  onClose,
}: {
  kind: HubResourceKind
  owner: AgentRef
  onClose: () => void
}) {
  const { t } = useTranslation()
  const catalog = useHubSources()
  // Only the collections that carry this kind are read — the registry is not asked for skills, and
  // a repository of skills is not read for servers.
  const sources = useMemo(
    () => (catalog.data?.sources ?? []).filter((source) => source.provides.includes(kind)),
    [catalog.data, kind],
  )
  // The collection, the text and the held-state filter are kept for the session like every other
  // filter: the next agent's page opens this dialog where the last one left it.
  const [sourceId, setSourceId] = useSessionState(`hub.quick.${kind}.source`, '')
  const [query, setQuery] = useSessionState(`hub.quick.${kind}.query`, '')
  const [installed, setInstalled] = useSessionState<InstalledFilter>(
    `hub.quick.${kind}.installed`,
    'all',
  )
  const settled = useSettledSearch(query)
  // One entry being read, one being installed, and one set of skills taken together: the preview
  // is a place to look, the review a place to decide, and the batch is the same review for several.
  const [viewEntry, setViewEntry] = useState<HubEntry | null>(null)
  const [installEntry, setInstallEntry] = useState<HubEntry | null>(null)
  const [selection, setSelection] = useState<Map<string, HubEntry>>(() => new Map())
  const [batch, setBatch] = useState<HubEntry[] | null>(null)

  // A remembered collection this machine no longer offers (its source file was removed) falls back
  // to the first one that does carry the kind.
  const current = sources.find((source) => source.id === sourceId) ?? sources[0] ?? null
  const currentId = current?.id ?? ''

  const page = useInfiniteQuery({
    // The same shape the Hub's own section asks with, so the two screens share one cached answer
    // for a collection they both read.
    queryKey: queryKeys.hubSource(currentId, kind, settled, PAGE_SIZE, 0, []),
    queryFn: ({ pageParam }) =>
      ipc.searchHub(currentId, {
        query: settled,
        kind,
        tags: [],
        cursor: pageParam,
        limit: PAGE_SIZE,
        // Opening the dialog is a fresh look at a collection, never a demand to ignore the
        // backend's ten-minute cache.
        refresh: false,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.report.nextCursor ?? undefined,
    staleTime: 10 * 60_000,
    enabled: current !== null,
  })

  const entries = useMemo(
    () => page.data?.pages.flatMap((loaded) => loaded.entries) ?? [],
    [page.data],
  )
  // Whether this machine already holds an entry is the scan's answer, applied to the entries in
  // hand — a collection is read a page at a time and the backend does not know what is on disk.
  const shown = useMemo(
    () => entries.filter((entry) => matchesInstalled(entry, installed)),
    [entries, installed],
  )
  const report = page.data?.pages.at(-1)?.report

  const readAgain = useRefreshHubEntry()
  const { mutate: readEntry } = readAgain
  const readEntryAgain = useCallback(
    (entry: HubEntry) => {
      readEntry(entry.id, {
        onSuccess: () => toast.success(t('hub.refreshed', { name: entry.name })),
        onError: (error) => toastAppError(error),
      })
    },
    [readEntry, t],
  )
  const readingId = readAgain.isPending ? (readAgain.variables ?? null) : null

  const openInstall = useCallback((entry: HubEntry) => {
    setViewEntry(null)
    setInstallEntry(entry)
  }, [])

  // Skills that can be taken together: a server carries a launch recipe and the values it needs,
  // so it stays a one-at-a-time review — the Hub's own rule.
  const skills = useMemo(() => shown.filter(isBatchable), [shown])
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection])
  const visibleSelected = skills.filter((entry) => selectedIds.has(entry.id)).length
  const allVisibleSelected = skills.length > 0 && visibleSelected >= skills.length

  const toggleSelect = useCallback((entry: HubEntry) => {
    if (!isBatchable(entry)) return
    setSelection((current) => {
      const next = new Map(current)
      if (next.has(entry.id)) next.delete(entry.id)
      else next.set(entry.id, entry)
      return next
    })
  }, [])

  const toggleAll = useCallback(() => {
    setSelection((current) => {
      const next = new Map(current)
      for (const entry of skills) {
        if (allVisibleSelected) next.delete(entry.id)
        else next.set(entry.id, entry)
      }
      return next
    })
  }, [skills, allVisibleSelected])

  // What the batch takes: the ticks when there are any, and the whole list on screen when there are
  // none — which is what the button's own label says it will do.
  const openBatch = useCallback(() => {
    const chosen = selection.size > 0 ? [...selection.values()] : skills
    if (chosen.length === 0) return
    setBatch(chosen)
  }, [selection, skills])

  const clearFilters = useCallback(() => {
    setQuery('')
    setInstalled('all')
  }, [setQuery, setInstalled])
  const dirty = query.trim().length > 0 || installed !== 'all'

  const installedOptions: { value: InstalledFilter; label: string }[] = [
    { value: 'all', label: t('common.all') },
    { value: 'installed', label: t('hub.installedState.installed') },
    { value: 'missing', label: t('hub.installedState.missing') },
  ]

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(760px,94vw)]">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-2">
            {t(`hub.quickTitle.${kind}`)}
            <Badge tone={kind === 'skill' ? 'accent' : 'info'}>{t(`hub.kind.${kind}`)}</Badge>
          </DialogTitle>
          <DialogDescription>{t('hub.quickBody', { owner: owner.name })}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {catalog.isPending ? (
            <HubEntrySkeletons rows={3} />
          ) : catalog.error && !catalog.data ? (
            <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
          ) : current === null ? (
            <EmptyState title={t('hub.noSources')} hint={t('hub.noSourcesHint')} />
          ) : (
            <>
              <FilterBar>
                <FilterRow>
                  <FilterSearch
                    value={query}
                    onValueChange={setQuery}
                    placeholder={t('hub.searchPlaceholder')}
                  />
                  {/* A collection is chosen, not guessed — but a single one is not a control. */}
                  {sources.length > 1 ? (
                    <Select
                      ariaLabel={t('hub.source')}
                      className="max-w-64 min-w-40"
                      value={current.id}
                      onValueChange={setSourceId}
                      options={sources.map((source) => ({
                        value: source.id,
                        label: source.name,
                      }))}
                    />
                  ) : (
                    <span className="text-muted text-[0.8125rem]">{current.name}</span>
                  )}
                  {dirty ? <FilterClear onClick={clearFilters} /> : null}
                </FilterRow>

                <FilterRow>
                  <FilterChipGroup label={t('hub.installedFilter')}>
                    {installedOptions.map((option) => (
                      <Chip
                        key={option.value}
                        label={option.label}
                        active={installed === option.value}
                        onClick={() => setInstalled(option.value)}
                      />
                    ))}
                  </FilterChipGroup>
                </FilterRow>

                {/* Taking several at once, for the skills on screen: the same pair of controls the
                    Hub's own lists carry, and nothing at all where there is no skill to batch. */}
                <FilterRow>
                  <HubBatchActions
                    selectable={skills.length}
                    selectedCount={visibleSelected}
                    onSelectAll={toggleAll}
                    onInstallAll={openBatch}
                    installLabel={
                      selection.size > 0
                        ? t('hub.batchInstall', { count: selection.size })
                        : undefined
                    }
                  />
                </FilterRow>
              </FilterBar>

              {page.isPending ? (
                <HubEntrySkeletons rows={3} />
              ) : page.error ? (
                <ErrorState error={page.error} onRetry={() => void page.refetch()} />
              ) : shown.length === 0 ? (
                entries.length === 0 ? (
                  <EmptyState
                    title={
                      settled.length > 0
                        ? t('hub.noResults', { query: settled })
                        : t('hub.sourceEmpty')
                    }
                    hint={settled.length > 0 ? undefined : (current.description ?? undefined)}
                  />
                ) : (
                  /* Entries were read, the filter just hid them all — pointing at the rest of the
                     collection when there is more of it to read. */
                  <EmptyState
                    title={t('hub.filteredEmpty')}
                    hint={page.hasNextPage ? t('hub.filteredEmptyHint') : undefined}
                  />
                )
              ) : (
                <HubEntryList
                  entries={shown}
                  source={current}
                  selectedIds={selectedIds}
                  refreshingId={readingId}
                  onView={setViewEntry}
                  onInstall={openInstall}
                  onRefresh={readEntryAgain}
                  onToggleSelect={toggleSelect}
                />
              )}

              {/* Reading the next page is shown as the list growing; the button stays the only way
                  to ask for it. */}
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
            </>
          )}
        </DialogBody>
      </DialogContent>

      {viewEntry ? (
        <HubEntryDialog
          key={viewEntry.id}
          entryId={viewEntry.id}
          onClose={() => setViewEntry(null)}
          onInstall={openInstall}
          onRefresh={readEntryAgain}
          refreshing={readingId === viewEntry.id}
        />
      ) : null}

      {installEntry ? (
        <HubInstallDialog
          key={installEntry.id}
          entryId={installEntry.id}
          owner={owner}
          onClose={() => setInstallEntry(null)}
        />
      ) : null}

      {batch ? (
        <HubBatchInstallDialog
          key={batch.map((entry) => entry.id).join('|')}
          entries={batch}
          owner={owner}
          onClose={() => {
            setBatch(null)
            setSelection(new Map())
          }}
        />
      ) : null}
    </Dialog>
  )
}
