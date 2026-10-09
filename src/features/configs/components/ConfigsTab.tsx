import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileCode2, Pencil, Plus } from 'lucide-react'

import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import { cn } from '@/shared/lib/cn'
import { formatBytes, formatRelative } from '@/shared/lib/format'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { EmptyState } from '@/shared/ui/EmptyState'
import { PathRow } from '@/shared/ui/PathRow'
import { Tooltip } from '@/shared/ui/Tooltip'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { configDocument } from '@/features/editor/model'

export function ConfigsTab({
  agentId,
  configs,
  emptyHint,
}: {
  agentId: string
  configs: ConfigFile[]
  /** Replaces the default hint — a project has its own wording for "nothing declared". */
  emptyHint?: string
}) {
  const { t, i18n } = useTranslation()
  const [target, setTarget] = useState<{ config: ConfigFile; editable: boolean } | null>(null)

  if (configs.length === 0) {
    return <EmptyState title={t('configs.none')} hint={emptyHint ?? t('configs.noneHint')} />
  }

  // Files that do not exist yet are listed after the ones that do — nothing to act on is never
  // in the way of something that is.
  const ordered = [
    ...configs.filter((config) => config.exists),
    ...configs.filter((config) => !config.exists),
  ]

  return (
    <>
      <AnimatedList>
        {ordered.map((config) => (
          <Card
            key={`${config.id}-${config.path}`}
            className={cn(
              'p-4',
              !config.exists && 'border-border-strong bg-surface-2/40 border-dashed',
            )}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-foreground text-sm">{config.label}</span>
                    <Badge tone="outline">{config.format}</Badge>
                    {config.exists ? null : <Badge tone="accent">{t('configs.missing')}</Badge>}
                    {config.editable ? null : <Badge tone="neutral">{t('common.readOnly')}</Badge>}
                  </div>
                  {config.description ? (
                    <p className="text-muted max-w-prose text-[0.75rem]">{config.description}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-1.5">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={!config.exists}
                    onClick={() => setTarget({ config, editable: false })}
                  >
                    <FileCode2 className="size-3.5" aria-hidden />
                    {t('configs.view')}
                  </Button>
                  <Tooltip
                    content={
                      config.editable
                        ? config.exists
                          ? t('configs.edit')
                          : t('configs.createHint')
                        : t('configs.notEditable')
                    }
                  >
                    <Button
                      variant={config.exists ? 'secondary' : 'primary'}
                      size="sm"
                      disabled={!config.editable}
                      onClick={() => setTarget({ config, editable: true })}
                    >
                      {config.exists ? (
                        <Pencil className="size-3.5" aria-hidden />
                      ) : (
                        <Plus className="size-3.5" aria-hidden />
                      )}
                      {config.exists ? t('configs.edit') : t('configs.create')}
                    </Button>
                  </Tooltip>
                </div>
              </div>

              <PathRow path={config.path} />

              <div className="text-faint flex flex-wrap items-center gap-3 text-[0.75rem]">
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
                    <Plus className="size-3" aria-hidden />
                    {t('configs.missing')}
                  </span>
                )}
              </div>
            </div>
          </Card>
        ))}
      </AnimatedList>

      {target ? (
        <DocumentEditorDialog
          key={`${target.config.path}:${String(target.editable)}`}
          agentId={agentId}
          document={{ ...configDocument(target.config), editable: target.editable }}
          onOpenChange={() => setTarget(null)}
        />
      ) : null}
    </>
  )
}
