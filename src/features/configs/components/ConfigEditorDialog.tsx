import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { History, RotateCcw, Save, ShieldAlert } from 'lucide-react'

import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import { isStaleFileError } from '@/shared/api/errors'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Spinner } from '@/shared/ui/Primitives'
import { PathRow } from '@/shared/ui/PathRow'
import { toast, toastAppError } from '@/shared/ui/Toast'

import {
  useBackups,
  useConfigSnapshot,
  usePreviewConfigSave,
  useRestoreBackup,
  useSaveConfig,
} from '../api/hooks'
import { DiffView } from './DiffView'

/**
 * The editor.
 *
 * Order of operations is fixed and visible to the user: edit → review (validation + diff +
 * staleness check) → save. Rust re-checks the hash and takes a backup before writing, so
 * the sequence cannot be short-circuited by the UI.
 *
 * The draft is kept as an override of the loaded snapshot rather than copied into state by
 * an effect: nothing is duplicated, and "the file changed under me" stays expressible.
 */
export function ConfigEditorDialog({
  agentId,
  config,
  onOpenChange,
}: {
  agentId: string
  config: ConfigFile
  onOpenChange: () => void
}) {
  const { t, i18n } = useTranslation()
  const snapshot = useConfigSnapshot(agentId, config.path, true)
  const preview = usePreviewConfigSave()
  const save = useSaveConfig()
  const restore = useRestoreBackup()
  const backups = useBackups(agentId, config.path, true)

  const [draft, setDraft] = useState<string | null>(null)
  const [showBackups, setShowBackups] = useState(false)
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null)
  const [staleWarning, setStaleWarning] = useState(false)

  const loaded = snapshot.data?.content ?? null
  const value = draft ?? loaded ?? ''
  const dirty = draft !== null && draft !== loaded

  const errors = preview.data?.errors ?? []
  const inSync = preview.data?.inSync ?? !staleWarning
  const canSave =
    dirty && inSync && errors.length === 0 && snapshot.data !== undefined && !save.isPending

  return (
    <>
      <Dialog open onOpenChange={onOpenChange}>
        <DialogContent
          className="w-[min(960px,94vw)]"
          footer={
            <>
              <Button variant="ghost" onClick={onOpenChange}>
                {t('common.close')}
              </Button>
              <Button
                variant="secondary"
                disabled={!dirty || snapshot.data === undefined}
                onClick={() => {
                  if (!snapshot.data) return
                  preview.mutate(
                    {
                      agentId,
                      path: config.path,
                      content: value,
                      baseSha256: snapshot.data.sha256,
                    },
                    {
                      onError: (error) => {
                        if (isStaleFileError(error)) setStaleWarning(true)
                        toastAppError(error)
                      },
                    },
                  )
                }}
              >
                {preview.isPending ? <Spinner /> : <ShieldAlert className="size-3.5" aria-hidden />}
                {t('editor.preview')}
              </Button>
              <Button
                variant="primary"
                disabled={!canSave}
                onClick={() => {
                  if (!snapshot.data) return
                  save.mutate(
                    {
                      agentId,
                      path: config.path,
                      content: value,
                      baseSha256: snapshot.data.sha256,
                    },
                    {
                      onSuccess: (result) => {
                        toast.success(
                          t('editor.saveSuccess', { file: config.label }),
                          result.data.backupPath
                            ? t('editor.backupTaken', { path: result.data.backupPath })
                            : undefined,
                        )
                        onOpenChange()
                      },
                      onError: (error) => {
                        if (isStaleFileError(error)) setStaleWarning(true)
                        toastAppError(error)
                      },
                    },
                  )
                }}
              >
                <Save className="size-3.5" aria-hidden />
                {save.isPending ? t('common.saving') : t('common.save')}
              </Button>
            </>
          }
        >
          <DialogHeader>
            <DialogTitle>{config.label}</DialogTitle>
            <DialogDescription>
              <PathRow path={config.path} className="mt-1" />
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="flex flex-col gap-4">
            {!inSync ? (
              <div className="border-warning/40 bg-surface flex flex-col gap-2 rounded-lg border p-3">
                <span className="text-foreground text-[13px]">{t('editor.staleFile')}</span>
                <span className="text-muted text-[12px]">{t('editor.staleHint')}</span>
                <div>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setStaleWarning(false)
                      setDraft(null)
                      preview.reset()
                      void snapshot.refetch()
                    }}
                  >
                    <RotateCcw className="size-3.5" aria-hidden />
                    {t('editor.reload')}
                  </Button>
                </div>
              </div>
            ) : null}

            {errors.length > 0 ? (
              <div className="border-danger/40 flex flex-col gap-1 rounded-lg border p-3">
                <span className="text-danger-fg text-[13px]">
                  {t('editor.validationFailed', { format: config.format.toUpperCase() })}
                </span>
                <ul className="text-muted font-mono text-[12px] break-all">
                  {errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {snapshot.isLoading || snapshot.data === undefined ? (
              <div className="text-muted flex items-center gap-2 text-[13px]">
                <Spinner /> {t('common.loading')}
              </div>
            ) : snapshot.data.editable ? (
              <CodeViewer
                value={value}
                format={config.format}
                editable
                onChange={setDraft}
                ariaLabel={config.label}
              />
            ) : (
              <CodeViewer
                value={snapshot.data.content}
                format={config.format}
                ariaLabel={config.label}
              />
            )}

            {preview.data ? <DiffView unified={preview.data.unified} /> : null}

            <div className="flex flex-col gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="self-start px-0"
                onClick={() => setShowBackups((shown) => !shown)}
              >
                <History className="size-3.5" aria-hidden />
                {t('editor.backups')}
                {backups.data && backups.data.length > 0 ? (
                  <Badge tone="neutral">{backups.data.length}</Badge>
                ) : null}
              </Button>

              {showBackups ? (
                backups.data && backups.data.length > 0 ? (
                  <ul className="flex flex-col gap-1">
                    {backups.data.map((backup) => (
                      <li
                        key={backup.path}
                        className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2"
                      >
                        <div className="flex min-w-0 flex-col">
                          <span className="text-foreground text-[13px]">
                            {formatRelative(backup.createdMs, i18n.language)}
                          </span>
                          <span className="text-faint truncate font-mono text-[11px]">
                            {backup.path}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-muted text-[12px]">
                            {formatBytes(backup.sizeBytes)}
                          </span>
                          <Button
                            variant="secondary"
                            size="sm"
                            onClick={() => setRestoreTarget(backup.path)}
                          >
                            {t('editor.restore')}
                          </Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted text-[12px]">{t('editor.noBackups')}</p>
                )
              ) : null}
            </div>
          </DialogBody>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null)
        }}
        title={t('editor.restoreTitle')}
        description={t('editor.restoreBody', {
          file: config.label,
          when:
            formatRelative(
              backups.data?.find((backup) => backup.path === restoreTarget)?.createdMs ?? 0,
              i18n.language,
            ) ?? t('common.unknown'),
        })}
        confirmLabel={t('editor.restore')}
        busy={restore.isPending}
        onConfirm={() => {
          if (!restoreTarget) return
          restore.mutate(
            { agentId, path: config.path, backupPath: restoreTarget },
            {
              onSuccess: () => {
                toast.success(t('toast.restored'))
                setRestoreTarget(null)
                setDraft(null)
                void snapshot.refetch()
              },
              onError: (error) => toastAppError(error),
            },
          )
        }}
      />
    </>
  )
}
