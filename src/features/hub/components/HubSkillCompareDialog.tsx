import { useTranslation } from 'react-i18next'

import type { HubEntryInstall } from '@/shared/bindings/HubEntryInstall'
import { AgentTag } from '@/shared/ui/AgentTag'
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

import { BackupDiff } from '@/features/editor/components/BackupDiff'

import { useHubSkillCompare } from '../api/queries'

/**
 * The collection's `SKILL.md` against one installed copy — the same git-style view the editor
 * uses for a backup, without a restore action.
 *
 * Both texts come from one backend call so the dialog shows the exact bytes that made
 * `identical === false`, not a truncated preview.
 */
export function HubSkillCompareDialog({
  entryId,
  entryName,
  install,
  onOpenChange,
}: {
  entryId: string
  entryName: string
  install: HubEntryInstall
  onOpenChange: () => void
}) {
  const { t } = useTranslation()
  const compare = useHubSkillCompare(entryId, install.owner.id, true)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onOpenChange()
      }}
    >
      <DialogContent className="flex h-[85vh] w-[min(1200px,96vw)] flex-col">
        <DialogHeader className="pb-3">
          <DialogTitle>{t('hub.compareTitle')}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span>{t('hub.compareBody', { name: entryName })}</span>
              <AgentTag agent={install.owner} />
              {compare.data?.localPath ? (
                <code
                  className="text-faint min-w-0 truncate font-mono text-[0.7rem]"
                  title={compare.data.localPath}
                >
                  {compare.data.localPath}
                </code>
              ) : null}
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex min-h-0 flex-col overflow-hidden pt-0">
          {compare.isPending ? (
            <div className="text-muted flex flex-1 items-center justify-center gap-2 text-[0.8125rem]">
              <Spinner /> {t('common.loading')}
            </div>
          ) : compare.error ? (
            <ErrorState error={compare.error} onRetry={() => void compare.refetch()} />
          ) : (
            <BackupDiff
              oldText={compare.data?.published ?? ''}
              newText={compare.data?.local ?? ''}
              leftLabel={t('hub.collectionVersion')}
              rightLabel={t('hub.localVersion')}
            />
          )}
        </DialogBody>

        <div className="border-border flex items-center justify-end gap-2 border-t px-6 py-4">
          <Button variant="ghost" onClick={onOpenChange}>
            {t('common.close')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
