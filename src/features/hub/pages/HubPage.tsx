import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsFetching, useQueryClient } from '@tanstack/react-query'
import { Store } from 'lucide-react'

import { queryKeys } from '@/shared/api/keys'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { CatalogProblems } from '@/shared/ui/CatalogProblems'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PathRow } from '@/shared/ui/PathRow'
import { SkeletonList } from '@/shared/ui/Primitives'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRefreshHubEntry } from '../api/hooks'
import { useHubSources } from '../api/queries'
import { HubEntryDialog } from '../components/HubEntryDialog'
import { HubInstallDialog } from '../components/HubInstallDialog'
import { HubSourceSection } from '../components/HubSourceSection'
import { HubToolbar } from '../components/HubToolbar'

/** How long typing settles before the sources are asked again. */
const SEARCH_DEBOUNCE_MS = 350

/**
 * The Hub: every collection of skills and MCP servers Ahabby knows how to read, in one screen.
 *
 * One section per source, each with its own request, its own paging and its own failure — a
 * collection that is slow or down is a note under its own heading, never an empty screen. The
 * page owns only the four filters (search, kind, source, tags) and the install dialog, because
 * everything a source *is* belongs to the manifest that declared it (`catalog/HUB.md`).
 */
export function HubPage() {
  const { t } = useTranslation()
  const client = useQueryClient()
  const catalog = useHubSources()

  const [query, setQuery] = useState('')
  // Typing settles before it reaches the network: a source is a real request, not a local list.
  const [settled, setSettled] = useState('')
  const [kind, setKind] = useState<HubResourceKind | null>(null)
  const [sourceId, setSourceId] = useState('all')
  // Tags the user filters by. The chips themselves come from the source files: what a collection
  // declares is a subject a user can pick, while a plugin's own name would only be an identity.
  const [tags, setTags] = useState<string[]>([])
  // One entry being read, one being installed: the preview is a place to look, the install dialog a
  // place to decide, and the second follows the first.
  const [viewEntry, setViewEntry] = useState<HubEntry | null>(null)
  const [installEntry, setInstallEntry] = useState<HubEntry | null>(null)
  // Bumped by Refresh: a new generation makes every section ask its first page again, this time
  // telling the backend to ignore the answers it has already cached.
  const [generation, setGeneration] = useState(0)

  const toggleTag = (tag: string) =>
    setTags((current) =>
      current.includes(tag) ? current.filter((kept) => kept !== tag) : [...current, tag],
    )

  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(query.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query])

  // The Refresh action is honest about what it does — a *network* read — so the button reports the
  // state of the requests themselves instead of a timer of its own.
  const busy = useIsFetching({ queryKey: ['hub-source'] }) > 0

  const refresh = () => {
    void client.invalidateQueries({ queryKey: queryKeys.hubSources() })
    setGeneration((current) => current + 1)
  }

  const readAgain = useRefreshHubEntry()
  const readEntryAgain = (entry: HubEntry) =>
    readAgain.mutate(entry.id, {
      onSuccess: () => toast.success(t('hub.refreshed', { name: entry.name })),
      onError: (error) => toastAppError(error),
    })
  const readingId = readAgain.isPending ? (readAgain.variables ?? null) : null

  const openInstall = (entry: HubEntry) => {
    setViewEntry(null)
    setInstallEntry(entry)
  }

  if (catalog.isPending) return <SkeletonList rows={5} />
  if (catalog.error && !catalog.data) {
    return <ErrorState error={catalog.error} onRetry={() => void catalog.refetch()} />
  }
  const data = catalog.data
  if (!data) return null

  // A kind filter also decides which sources are asked at all: the MCP registry is not fetched to
  // show skills, and a repository of skills is not read to show servers.
  const matching = data.sources.filter((source) => kind === null || source.provides.includes(kind))
  const visible =
    sourceId === 'all' ? matching : matching.filter((source) => source.id === sourceId)

  // The chips the toolbar offers: the tags the sources in view declare in their own files.
  const declaredTags = visible.flatMap((source) => [
    ...(source.tags ?? []),
    ...(source.tagRules ?? []).flatMap((rule) => rule.tags),
  ])
  const vocabulary = uniqueTags(declaredTags)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader>
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">{t('hub.title')}</h1>
          <p className="text-muted text-[0.8125rem]">{t('hub.subtitle')}</p>
        </div>
      </PageHeader>

      <CatalogProblems problems={data.problems} />

      <HubToolbar
        query={query}
        onQueryChange={setQuery}
        kind={kind}
        onKindChange={(value) => {
          setKind(value)
          setSourceId('all')
        }}
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
        <AnimatedList grouped={false} className="flex flex-col gap-10">
          {visible.map((source) => (
            <HubSourceSection
              key={source.id}
              source={source}
              kind={kind}
              query={settled}
              tags={tags}
              generation={generation}
              onView={setViewEntry}
              onInstall={openInstall}
              onRefresh={readEntryAgain}
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
