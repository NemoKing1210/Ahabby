import { createContext, useContext, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudDownload, CloudUpload, Eye, GitCompare, RefreshCw } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncKind } from '@/shared/bindings/SyncKind'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Tooltip } from '@/shared/ui/Tooltip'

import {
  useDeleteRemoteSync,
  usePullSync,
  usePushSync,
  useRefreshRemoteSync,
  useRemoteSyncItems,
  useSyncItems,
  useSyncStatus,
} from '../api/hooks'
import { itemRef, statusTone } from '../lib/labels'
import {
  compareOf,
  viewOfLocal,
  viewOfRemote,
  type SyncCompareTarget,
  type SyncViewTarget,
} from '../lib/targets'
import { RemoteItemRow } from './SyncRows'
import { SyncCompareDialog } from './SyncCompareDialog'
import { SyncContentDialog } from './SyncContentDialog'
import { SyncPreviewDialog } from './SyncPreviewDialog'
import { SyncRemoteContextMenu } from './SyncRemoteContextMenu'

/**
 * What a card's cloud action and the Overview's cloud card need from one place.
 *
 * The provider is mounted once around an owner's tabs, so the whole page runs one status query,
 * one local-item query and one listing — and owns the one set of dialogs a save or a restore
 * opens, instead of every card carrying its own.
 */
interface CloudActionsValue {
  owner: AgentRef
  /** Cloud sync is on. */
  enabled: boolean
  /** The account is connected — with `enabled`, what a chip needs to talk to the cloud. */
  connected: boolean
  /** Cloud sync is on and the account is connected: a chip has something to talk to. */
  ready: boolean
  /** The syncable items of this owner, as the scan and the state store report them. */
  items: SyncItem[]
  /** The cloud copies this account holds for this owner. */
  copies: RemoteItem[]
  /** The item sitting at an absolute path, when this machine holds one there. */
  itemAt: (path: string) => SyncItem | undefined
  /** Backend-computed state of one owner, for a summary. */
  summary: { unsynced: number; modified: number; missing: number; cloudOnly: number }
  /** Upload one item. */
  save: (item: SyncItem) => void
  /** Upload several at once — the Overview's "save all". */
  saveMany: (items: SyncItem[]) => void
  /** Copies of this owner this machine has no item for, of the given kinds. */
  cloudOnly: (kinds: SyncKind[]) => RemoteItem[]
  /** The reader, on either side of one item. */
  view: (target: SyncViewTarget) => void
  /** The comparison, on one cloud copy. */
  compare: (target: SyncCompareTarget) => void
  /** The restore preview — the only way a copy is ever written back. */
  restore: (remote: RemoteItem) => void
  /** Restore several copies at once, behind one confirmation. */
  restoreMany: (remotes: RemoteItem[]) => void
  /** Remove a cloud copy, behind its confirmation. */
  remove: (remote: RemoteItem) => void
  /** The owner's cloud copies as a list, with their previews — the Overview's "restore". */
  openRestoreList: () => void
  /** Any write or read of a run is in flight. */
  busy: boolean
}

const CloudActionsContext = createContext<CloudActionsValue | null>(null)

/**
 * The owner's cloud surface. `null` outside a provider — a tab rendered somewhere else (a
 * rudimentary test, a future screen) simply shows no cloud action rather than crashing.
 */
export function useCloudActions() {
  return useContext(CloudActionsContext)
}

/** Paths come from the same scan on both sides, but a Windows path and a trailing slash are folded
 * so a card can never fail to find its own item over spelling. */
function pathKey(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
}

