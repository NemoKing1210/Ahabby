import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Store } from 'lucide-react'

import { queryKeys } from '@/shared/api/keys'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import { isKnownNumber } from '@/shared/lib/format'
import { useSessionState } from '@/shared/lib/sessionState'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { CatalogProblems } from '@/shared/ui/CatalogProblems'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PathRow } from '@/shared/ui/PathRow'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRefreshHubEntry } from '../api/hooks'
import { useHubSources } from '../api/queries'
import { HubBatchInstallDialog } from '../components/HubBatchInstallDialog'
import { HubEntryDialog } from '../components/HubEntryDialog'
import { HubInstallDialog } from '../components/HubInstallDialog'
import { HubRecommendations } from '../components/HubRecommendations'
import { HubSelectionBar } from '../components/HubSelectionBar'
import { HubCatalogSkeleton } from '../components/HubSkeletons'
import { HubSourceSection } from '../components/HubSourceSection'
import { HubToolbar } from '../components/HubToolbar'
import type { InstalledFilter } from '../installed'
import { isBatchable } from '../lib/grouping'
import type { RecommendationRoleId } from '../recommendations/catalog'

type HubTab = 'catalog' | 'recommendations'

/** How long typing settles before the sources are asked again. */
const SEARCH_DEBOUNCE_MS = 350

/** How many of the most starred collections the screen names as the top of the Hub. */
const TOP_SOURCES = 3

/**
 * The catalogue before it arrives. One identity, not a new `[]` on every render: the filters the
 * page derives are keyed on it.
 */
const NO_SOURCES: HubSource[] = []

/**
 * The Hub: every collection of skills and MCP servers Ahabby knows how to read, in one screen.
 *
 * Two tabs: the catalogue (one section per source, each with its own request, paging and failure)
 * and Recommendations (role-based shortlists that resolve to the same install dialogs). The page
 * owns the filters, the install dialogs, and the multi-select for batch skill installs, because
 * everything a source *is* belongs to the manifest that declared it (`catalog/HUB.md`).
 *
 * It holds the screen's state and nothing else, and it holds every handler still (`useCallback`,
 * `useMemo`) — the sections and cards below it are memoized, so that is what keeps a page of
 * hundreds of entries answering a keystroke by redrawing the search box alone.
 */
