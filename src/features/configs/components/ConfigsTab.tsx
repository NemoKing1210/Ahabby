import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, Pencil, Save } from 'lucide-react'

import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { CodeViewer } from '@/shared/ui/CodeViewer'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PathRow } from '@/shared/ui/PathRow'
import { Spinner } from '@/shared/ui/Primitives'
import { Tooltip } from '@/shared/ui/Tooltip'

import { useConfigSnapshot } from '../api/hooks'
import { ConfigEditorDialog } from './ConfigEditorDialog'

/** Read-only viewer, used for files the manifest declares as not editable. */
function ConfigViewDialog({
  agentId,
  config,
  open,
  onOpenChange,
}: {
  agentId: string
  config: ConfigFile
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const snapshot = useConfigSnapshot(agentId, config.path, open)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(960px,94vw)]">
        <DialogHeader>
          <DialogTitle>{config.label}</DialogTitle>
          <PathRow path={config.path} className="mt-1" />
        </DialogHeader>
        <DialogBody>
          {snapshot.isLoading ? (
            <div className="text-muted flex items-center gap-2 text-[13px]">
              <Spinner /> {t('common.loading')}
            </div>
          ) : snapshot.data ? (
            <>
              {snapshot.data.truncated ? (
                <p className="text-warning-fg mb-2 text-[12px]">
                  {t('configs.truncated', {
                    size: formatBytes(snapshot.data.sizeBytes) ?? '',
                  })}
                </p>
              ) : (
                <CodeViewer
                  value={snapshot.data.content}
                  format={config.format}
                  ariaLabel={config.label}
                />
              )}
            </>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

export function ConfigsTab({ agentId, configs }: { agentId: string; configs: ConfigFile[] }) {
  const { t, i18n } = useTranslation()
  const [viewTarget, setViewTarget] = useState<ConfigFile | null>(null)
  const [editTarget, setEditTarget] = useState<ConfigFile | null>(null)

  if (configs.length === 0) {
    return <EmptyState title={t('configs.none')} hint={t('configs.noneHint')} />
  }

  return (
    <div className="flex flex-col gap-3">
      {configs.map((config) => (
        <Card key={`${config.id}-${config.path}`} className="p-4">
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-foreground text-sm">{config.label}</span>
                  <Badge tone="outline">{config.format}</Badge>
                  {config.exists ? null : <Badge tone="neutral">{t('configs.missing')}</Badge>}
                  {config.editable ? null : <Badge tone="neutral">{t('common.readOnly')}</Badge>}
                </div>
                {config.description ? (
                  <p className="text-muted max-w-prose text-[12px]">{config.description}</p>
                ) : null}
              </div>

              <div className="flex items-center gap-1.5">
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={!config.exists}
                  onClick={() => setViewTarget(config)}
                >
                  <FileCode2 className="size-3.5" aria-hidden />
                  {t('configs.view')}
                </Button>
                <Tooltip content={config.editable ? t('configs.edit') : t('configs.notEditable')}>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!config.editable}
                    onClick={() => setEditTarget(config)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {t('configs.edit')}
                  </Button>
                </Tooltip>
              </div>
            </div>

            <PathRow path={config.path} />

            <div className="text-faint flex flex-wrap items-center gap-3 text-[12px]">
              {config.exists ? (
                <>
                  <span>
                    {t('configs.size')}: {formatBytes(config.sizeBytes) ?? '—'}
                  </span>
                  <span>
                    {t('configs.modified')}:{' '}
                    {formatRelative(config.modifiedMs, i18n.language) ?? '—'}
                  </span>
                </>
              ) : (
                <span className="flex items-center gap-1">
                  <Save className="size-3" aria-hidden />
                  {t('configs.missing')}
                </span>
              )}
            </div>
          </div>
        </Card>
      ))}

      {viewTarget ? (
        <ConfigViewDialog
          agentId={agentId}
          config={viewTarget}
          open
          onOpenChange={() => setViewTarget(null)}
        />
      ) : null}

      {editTarget ? (
        <ConfigEditorDialog
          key={editTarget.path}
          agentId={agentId}
          config={editTarget}
          onOpenChange={() => setEditTarget(null)}
        />
      ) : null}
    </div>
  )
}
