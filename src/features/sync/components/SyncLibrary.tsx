import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudUpload, Download, RefreshCw, Search, UploadCloud } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncKind } from '@/shared/bindings/SyncKind'
import type { SyncPullTarget } from '@/shared/bindings/SyncPullTarget'
import { useSessionState } from '@/shared/lib/sessionState'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Chip } from '@/shared/ui/Chip'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/Tabs'
import { Tooltip } from '@/shared/ui/Tooltip'

import { itemRef, SYNC_KINDS } from '../lib/labels'
import {
  ownerFacetMatches,
  ownerRank,
  SYNC_OWNER_FACETS,
  useSyncOwners,
  type SyncOwners,
  type SyncOwnerFacet,
} from '../lib/owners'
import {
  compareOf,
  viewOfLocal,
  viewOfRemote,
  type SyncCompareTarget,
  type SyncViewTarget,
} from '../lib/targets'
import { SyncCompareDialog } from './SyncCompareDialog'
import { SyncContentDialog } from './SyncContentDialog'
import { RemoteItemRow, SyncItemRow } from './SyncRows'
import { SyncItemContextMenu } from './SyncItemContextMenu'
import { SyncOwnerGroup } from './SyncOwnerGroup'
import { SyncPreviewDialog } from './SyncPreviewDialog'
import { SyncRemoteContextMenu } from './SyncRemoteContextMenu'
import {
  useDeleteRemoteSync,
  usePullSync,
  usePushSync,
  useRefreshRemoteSync,
  useRemoteSyncItems,
  useSyncItems,
} from '../api/hooks'

/** A cloud copy plus the local item of the same key, when this machine has one. */
interface RemotePair {
  remote: RemoteItem
  local?: SyncItem
}

/** What a delete is waiting for the user's answer on. */
interface PendingDelete {
  remoteId: string
  name: string
}

/** What a restore-all is waiting for the user's answer on. */
interface PendingRestore {
  ownerName: string
  targets: SyncPullTarget[]
}

/**
 * Group entries by the owner they belong to, in the order the owners are shown.
 *
 * An owner the scan does not know — a copy pushed from a machine whose project was since
 * forgotten — still gets a group, sorted after the known ones by the id the copy carries.
 */
function groupByOwner<T>(
  entries: T[],
  ownerOf: (entry: T) => string,
  owners: SyncOwners,
): [string, T[]][] {
  const groups = new Map<string, T[]>()
  for (const entry of entries) {
    const id = ownerOf(entry)
    const list = groups.get(id)
    if (list) list.push(entry)
    else groups.set(id, [entry])
  }
  return [...groups.entries()].sort((left, right) => {
    const rank = ownerRank(owners.order, left[0]) - ownerRank(owners.order, right[0])
    return rank !== 0 ? rank : left[0].localeCompare(right[0])
  })
}

/** The owner's own reference, or the name the item carries when the scan cannot name it. */
function ownerRefOf(owners: SyncOwners, ownerId: string, name: string): AgentRef {
  return owners.refs.get(ownerId) ?? { id: ownerId, name, icon: null }
}

/**
 * The owner-kind sub-tabs one half of the library has.
 *
 * A kind no owner of that half belongs to is not offered at all: a machine with no projects does
 * not get an empty Projects tab to click into.
 */
function facetsOf(entries: { ownerId: string }[]) {
  return SYNC_OWNER_FACETS.filter(
    (entry) =>
      entry.facet === 'all' || entries.some((item) => ownerFacetMatches(entry.facet, item.ownerId)),
  )
}

/** How many of these entries a sub-tab would show. */
function facetCount(entries: { ownerId: string }[], facet: SyncOwnerFacet): number {
  return entries.filter((item) => ownerFacetMatches(facet, item.ownerId)).length
}

/**
 * The two halves of the cloud library, cut by owner twice over: the main tabs say *where* a copy
 * lives (this machine or the account), the sub-tabs say *whose* it is (agents, projects, the
 * shared surface), and each owner is one foldable group of its own.
 *
 * Every group carries the owner's own tile and name, how much of it is outstanding, and the quick
 * actions that apply to it as a whole — select it, save it, restore it (behind a confirmation that
 * names the owner and how many copies it covers). Every row adds a right-click menu with the
 * actions a row has no room for. The local half is where selecting and saving happens; the cloud
 * half is where a copy is restored, refreshed or deleted.
 *
 * Every filter — the tab, the owner kind, the search box, the item kinds — lives in the session
 * store, so leaving the screen and coming back finds the library as it was left.
 */