export function HubPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const catalog = useHubSources()

  // The five filters a user sets here are kept for the session (`useSessionState`), so an entry
  // previewed and installed, or a source read again, does not cost the search box its text.
  const [tab, setTab] = useSessionState<HubTab>('hub.tab', 'catalog')
  const [role, setRole] = useSessionState<RecommendationRoleId>('hub.role', 'everyday')
  const [query, setQuery] = useSessionState('hub.query', '')
  // Typing settles before it reaches the network: a source is a real request, not a local list.
  // The settled copy starts from the restored query, so a revisit asks for the filtered first
  // page directly instead of asking twice.
  const [settled, setSettled] = useState(() => query.trim())
  const [kind, setKind] = useSessionState<HubResourceKind | null>('hub.kind', null)
  const [installed, setInstalled] = useSessionState<InstalledFilter>('hub.installed', 'all')
  const [sourceId, setSourceId] = useSessionState('hub.source', 'all')
  // Tags the user filters by. The chips themselves come from the source files: what a collection
  // declares is a subject a user can pick, while a plugin's own name would only be an identity.
  const [tags, setTags] = useSessionState<string[]>('hub.tags', [])
  // One entry being read, one being installed: the preview is a place to look, the install dialog a
  // place to decide, and the second follows the first.
  const [viewEntry, setViewEntry] = useState<HubEntry | null>(null)
  const [installEntry, setInstallEntry] = useState<HubEntry | null>(null)
  // Several skills reviewed together for one owner — from checkboxes or a group's "install all".
  const [batch, setBatch] = useState<{ entries: HubEntry[]; groupId?: string } | null>(null)
  // Selected skills across sources; keyed by entry id so a re-fetched card can still be toggled.
  const [selection, setSelection] = useState<Map<string, HubEntry>>(() => new Map())
  // Bumped by Refresh: a new generation makes every section ask its first page again, this time
  // telling the backend to ignore the answers it has already cached.
  const [generation, setGeneration] = useState(0)

  // Every callback below is handed to sections and cards that are memoized, so each one has to be
  // stable: a new function per render would tell every card on screen that its props changed, and
  // the whole point of the memoization is that a click on one row repaints one row.
  const toggleTag = useCallback(
    (tag: string) =>
      setTags((current) =>
        current.includes(tag) ? current.filter((kept) => kept !== tag) : [...current, tag],
      ),
    [setTags],
  )

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  // The Refresh action is honest about what it does — a *network* read — so the button reports the
  // state of the requests themselves instead of a timer of its own.
  const busy = useIsFetching({ queryKey: queryKeys.hubSourceAll() }) > 0

  const refresh = useCallback(() => {
    void client.invalidateQueries({ queryKey: queryKeys.hubSources() })
    setGeneration((current) => current + 1)
  }, [client])

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

  const toggleSelect = useCallback((entry: HubEntry) => {
    if (!isBatchable(entry)) return
    setSelection((current) => {
      const next = new Map(current)
      if (next.has(entry.id)) next.delete(entry.id)
      else next.set(entry.id, entry)
      return next
    })
  }, [])

  const selectEntries = useCallback((entries: HubEntry[]) => {
    setSelection((current) => {
      const next = new Map(current)
      for (const entry of entries) {
        if (isBatchable(entry)) next.set(entry.id, entry)
      }
      return next
    })
  }, [])

  const deselectEntries = useCallback((entries: HubEntry[]) => {
    setSelection((current) => {
      const next = new Map(current)
      for (const entry of entries) next.delete(entry.id)
      return next
    })
  }, [])

  const openBatch = useCallback(
    (entries: HubEntry[], groupId?: string) => {
      const batchable = entries.filter(isBatchable)
      if (batchable.length === 0) {
        toast.info(t('hub.batchEmpty'))
        return
      }
      setViewEntry(null)
      setInstallEntry(null)
      setBatch({ entries: batchable, groupId })
    },
    [t],
  )

  const selectedIds = useMemo(() => new Set(selection.keys()), [selection])
  const selectedEntries = useMemo(() => [...selection.values()], [selection])

  const sources = catalog.data?.sources ?? NO_SOURCES

  // The top of the Hub: the backend hands the sources over in popularity order, so the ranking is
  // a walk down the list that steps over a collection whose count was never read (a cold start, a
  // rate limit, a source that is not on GitHub). It is the *whole* Hub being ranked, not the part
  // a filter left on screen: the badge is what GitHub reports, and it never moves with a filter.
  const ranks = useMemo(() => {
    const ranking = new Map<string, number>()
    for (const source of sources) {
      if (!isKnownNumber(source.stars)) continue
      ranking.set(source.id, ranking.size + 1)
      if (ranking.size === TOP_SOURCES) break
    }
    return ranking
  }, [sources])

  // A kind filter also decides which sources are asked at all: the MCP registry is not fetched to
  // show skills, and a repository of skills is not read to show servers. Derived once per filter
  // rather than once per render: this page re-renders on every search keystroke and on every fetch
  // a section starts or finishes, and both lists are what the toolbar and the sections are handed.
  const matching = useMemo(
    () => sources.filter((source) => kind === null || source.provides.includes(kind)),
    [sources, kind],
  )
  const visible = useMemo(
    () => (sourceId === 'all' ? matching : matching.filter((source) => source.id === sourceId)),
    [matching, sourceId],
  )

  // The chips the toolbar offers: the tags the sources in view declare in their own files. A few
  // hundred strings to trim and de-duplicate, which is why it is not done on every render either.
  const vocabulary = useMemo(
    () =>
      uniqueTags(
        visible.flatMap((source) => [
          ...(source.tags ?? []),
          ...(source.tagRules ?? []).flatMap((rule) => rule.tags),
        ]),
      ),
    [visible],
  )

  if (catalog.isPending) return <HubCatalogSkeleton />
  if (catalog.error && !catalog.data) {
    return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
  }
  const data = catalog.data
  if (!data) return null

  return (
    <div className="flex flex-col gap-6" data-tour="hub-toolbar">
      <PageHeader>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">{t('hub.title')}</h1>
          <p className="text-muted text-[0.8125rem]">{t('hub.subtitle')}</p>
        </div>
      </PageHeader>

      <CatalogProblems problems={data.problems} />

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as HubTab)}
        className="flex flex-col"
      >
        <TabsList>
          <TabsTrigger value="catalog">{t('hub.tabs.catalog')}</TabsTrigger>
          <TabsTrigger value="recommendations">{t('hub.tabs.recommendations')}</TabsTrigger>
        </TabsList>

        <TabsContent value="catalog" className="flex flex-col gap-6">
          <HubToolbar
            query={query}
            onQueryChange={setQuery}
            kind={kind}
            onKindChange={(value) => {
              setKind(value)
              setSourceId('all')
            }}
            installed={installed}
            onInstalledChange={setInstalled}
            sourceId={sourceId}
            onSourceChange={setSourceId}
            sources={matching}
            tags={vocabulary}
            selectedTags={tags}
            onToggleTag={toggleTag}
            onRefresh={refresh}
            refreshing={busy}
          />

          {visible.length === 0 ? (
            <EmptyState
              icon={Store}
              title={t('hub.noSources')}
              hint={t('hub.noSourcesHint')}
              action={
                <Button variant="secondary" size="sm" onClick={refresh}>
                  {t('common.refresh')}
                </Button>
              }
            />
          ) : (
            /* One card run, the way the Settings index wears its areas: the sources sit
               `--group-gap` apart and only the ends of the stack keep the full radius, so the page
               reads as one block of collections rather than a paste-up of separate cards. */
            <AnimatedList>
              {visible.map((source) => (
                <HubSourceSection
                  key={source.id}
                  source={source}
                  rank={ranks.get(source.id)}
                  kind={kind}
                  installed={installed}
                  query={settled}
                  tags={tags}
                  generation={generation}
                  selectedIds={selectedIds}
                  onView={setViewEntry}
                  onInstall={openInstall}
                  onRefresh={readEntryAgain}
                  onToggleSelect={toggleSelect}
                  onSelectEntries={selectEntries}
                  onDeselectEntries={deselectEntries}
                  onBatchInstall={openBatch}
                  refreshingId={readingId}
                />
              ))}
            </AnimatedList>
          )}

          <div className="border-border flex flex-col gap-2 border-t pt-4">
            <h2 className="text-[0.8125rem] font-medium">{t('hub.userSources')}</h2>
            <p className="text-muted text-[0.8125rem]">{t('hub.userSourcesHint')}</p>
            <PathRow path={data.userDir} />
          </div>
        </TabsContent>

        <TabsContent value="recommendations">
          <HubRecommendations
            roleId={role}
            onRoleChange={setRole}
            sources={sources}
            onView={setViewEntry}
            onInstall={openInstall}
            onRefresh={readEntryAgain}
            onBatchInstall={openBatch}
            refreshingId={readingId}
            selectedIds={selectedIds}
            onToggleSelect={toggleSelect}
          />
        </TabsContent>
      </Tabs>

      <HubSelectionBar
        count={selection.size}
        onClear={() => setSelection(new Map())}
        onInstall={() => openBatch(selectedEntries)}
      />

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
          onClose={() => setInstallEntry(null)}
        />
      ) : null}

      {batch ? (
        <HubBatchInstallDialog
          key={batch.groupId ?? batch.entries.map((entry) => entry.id).join('|')}
          entries={batch.entries}
          groupId={batch.groupId}
          onClose={() => {
            setBatch(null)
            setSelection(new Map())
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * A tag list with each tag once, keeping the first spelling and the order the sources declared in.
 *
 * Several sources declare the same subject (`development`, `documents`), so the chips are the union
 * of what is in view — and the backend compares tags case-insensitively, which is why the same
 * spelling is the one that survives here too.
 */
function uniqueTags(tags: string[]): string[] {
  const unique: string[] = []
  const known = new Set<string>()
  for (const tag of tags) {
    const trimmed = tag.trim()
    const key = trimmed.toLowerCase()
    if (key === '' || known.has(key)) continue
    known.add(key)
    unique.push(trimmed)
  }
  return unique
}