export function CloudActionsProvider({
  owner,
  children,
}: {
  owner: AgentRef
  children: ReactNode
}) {
  const { t } = useTranslation()
  const status = useSyncStatus()
  const enabled = Boolean(status.data?.enabled)
  const connected = Boolean(status.data?.connected)
  const ready = enabled && connected

  const local = useSyncItems(owner.id, enabled)
  const remote = useRemoteSyncItems(connected)
  const push = usePushSync()
  const pull = usePullSync()
  const removeRemote = useDeleteRemoteSync()
  const refresh = useRefreshRemoteSync()

  const [viewing, setViewing] = useState<SyncViewTarget | null>(null)
  const [comparing, setComparing] = useState<SyncCompareTarget | null>(null)
  const [preview, setPreview] = useState<RemoteItem | null>(null)
  const [pendingRestore, setPendingRestore] = useState<RemoteItem[] | null>(null)
  const [pendingDelete, setPendingDelete] = useState<RemoteItem | null>(null)
  const [listOpen, setListOpen] = useState(false)

  const items = local.data?.items ?? []
  const copies = (remote.data?.items ?? []).filter((item) => item.ownerId === owner.id)
  const localByKey = new Set(items.map((item) => item.key))
  const byPath = new Map(items.map((item) => [pathKey(item.path), item]))

  const value: CloudActionsValue = {
    owner,
    enabled,
    connected,
    ready,
    items,
    copies,
    itemAt: (path) => byPath.get(pathKey(path)),
    summary: {
      unsynced: local.data?.unsynced ?? 0,
      modified: local.data?.modified ?? 0,
      missing: local.data?.missing ?? 0,
      cloudOnly: copies.filter((copy) => !localByKey.has(copy.key)).length,
    },
    save: (item) => push.mutate([itemRef(item)]),
    saveMany: (selected) => push.mutate(selected.map(itemRef)),
    cloudOnly: (kinds) =>
      copies.filter((copy) => kinds.includes(copy.kind) && !localByKey.has(copy.key)),
    view: (target) => setViewing(target),
    compare: (target) => setComparing(target),
    restore: (copy) => setPreview(copy),
    restoreMany: (list) => setPendingRestore(list),
    remove: (copy) => setPendingDelete(copy),
    openRestoreList: () => setListOpen(true),
    busy: push.isPending || pull.isPending || removeRemote.isPending,
  }

  const localFor = (copy: RemoteItem) => items.find((item) => item.key === copy.key)

  return (
    <CloudActionsContext.Provider value={value}>
      {children}

      {viewing ? (
        <SyncContentDialog
          target={viewing}
          onCompare={
            viewing.remoteId
              ? () => {
                  const { remoteId, ownerId, owner: ref, name } = viewing
                  setViewing(null)
                  if (remoteId) setComparing(compareOf(remoteId, ownerId, ref, name))
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
          ownerId={owner.id}
          ownerName={owner.name}
          onClose={() => setPreview(null)}
        />
      ) : null}

      {listOpen ? (
        <Dialog open onOpenChange={(open) => (open ? undefined : setListOpen(false))}>
          <DialogContent className="w-[min(640px,94vw)]">
            <DialogHeader>
              <DialogTitle>{t('sync.restoreFrom')}</DialogTitle>
              <DialogDescription>
                {t('sync.restoreFromHint', { count: copies.length, name: owner.name })}
              </DialogDescription>
            </DialogHeader>
            <DialogBody className="max-h-[60vh]">
              {remote.isPending ? (
                <SkeletonList rows={3} />
              ) : remote.error ? (
                <ErrorState error={remote.error} onRetry={() => void remote.refetch()} />
              ) : copies.length === 0 ? (
                <EmptyState
                  icon={CloudUpload}
                  title={t('sync.emptyRemote')}
                  hint={t('sync.emptyRemoteHint')}
                />
              ) : (
                <ul className="flex flex-col gap-2">
                  {copies.map((copy) => {
                    const match = localFor(copy)
                    const name = copy.label || copy.name
                    const compare = match
                      ? () => setComparing(compareOf(copy.remoteId, owner.id, owner, name))
                      : undefined
                    const openViewer = () =>
                      setViewing(viewOfRemote(copy, owner, match?.id ?? null))
                    const busy = removeRemote.isPending && pendingDelete?.remoteId === copy.remoteId
                    return (
                      <li key={copy.remoteId}>
                        <SyncRemoteContextMenu
                          item={copy}
                          busy={busy}
                          onRestore={() => setPreview(copy)}
                          onDelete={() => setPendingDelete(copy)}
                          onView={openViewer}
                          onCompare={compare}
                        >
                          <RemoteItemRow
                            item={copy}
                            localName={match?.label}
                            busy={busy}
                            onPreview={() => setPreview(copy)}
                            onDelete={() => setPendingDelete(copy)}
                            onView={openViewer}
                            onCompare={compare}
                          />
                        </SyncRemoteContextMenu>
                      </li>
                    )
                  })}
                </ul>
              )}
            </DialogBody>
            <div className="border-border flex items-center justify-between gap-3 border-t px-6 py-4">
              <span className="text-muted text-[0.8125rem]">
                {t('sync.copiesCount', { count: copies.length })}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  loading={refresh.isPending}
                  onClick={() => refresh.mutate()}
                >
                  <RefreshCw className="size-3.5" aria-hidden />
                  {t('sync.refresh')}
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setListOpen(false)}>
                  {t('common.close')}
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      ) : null}

      {pendingDelete ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? undefined : setPendingDelete(null))}
          title={t('sync.deleteConfirm')}
          description={t('sync.deleteConfirmHint')}
          confirmLabel={t('sync.delete')}
          busy={removeRemote.isPending}
          onConfirm={() =>
            removeRemote.mutate(
              { remoteId: pendingDelete.remoteId, confirm: true },
              { onSuccess: () => setPendingDelete(null) },
            )
          }
        />
      ) : null}

      {pendingRestore ? (
        <ConfirmDialog
          open
          tone="primary"
          onOpenChange={(open) => (open ? undefined : setPendingRestore(null))}
          title={t('sync.restoreSelectedTitle')}
          description={t('sync.restoreAllHint', {
            count: pendingRestore.length,
            name: owner.name,
          })}
          confirmLabel={t('sync.restoreSelected', { count: pendingRestore.length })}
          busy={pull.isPending}
          onConfirm={() =>
            pull.mutate(
              {
                targets: pendingRestore.map((copy) => ({
                  remoteId: copy.remoteId,
                  ownerId: owner.id,
                })),
                confirm: true,
              },
              { onSuccess: () => setPendingRestore(null) },
            )
          }
        />
      ) : null}
    </CloudActionsContext.Provider>
  )
}

