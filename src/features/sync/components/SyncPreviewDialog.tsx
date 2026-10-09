import { useTranslation } from 'react-i18next'
import { AlertTriangle, Download } from 'lucide-react'

import type { SyncFileAction } from '@/shared/bindings/SyncFileAction'
import { formatBytes } from '@/shared/lib/format'
import { cn } from '@/shared/lib/cn'
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
import { ErrorState } from '@/shared/ui/EmptyState'
import { SkeletonList } from '@/shared/ui/Primitives'

import { usePullSync, useSyncPreview } from '../api/hooks'

const ACTION_TONE: Record<SyncFileAction, 'neutral' | 'accent' | 'success' | 'danger'> = {
  add: 'accent',
  replace: 'neutral',
  same: 'success',
  blocked: 'danger',
}

/**
 * What restoring one cloud copy would do, before it does it.
 *
 * The destination and every file's action come from the backend, resolved against the current
 * scan — so this dialog shows exactly what will be written, and refuses nothing the backend
 * would accept. The Restore button is the `confirm` the command insists on.
 */
export function SyncPreviewDialog({
  remoteId,
  ownerId,
  ownerName,
  onClose,
}: {
  remoteId: string
  ownerId: string
  ownerName: string
  onClose: () => void
}) {
  const { t } = useTranslation()
  const preview = useSyncPreview(remoteId, ownerId)
  const pull = usePullSync()

  const data = preview.data
  const blocked = data?.canApply === false

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="w-[min(720px,94vw)]">
        <DialogHeader>
          <DialogTitle>{t('sync.previewTitle')}</DialogTitle>
          <DialogDescription>
            {t('sync.previewHint', {
              name: data?.label ?? data?.name ?? remoteId,
              owner: data?.ownerName ?? ownerName,
            })}
          </DialogDescription>
        </DialogHeader>

        <DialogBody>
          {preview.isPending ? (
            <SkeletonList rows={2} />
          ) : preview.error ? (
            <ErrorState error={preview.error} onRetry={() => void preview.refetch()} />
          ) : data ? (
            <div className="flex flex-col gap-3">
              <div className="border-border bg-surface-2/60 flex flex-col gap-1 rounded-lg border p-3">
                <span className="text-faint text-[0.75rem]">{t('sync.destination')}</span>
                <span className="font-mono text-[0.75rem] break-all select-text">
                  {data.destination}
                </span>
              </div>

              {blocked ? (
                <div className="border-warning/40 bg-warning/10 text-warning-fg flex items-start gap-2 rounded-lg border p-3 text-[0.8125rem]">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden />
                  <span>{data.blockedReason ?? t('sync.cannotRestore')}</span>
                </div>
              ) : null}

              <ScrollArea className="max-h-[45vh]">
                <ul className="flex flex-col gap-2 pr-3">
                  {data.files.map((file) => (
                    <li key={file.path} className="border-border rounded-lg border">
                      <div className="flex items-center gap-2 p-2.5">
                        <span className="min-w-0 flex-1 truncate font-mono text-[0.75rem]">
                          {file.path}
                        </span>
                        <span className="text-faint text-[0.6875rem] tabular-nums">
                          {formatBytes(file.sizeBytes)}
                        </span>
                        <Badge tone={ACTION_TONE[file.action]}>
                          {t(`sync.action.${file.action}`)}
                        </Badge>
                      </div>
                      {file.unified ? (
                        <pre
                          className={cn(
                            'border-border max-h-64 overflow-auto border-t p-2.5',
                            'text-[0.6875rem] leading-relaxed select-text',
                          )}
                        >
                          {file.unified.split('\n').map((line, index) => (
                            <div
                              key={`${index}-${line.slice(0, 8)}`}
                              className={cn(
                                line.startsWith('+') && !line.startsWith('+++')
                                  ? 'text-success-fg'
                                  : line.startsWith('-') && !line.startsWith('---')
                                    ? 'text-danger-fg'
                                    : 'text-muted',
                              )}
                            >
                              {line || ' '}
                            </div>
                          ))}
                        </pre>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </ScrollArea>
            </div>
          ) : null}
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={pull.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={pull.isPending}
            disabled={!data?.canApply}
            onClick={() =>
              pull.mutate(
                { targets: [{ remoteId, ownerId }], confirm: true },
                { onSuccess: onClose },
              )
            }
          >
            <Download className="size-3.5" aria-hidden />
            {t('sync.confirmRestore')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