export function SyncLibrary({ ownerId = null }: { ownerId?: string | null }) {
  const { t } = useTranslation()
  const [tab, setTab] = useSessionState<'local' | 'remote'>('sync.tab', 'local')
  const [facet, setFacet] = useSessionState<SyncOwnerFacet>('sync.ownerFacet', 'all')
  const [query, setQuery] = useSessionState('sync.query', '')
  const [kinds, setKinds] = useSessionState<SyncKind[]>('sync.kinds', [])
  const owners = useSyncOwners()

  const local = useSyncItems(ownerId)
  const remote = useRemoteSyncItems()
  const push = usePushSync()
  const pull = usePullSync()
  const remove = useDeleteRemoteSync()
  const refreshRemote = useRefreshRemoteSync()

  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [preview, setPreview] = useState<{ remoteId: string; ownerId: string } | null>(null)
  const [viewing, setViewing] = useState<SyncViewTarget | null>(null)
  const [comparing, setComparing] = useState<SyncCompareTarget | null>(null)
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null)
  const [pendingRestore, setPendingRestore] = useState<PendingRestore | null>(null)

  const needle = query.trim().toLowerCase()
  // The search covers the item, its path and the owner it belongs to, so typing an agent's name
  // narrows the whole library to that agent's group.
  const matchesQuery = (item: {
    label: string
    name: string
    ownerName: string
    relativePath: string
  }) =>
    needle.length === 0 ||
    `${item.label} ${item.name} ${item.ownerName} ${item.relativePath}`
      .toLowerCase()
      .includes(needle)
  const matchesKind = (kind: SyncKind) => kinds.length === 0 || kinds.includes(kind)

  const localItems = local.data?.items ?? []
  const remoteItems = remote.data?.items ?? []
  const searchedLocal = localItems.filter(
    (item) => matchesQuery(item) && (ownerId === null || item.ownerId === ownerId),
  )
  const searchedRemote = remoteItems.filter(
    (item) => matchesQuery(item) && (ownerId === null || item.ownerId === ownerId),
  )

  // A sub-tab that half of the library does not have falls back to "all", so switching tabs never
  // lands on an empty list the user cannot explain.
  const localFacets = facetsOf(localItems)
  const remoteFacets = facetsOf(remoteItems)
  const localFacet = localFacets.some((entry) => entry.facet === facet) ? facet : 'all'
  const remoteFacet = remoteFacets.some((entry) => entry.facet === facet) ? facet : 'all'

  const scopedLocal = searchedLocal.filter((item) => ownerFacetMatches(localFacet, item.ownerId))
  const scopedRemote = searchedRemote.filter((item) => ownerFacetMatches(remoteFacet, item.ownerId))
  const visibleLocal = scopedLocal.filter((item) => matchesKind(item.kind))

  // A remote copy is paired with the local item of the same machine-independent key, so a card
  // can say "already here" without a second request.
  const byKey = new Map<string, SyncItem>()
  for (const item of localItems) byKey.set(`${item.ownerId}|${item.key}`, item)
  const visiblePairs: RemotePair[] = scopedRemote
    .filter((item) => matchesKind(item.kind))
    .map((item) => ({ remote: item, local: byKey.get(`${item.ownerId}|${item.key}`) }))

  // A chip counts what the search and the sub-tab left, so the number says how much it would add.
  const countOf = (kind: SyncKind) =>
    (tab === 'local' ? scopedLocal : scopedRemote).filter((item) => item.kind === kind).length

  const localGroups = groupByOwner(visibleLocal, (item) => item.ownerId, owners)
  const remoteGroups = groupByOwner(visiblePairs, (pair) => pair.remote.ownerId, owners)
  const selectedItems = visibleLocal.filter((item) => selected.has(item.id))

  const toggleKind = (kind: SyncKind) =>
    setKinds((current) =>
      current.includes(kind) ? current.filter((entry) => entry !== kind) : [...current, kind],
    )

  const selectAll = (items: SyncItem[]) => {
    const allSelected = items.every((item) => selected.has(item.id))
    setSelected((current) => {
      const next = new Set(current)
      for (const item of items) {
        if (allSelected) next.delete(item.id)
        else next.add(item.id)
      }
      return next
    })
  }

  /** A restore-all always applies to exactly the copies the group is showing. */
  const askRestore = (name: string, pairs: RemotePair[]) =>
    setPendingRestore({
      ownerName: name,
      targets: pairs.map((pair) => ({
        remoteId: pair.remote.remoteId,
        ownerId: pair.remote.ownerId,
      })),
    })

  /** One owner's group of local items, with the actions that apply to the whole group. */
  const localGroup = (id: string, items: SyncItem[]) => {
    const owner = ownerRefOf(owners, id, items[0]?.ownerName ?? id)
    const allSelected = items.every((item) => selected.has(item.id))
    return (
      <SyncOwnerGroup
        key={id}
        owner={owner}
        count={items.length}
        pending={items.filter((item) => item.status !== 'synced').length}
        changed={items.filter((item) => item.status === 'modified').length}
        collapsedKey={`sync.collapsed.local.${id}`}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => selectAll(items)}>
              {allSelected ? t('sync.clearSelection') : t('sync.selectGroup')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              loading={push.isPending}
              onClick={() => push.mutate(items.map(itemRef))}
            >
              <UploadCloud className="size-3.5" aria-hidden />
              {t('sync.saveAll')}
            </Button>
          </>
        }
      >
        {/* The group's list wraps every child in its own `<li>`, so a row is the context menu
            and its row — never a list item of its own. */}
        {items.map((item) => {
          const copy = item.remoteId
          const compare = copy
            ? () => setComparing(compareOf(copy, item.ownerId, owner, item.label))
            : undefined
          return (
            <SyncItemContextMenu
              key={item.id}
              item={item}
              busy={push.isPending}
              onSave={() => push.mutate([itemRef(item)])}
              onView={() => setViewing(viewOfLocal(item, owner))}
              onCompare={compare}
              onDeleteRemote={(remoteId) => setPendingDelete({ remoteId, name: item.label })}
            >
              <SyncItemRow
                item={item}
                selected={selected.has(item.id)}
                onSelect={(checked) =>
                  setSelected((current) => {
                    const next = new Set(current)
                    if (checked) next.add(item.id)
                    else next.delete(item.id)
                    return next
                  })
                }
                busy={push.isPending}
                onSave={() => push.mutate([itemRef(item)])}
                onView={() => setViewing(viewOfLocal(item, owner))}
                onCompare={compare}
              />
            </SyncItemContextMenu>
          )
        })}
      </SyncOwnerGroup>
    )
  }

  /** One owner's group of cloud copies, with restore-all for the whole group. */
  const remoteGroup = (id: string, pairs: RemotePair[]) => {
    const owner = ownerRefOf(owners, id, pairs[0]?.remote.ownerName ?? id)
    const name = owner.name
    const deleting = (remoteId: string) => remove.isPending && pendingDelete?.remoteId === remoteId
    return (
      <SyncOwnerGroup
        key={id}
        owner={owner}
        count={pairs.length}
        collapsedKey={`sync.collapsed.remote.${id}`}
        actions={
          <Button
            variant="secondary"
            size="sm"
            loading={pull.isPending}
            onClick={() => askRestore(name, pairs)}
          >
            <Download className="size-3.5" aria-hidden />
            {t('sync.restoreAll')}
          </Button>
        }
      >
        {pairs.map(({ remote: item, local: match }) => {
          const comparing = match
            ? () => setComparing(compareOf(item.remoteId, id, owner, item.label || item.name))
            : undefined
          const openViewer = () => setViewing(viewOfRemote(item, owner, match?.id ?? null))
          return (
            <SyncRemoteContextMenu
              key={item.remoteId}
              item={item}
              busy={deleting(item.remoteId)}
              onRestore={() => setPreview({ remoteId: item.remoteId, ownerId: id })}
              onDelete={() =>
                setPendingDelete({ remoteId: item.remoteId, name: item.label || item.name })
              }
              onView={openViewer}
              onCompare={comparing}
            >
              <RemoteItemRow
                item={item}
                localName={match?.label}
                busy={deleting(item.remoteId)}
                onPreview={() => setPreview({ remoteId: item.remoteId, ownerId: id })}
                onDelete={() =>
                  setPendingDelete({ remoteId: item.remoteId, name: item.label || item.name })
                }
                onView={openViewer}
                onCompare={comparing}
              />
            </SyncRemoteContextMenu>
          )
        })}
      </SyncOwnerGroup>
    )
  }

  /**
   * The owner-kind sub-tabs of one half, with what each of them holds right now.
   *
   * Secondary on purpose: the half's own tabs are above this row, and a second level that is
   * painted like the first reads as a mistake.
   */
  const facetTabs = (facets: typeof SYNC_OWNER_FACETS, searched: { ownerId: string }[]) => (
    <TabsList variant="secondary">
      {facets.map((entry) => (
        <TabsTrigger key={entry.facet} value={entry.facet}>
          {t(entry.labelKey)}
          <span className="text-faint ml-1.5">{facetCount(searched, entry.facet)}</span>
        </TabsTrigger>
      ))}
    </TabsList>
  )

  /** The item-kind filter: one chip per kind, with how much it would add to the current slice. */
  const kindChips = (
    <div className="flex flex-wrap gap-1.5">
      {SYNC_KINDS.map((kind) => (
        <Chip
          key={kind}
          label={t(`sync.kind.${kind}`)}
          count={countOf(kind)}
          active={kinds.includes(kind)}
          onClick={() => toggleKind(kind)}
        />
      ))}
    </div>
  )

  const localBody = (
    <div className="flex flex-col gap-4">
      <div className="border-border bg-surface flex flex-wrap items-center justify-between gap-2 rounded-xl border px-3 py-2">
        <span className="text-muted text-[0.8125rem]">
          {t('sync.selectedCount', { count: selectedItems.length })}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => selectAll(visibleLocal)}>
            {visibleLocal.every((item) => selected.has(item.id))
              ? t('sync.clearSelection')
              : t('sync.selectAll')}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={selectedItems.length === 0}
            loading={push.isPending}
            onClick={() =>
              push.mutate(selectedItems.map(itemRef), { onSuccess: () => setSelected(new Set()) })
            }
          >
            <UploadCloud className="size-3.5" aria-hidden />
            {t('sync.saveSelected', { count: selectedItems.length })}
          </Button>
        </div>
      </div>

      {localGroups.map(([id, items]) => localGroup(id, items))}
    </div>
  )

  return (
    <>
      <Tabs value={tab} onValueChange={(value) => setTab(value as 'local' | 'remote')}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <TabsList>
            <TabsTrigger value="local">
              {t('sync.tabLocal')}
              {local.data ? (
                <span className="text-faint ml-1.5">{local.data.items.length}</span>
              ) : null}
            </TabsTrigger>
            <TabsTrigger value="remote">
              {t('sync.tabRemote')}
              {remote.data ? (
                <span className="text-faint ml-1.5">{remote.data.items.length}</span>
              ) : null}
            </TabsTrigger>
          </TabsList>

          <div className="flex flex-1 items-center gap-2 sm:max-w-80">
            <label className="relative flex min-w-40 flex-1 items-center">
              <Search
                className="text-faint pointer-events-none absolute left-2.5 size-3.5"
                aria-hidden
              />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('sync.searchPlaceholder')}
                aria-label={t('sync.searchPlaceholder')}
                className="pl-8"
              />
            </label>
            {tab === 'remote' ? (
              <Tooltip content={t('common.refresh')}>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t('common.refresh')}
                  loading={refreshRemote.isPending}
                  onClick={() => refreshRemote.mutate()}
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>

        <TabsContent value="local">
          {local.isPending ? (
            <SkeletonList rows={4} />
          ) : local.error ? (
            <ErrorState error={local.error} onRetry={() => void local.refetch()} />
          ) : localItems.length === 0 ? (
            <EmptyState
              icon={CloudUpload}
              title={t('sync.emptyLocal')}
              hint={t('sync.emptyLocalHint')}
            />
          ) : (
            <Tabs value={localFacet} onValueChange={(value) => setFacet(value as SyncOwnerFacet)}>
              {facetTabs(localFacets, searchedLocal)}
              {localFacets.map((entry) => (
                <TabsContent
                  key={entry.facet}
                  value={entry.facet}
                  className="flex flex-col gap-3 pt-3"
                >
                  {kindChips}
                  {visibleLocal.length === 0 ? (
                    <EmptyState icon={CloudUpload} title={t('sync.emptyFiltered')} />
                  ) : (
                    localBody
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>

        <TabsContent value="remote">
          {remote.isPending ? (
            <SkeletonList rows={4} />
          ) : remote.error ? (
            <ErrorState error={remote.error} onRetry={() => void remote.refetch()} />
          ) : remoteItems.length === 0 ? (
            <EmptyState
              icon={UploadCloud}
              title={t('sync.emptyRemote')}
              hint={t('sync.emptyRemoteHint')}
            />
          ) : (
            <Tabs value={remoteFacet} onValueChange={(value) => setFacet(value as SyncOwnerFacet)}>
              {facetTabs(remoteFacets, searchedRemote)}
              {remoteFacets.map((entry) => (
                <TabsContent
                  key={entry.facet}
                  value={entry.facet}
                  className="flex flex-col gap-3 pt-3"
                >
                  {kindChips}
                  {visiblePairs.length === 0 ? (
                    <EmptyState icon={UploadCloud} title={t('sync.emptyFiltered')} />
                  ) : (
                    <div className="flex flex-col gap-4">
                      {remoteGroups.map(([id, pairs]) => remoteGroup(id, pairs))}
                    </div>
                  )}
                </TabsContent>
              ))}
            </Tabs>
          )}
        </TabsContent>
      </Tabs>

      {local.data && localItems.length > 0 ? (
        <Card className="mt-3 border-dashed p-3">
          <p className="text-faint text-[0.75rem]">
            {t('sync.localSummary', {
              unsynced: local.data.unsynced,
              modified: local.data.modified,
              missing: local.data.missing,
            })}
          </p>
        </Card>
      ) : null}

      {viewing ? (
        <SyncContentDialog
          target={viewing}
          onCompare={
            viewing.remoteId
              ? () => {
                  const { remoteId, ownerId, owner, name } = viewing
                  setViewing(null)
                  if (remoteId) setComparing(compareOf(remoteId, ownerId, owner, name))
                }
              : undefined
          }
          onClose={() => setViewing(null)}
        />
      ) : null}

      {comparing ? (
        <SyncCompareDialog
          remoteId={comparing.remoteId}
          ownerId={comparing.ownerId}
          owner={comparing.owner}
          name={comparing.name}
          onClose={() => setComparing(null)}
        />
      ) : null}

      {preview ? (
        <SyncPreviewDialog
          remoteId={preview.remoteId}
          ownerId={preview.ownerId}
          ownerName={owners.refs.get(preview.ownerId)?.name ?? preview.ownerId}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {pendingRestore ? (
        <ConfirmDialog
          open
          tone="primary"
          onOpenChange={(open) => (open ? undefined : setPendingRestore(null))}
          title={t('sync.restoreAllTitle')}
          description={t('sync.restoreAllHint', {
            count: pendingRestore.targets.length,
            name: pendingRestore.ownerName,
          })}
          confirmLabel={t('sync.restoreAll')}
          busy={pull.isPending}
          onConfirm={() =>
            pull.mutate(
              { targets: pendingRestore.targets, confirm: true },
              { onSuccess: () => setPendingRestore(null) },
            )
          }
        />
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}
          title={t('sync.deleteConfirm')}
          description={t('sync.deleteConfirmHint')}
          confirmLabel={t('sync.delete')}
          busy={remove.isPending}
          onConfirm={() =>
            remove.mutate(
              { remoteId: pendingDelete.remoteId, confirm: true },
              { onSuccess: () => setPendingDelete(null) },
            )
          }
        />
      ) : null}
    </>
  )
}
