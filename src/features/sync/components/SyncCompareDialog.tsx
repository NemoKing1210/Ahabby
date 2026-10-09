import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { formatBytes } from '@/shared/lib/format'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ScrollArea,
} from '@/shared/ui/Dialog'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Spinner } from '@/shared/ui/Primitives'
import { Tooltip } from '@/shared/ui/Tooltip'
import { usePullSync, useSyncComparison } from '../api/hooks'
import { BackupDiff } from '@/features/editor/components/BackupDiff'
import { SyncFileList } from './SyncFileList'

/**
 * One item against its cloud copy, file by file.
 *
 * Both sides are read by the backend the same way (text within a limit, binary by size and hash),
 * so this dialog can be honest about what it is looking at: a real diff where there is text to
 * diff, the two sizes where there is not, and "identical" only when every file matched. The
 * Restore action is here because comparing is the moment a restore is usually wanted — and the
 * diff on screen *is* its review, the way the editor's own backup comparison works, so the button
 * carries the warning rather than hiding the file list behind a second dialog.
 */
export function SyncCompareDialog({
  remoteId,
  ownerId,
  owner,
  name,
  onClose,
}: {
  remoteId: string
  ownerId: string
  owner: AgentRef
  name: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const compare = useSyncComparison(remoteId, ownerId)
  const pull = usePullSync()
  const [selected, setSelected] = useState<string | null>(null)

  const data = compare.data
  const file = data?.files.find((entry) => entry.path === selected) ?? data?.files[0]
  const localSize = formatBytes(file?.localSizeBytes ?? null)
  const cloudSize = formatBytes(file?.cloudSizeBytes ?? null)

  return (
    <>
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="flex h-[85vh] w-[min(1300px,96vw)] flex-col">
          <DialogHeader className="pb-3">
            <DialogTitle className="truncate">{t('sync.compareTitle')}</DialogTitle>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span>{t('sync.compareHint', { name })}</span>
                <AgentTag agent={owner} />
                {data ? (
                  data.identical ? (
                    <Badge tone="success">{t('sync.identical')}</Badge>
                  ) : (
                    <Badge tone="warning">{t('sync.differCount', { count: data.changed })}</Badge>
                  )
                ) : null}
                {data && !data.local.exists ? (
                  <Badge tone="danger">{t('sync.noLocalCopy')}</Badge>
                ) : null}
              </div>
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex min-h-0 flex-1 flex-col overflow-hidden pt-0">
            {compare.isPending ? (
              <div className="text-muted flex flex-1 items-center justify-center gap-2 text-[0.8125rem]">
                <Spinner /> {t('common.loading')}
              </div>
            ) : compare.error ? (
              <ErrorState error={compare.error} onRetry={() => void compare.refetch()} />
            ) : !data || data.files.length === 0 ? (
              <EmptyState icon={Download} title={t('sync.compareEmpty')} />
            ) : (
              <div className="flex min-h-0 flex-1 gap-3">
                <ScrollArea className="border-border w-72 shrink-0 border-r pr-2">
                  <SyncFileList
                    files={data.files.map((entry) => ({
                      path: entry.path,
                      sizeBytes: entry.localSizeBytes ?? entry.cloudSizeBytes ?? 0,
                      binary: entry.binary,
                      status: entry.status,
                      truncated: entry.truncated,
                    }))}
                    selected={file?.path ?? ''}
                    onSelect={setSelected}
                    className="pr-1"
                  />
                </ScrollArea>

                <div className="flex min-h-0 flex-1 flex-col gap-2">
                  <code className="truncate font-mono text-[0.75rem]">{file?.path}</code>
                  {file && file.left === undefined && file.right === undefined ? (
                    <p className="border-border text-muted rounded-lg border border-dashed px-4 py-8 text-center text-[0.8125rem]">
                      {t('sync.compareBinary', {
                        local: localSize ?? t('common.none'),
                        cloud: cloudSize ?? t('common.none'),
                      })}
                    </p>
                  ) : (
                    <BackupDiff
                      oldText={file?.left ?? ''}
                      newText={file?.right ?? ''}
                      leftLabel={t('sync.sideLocal')}
                      rightLabel={t('sync.sideRemote')}
                    />
                  )}
                </div>
              </div>
            )}
          </DialogBody>

          <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
            <Button variant="ghost" onClick={onClose} disabled={pull.isPending}>
              {t('common.close')}
            </Button>
            <Tooltip
              content={
                data
                  ? t('sync.restoreOneHint', {
                      name: data.label || data.name,
                      owner: owner.name,
                    })
                  : null
              }
            >
              <span className="inline-flex">
                <Button
                  variant="primary"
                  loading={pull.isPending}
                  disabled={!data || !data.local.exists}
                  onClick={() =>
                    pull.mutate(
                      { targets: [{ remoteId, ownerId }], confirm: true },
                      { onSuccess: onClose },
                    )
                  }
                >
                  <Download className="size-3.5" aria-hidden />
                  {t('sync.restore')}
                </Button>
              </span>
            </Tooltip>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
