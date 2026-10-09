import { RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { BackupEntry } from '@/shared/bindings/BackupEntry'
import { formatDateTime, formatRelative } from '@/shared/lib/format'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { ErrorState } from '@/shared/ui/EmptyState'
import { Spinner } from '@/shared/ui/Primitives'

import { useBackupContent } from '../api/hooks'
import { BackupDiff } from './BackupDiff'

/**
 * One backup against the file it came from, git style.
 *
 * The backup is read by path (the backend re-checks that it belongs to this document), and the
 * side it is compared against is the live editor text, so unsaved edits are visible here too.
 */
export function BackupDiffDialog({
  agentId,
  path,
  label,
  entry,
  current,
  onOpenChange,
  onRestore,
}: {
  agentId: string
  path: string
  label: string
  entry: BackupEntry
  /** The text on screen in the editor — the "current" side of the comparison. */
  current: string
  onOpenChange: () => void
  onRestore: () => void
}) {
  const { t, i18n } = useTranslation()
  const backup = useBackupContent(agentId, path, entry.path, true)
  const when = formatRelative(entry.createdMs, i18n.language) ?? ''

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[85vh] w-[min(1200px,96vw)] flex-col">
        <DialogHeader className="pb-3">
          <DialogTitle>{t('editor.compareTitle', { file: label })}</DialogTitle>
          <DialogDescription>
            {t('editor.backupFrom', { when })}
            {' · '}
            <span
              className="font-mono"
              title={formatDateTime(entry.createdMs, i18n.language) ?? ''}
            >
              {entry.path}
            </span>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-col overflow-hidden pt-0">
          {backup.isPending ? (
            <div className="text-muted flex flex-1 items-center justify-center gap-2 text-[0.8125rem]">
              <Spinner /> {t('common.loading')}
            </div>
          ) : backup.error ? (
            <ErrorState error={backup.error} onRetry={() => void backup.refetch()} />
          ) : (
            <BackupDiff
              oldText={backup.data ?? ''}
              newText={current}
              leftLabel={t('editor.backupVersion')}
              rightLabel={t('editor.currentVersion')}
            />
          )}
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onOpenChange}>
            {t('common.close')}
          </Button>
          <Button variant="secondary" disabled={backup.isPending} onClick={onRestore}>
            <RotateCcw className="size-3.5" aria-hidden />
            {t('editor.restore')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
