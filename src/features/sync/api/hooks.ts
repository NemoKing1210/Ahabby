import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { SyncItemRef } from '@/shared/bindings/SyncItemRef'
import type { SyncProviderId } from '@/shared/bindings/SyncProviderId'
import type { SyncPullTarget } from '@/shared/bindings/SyncPullTarget'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { SyncRun } from '@/shared/bindings/SyncRun'
import i18n from '@/shared/i18n'
import { toast, toastAppError } from '@/shared/ui/Toast'

/**
 * The cloud sync connection: who is connected, what the last runs did and the last error.
 *
 * Kept fresh by the `sync://done` event (`app/providers.tsx` invalidates this key), because an
 * automatic run has no button behind it and the screen would otherwise show a stale "last saved".
 */
export function useSyncStatus() {
  return useQuery({
    queryKey: queryKeys.syncStatus(),
    queryFn: ipc.syncStatus,
    staleTime: 30_000,
  })
}

/** The syncable items of this machine — one owner's, or every owner's. */
export function useSyncItems(ownerId: string | null = null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.syncItems(ownerId),
    queryFn: () => ipc.listSyncItems(ownerId),
    enabled,
    // Reading every synced item's files is what "changed since the last save" costs; a scan is
    // what changes the answer, and a mutation invalidates this key.
    staleTime: 30_000,
  })
}

/** The copies the connected account holds. The backend caches them for a minute. */
export function useRemoteSyncItems(enabled = true) {
  return useQuery({
    queryKey: queryKeys.syncRemote(),
    queryFn: () => ipc.listRemoteSyncItems(false),
    enabled,
    staleTime: 60_000,
    retry: false,
  })
}

/**
 * Re-read the cloud list, ignoring the minute the backend keeps an answer for.
 *
 * The listing is cached so flipping between the tabs costs nothing; this is the one action that
 * says "ask GitHub again" — after saving something in the gist's own web UI, say.
 */
export function useRefreshRemoteSync() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: () => ipc.listRemoteSyncItems(true),
    onSuccess: (list) => client.setQueryData(queryKeys.syncRemote(), list),
    onError: (error) => toastAppError(error),
  })
}

/** What restoring one copy would do, asked only while its preview is open. */
export function useSyncPreview(remoteId: string | null, ownerId: string | null) {
  return useQuery({
    queryKey: queryKeys.syncPreview(remoteId ?? '', ownerId ?? ''),
    queryFn: () => ipc.previewSyncPull(remoteId ?? '', ownerId ?? ''),
    enabled: remoteId !== null && ownerId !== null,
    staleTime: 0,
    retry: false,
  })
}

/**
 * The content of one item of this machine, read for the viewer.
 *
 * `enabled` keeps the read behind the dialog being open — and behind the side the user asked for,
 * so opening a file costs one call and switching to the cloud side costs a second one.
 */
export function useSyncItemContent(ownerId: string | null, itemId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.syncItemContent(ownerId ?? '', itemId ?? ''),
    queryFn: () => ipc.readSyncItem(ownerId ?? '', itemId ?? ''),
    enabled: enabled && ownerId !== null && itemId !== null,
    // A file changes under the reader only if something else writes it; the dialog asks again
    // when it is reopened, which is a fresh mount and a fresh query.
    staleTime: 30_000,
    retry: false,
  })
}

/** The content of one cloud copy, read for the viewer. */
export function useRemoteSyncContent(remoteId: string | null, enabled = true) {
  return useQuery({
    queryKey: queryKeys.syncRemoteContent(remoteId ?? ''),
    queryFn: () => ipc.readRemoteSyncItem(remoteId ?? ''),
    enabled: enabled && remoteId !== null,
    staleTime: 30_000,
    retry: false,
  })
}

/** One item against its cloud copy, for the compare dialog. */
export function useSyncComparison(remoteId: string | null, ownerId: string | null) {
  return useQuery({
    queryKey: queryKeys.syncComparison(remoteId ?? '', ownerId ?? ''),
    queryFn: () => ipc.compareSyncItem(remoteId ?? '', ownerId ?? ''),
    enabled: remoteId !== null && ownerId !== null,
    staleTime: 0,
    retry: false,
  })
}