/**
 * The cloud state and the two actions of one file, as a card wears them: what this machine holds
 * against the cloud, a Save and a Restore.
 *
 * Renders nothing before sync is set up, so a card looks exactly as it did until the user opted
 * into the cloud.
 */
export function CloudItemAction({ item, className }: { item: SyncItem; className?: string }) {
  const { t } = useTranslation()
  const cloud = useCloudActions()
  if (!cloud?.ready) return null

  const copy = cloud.copies.find((entry) => entry.key === item.key)
  // A declared file that is not on disk and has no copy has nothing to save and nothing to
  // restore; the card's own "missing" badge is the whole story.
  if (!item.exists && !copy) return null

  const tone = statusTone(item.status)
  // Saving something that is already the cloud's copy would only answer "already up to date".
  const upToDate = item.status === 'synced' && Boolean(copy)

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Badge tone={tone} dot={tone}>
        {t(`sync.status.${item.status}`)}
      </Badge>
      <Tooltip content={t('sync.view')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sync.view')}
          onClick={() => cloud.view(viewOfLocal(item, cloud.owner))}
        >
          <Eye className="size-3.5" aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={t('sync.compare')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sync.compare')}
          disabled={!copy}
          onClick={() =>
            copy && cloud.compare(compareOf(copy.remoteId, cloud.owner.id, cloud.owner, item.label))
          }
        >
          <GitCompare className="size-3.5" aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={copy ? t('sync.saveAgain') : t('sync.save')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sync.save')}
          disabled={!item.exists || upToDate || cloud.busy}
          onClick={() => cloud.save(item)}
        >
          <CloudUpload className="size-3.5" aria-hidden />
        </Button>
      </Tooltip>
      <Tooltip content={t('sync.restore')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sync.restore')}
          disabled={!copy || cloud.busy}
          onClick={() => copy && cloud.restore(copy)}
        >
          <CloudDownload className="size-3.5" aria-hidden />
        </Button>
      </Tooltip>
    </div>
  )
}

/**
 * A copy this machine has no file for: the card still appears, and Restore is the one thing
 * there is to do with it.
 */
export function CloudRemoteAction({
  remote: copy,
  className,
}: {
  remote: RemoteItem
  className?: string
}) {
  const { t } = useTranslation()
  const cloud = useCloudActions()
  if (!cloud?.ready) return null

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Badge tone="info" dot="neutral">
        {t('sync.fileStatus.cloudOnly')}
      </Badge>
      <Button
        variant="secondary"
        size="sm"
        disabled={cloud.busy}
        onClick={() => cloud.restore(copy)}
      >
        <CloudDownload className="size-3.5" aria-hidden />
        {t('sync.restore')}
      </Button>
      <Tooltip content={t('sync.view')}>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={t('sync.view')}
          onClick={() => cloud.view(viewOfRemote(copy, cloud.owner, null))}
        >
          <Eye className="size-3.5" aria-hidden />
        </Button>
      </Tooltip>
    </div>
  )
}