/** Check the stored token against the provider. */
export function useVerifySync() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ipc.verifySyncConnection,
    onError: (error) => toastAppError(error),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: queryKeys.syncStatus() })
      void client.invalidateQueries({ queryKey: queryKeys.syncRemote() })
    },
  })
}

/** Store the token, or clear it with an empty string. */
export function useSetSyncToken() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ provider, token }: { provider: SyncProviderId; token: string }) =>
      ipc.setSyncToken(provider, token),
    onError: (error) => toastAppError(error),
    onSuccess: (status) => {
      client.setQueryData(queryKeys.syncStatus(), status)
      void client.invalidateQueries({ queryKey: queryKeys.syncRemote() })
    },
  })
}

/** Everything a run has to refresh once it wrote something. */
function afterRun(client: QueryClient, run: SyncRun, report?: ScanReport) {
  if (report) client.setQueryData(queryKeys.agents(), report)
  if (run.uploaded > 0 || run.deleted > 0) {
    void client.invalidateQueries({ queryKey: queryKeys.syncRemote() })
  }
  if (run.downloaded > 0) {
    void client.invalidateQueries({ queryKey: queryKeys.syncItemsAll() })
    void client.invalidateQueries({ queryKey: queryKeys.library() })
  }
  void client.invalidateQueries({ queryKey: queryKeys.syncStatus() })
}

/** The toast a finished run earns: counters for what happened, the first failure otherwise. */
export function reportSyncRun(run: SyncRun, onError: (error: unknown) => void) {
  const failure = run.results.find((result) => !result.ok)
  if (run.failed > 0 && failure) {
    onError(new Error(failure.message ?? String(run.failed)))
    return
  }
  const parts: string[] = []
  if (run.uploaded > 0) parts.push(i18n.t('sync.run.uploaded', { count: run.uploaded }))
  if (run.downloaded > 0) parts.push(i18n.t('sync.run.downloaded', { count: run.downloaded }))
  if (run.deleted > 0) parts.push(i18n.t('sync.run.deleted', { count: run.deleted }))
  if (run.skipped > 0) parts.push(i18n.t('sync.run.skipped', { count: run.skipped }))
  const warning = run.results.find((result) => result.skipped)?.message
  toast.success(
    parts.length > 0 ? parts.join(' · ') : i18n.t('sync.run.nothing'),
    warning ?? undefined,
  )
}

/** Upload the selected items. */
export function usePushSync() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (items: SyncItemRef[]) => ipc.pushSyncItems(items),
    onSuccess: (result) => {
      afterRun(client, result.data, result.report)
      reportSyncRun(result.data, toastAppError)
    },
    onError: (error) => toastAppError(error),
  })
}

/** Upload everything automatic saving covers. */
export function usePushAllSync() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ipc.pushAllSyncItems,
    onSuccess: (result) => {
      afterRun(client, result.data, result.report)
      reportSyncRun(result.data, toastAppError)
    },
    onError: (error) => toastAppError(error),
  })
}

/** Restore the selected copies. Always confirmed by the caller. */
export function usePullSync() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ targets, confirm }: { targets: SyncPullTarget[]; confirm: boolean }) =>
      ipc.pullSyncItems(targets, confirm),
    onSuccess: (result) => {
      afterRun(client, result.data, result.report)
      reportSyncRun(result.data, toastAppError)
    },
    onError: (error) => toastAppError(error),
  })
}

/** Remove one cloud copy. */
export function useDeleteRemoteSync() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: ({ remoteId, confirm }: { remoteId: string; confirm: boolean }) =>
      ipc.deleteRemoteSyncItem(remoteId, confirm),
    onSuccess: (run) => {
      afterRun(client, run)
      reportSyncRun(run, toastAppError)
      void client.invalidateQueries({ queryKey: queryKeys.syncItemsAll() })
    },
    onError: (error) => toastAppError(error),
  })
}
