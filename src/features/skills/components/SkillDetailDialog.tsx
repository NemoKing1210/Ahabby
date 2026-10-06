import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'

import type { Skill } from '@/shared/bindings/Skill'
import { formatBytes, formatDateTime } from '@/shared/lib/format'
import { ownerName } from '@/shared/lib/owners'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Markdown } from '@/shared/ui/Markdown'
import { PathRow } from '@/shared/ui/PathRow'
import { Switch } from '@/shared/ui/Switch'
import { Tooltip } from '@/shared/ui/Tooltip'

/** Full view of one skill: metadata, frontmatter and the rendered SKILL.md body. */
export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onEdit,
  onDelete,
  onToggle,
  toggleBusy,
}: {
  skill: Skill | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: (skill: Skill) => void
  onDelete?: (skill: Skill) => void
  /** Only offered for a skill Ahabby may switch off. */
  onToggle?: (skill: Skill, enabled: boolean) => void
  /** Disables the switch while its own mutation is in flight. */
  toggleBusy?: boolean
}) {
  const { t, i18n } = useTranslation()
  if (!skill) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(860px,94vw)]"
        footer={
          <>
            <div className="text-faint mr-auto flex items-center gap-2 text-[0.75rem]">
              {formatBytes(skill.sizeBytes) ? <span>{formatBytes(skill.sizeBytes)}</span> : null}
              {skill.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
              {!skill.removable ? <Badge tone="neutral">{t('skills.notRemovable')}</Badge> : null}
            </div>
            {onToggle && skill.removable ? (
              <Tooltip content={t('skills.switchHint')}>
                <span className="inline-flex">
                  <Switch
                    checked={skill.enabled}
                    disabled={toggleBusy}
                    onCheckedChange={(next) => onToggle(skill, next)}
                    aria-label={skill.enabled ? t('skills.toggleOff') : t('skills.toggleOn')}
                  />
                </span>
              </Tooltip>
            ) : null}
            {onEdit && skill.entryPath ? (
              <Tooltip content={skill.removable ? t('configs.edit') : t('configs.notEditable')}>
                <span className="inline-flex">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!skill.removable}
                    onClick={() => onEdit(skill)}
                  >
                    <Pencil className="size-3.5" aria-hidden />
                    {t('configs.edit')}
                  </Button>
                </span>
              </Tooltip>
            ) : null}
            {onDelete && skill.removable ? (
              <Button variant="danger" size="sm" onClick={() => onDelete(skill)}>
                <Trash2 className="size-3.5" aria-hidden />
                {t('skills.delete')}
              </Button>
            ) : null}
          </>
        }
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle>{skill.name}</DialogTitle>
            {!skill.enabled ? <Badge tone="neutral">{t('skills.disabled')}</Badge> : null}
          </div>
          {skill.description ? (
            <p className="text-muted text-[0.8125rem]">{skill.description}</p>
          ) : null}
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('skills.path')}
            </span>
            <PathRow path={skill.path} />
            {skill.entryPath && skill.entryPath !== skill.path ? (
              <PathRow path={skill.entryPath} />
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[0.75rem]">
            <span className="flex items-baseline gap-1.5">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('library.created')}
              </span>
              <span className="text-muted">
                {formatDateTime(skill.createdMs, i18n.language) ?? t('common.notAvailable')}
              </span>
            </span>
            <span className="flex items-baseline gap-1.5">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('library.modified')}
              </span>
              <span className="text-muted">
                {formatDateTime(skill.modifiedMs, i18n.language) ?? t('common.notAvailable')}
              </span>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('skills.agents')}
            </span>
            {skill.agents.map((agent) => (
              <Badge key={agent.id} tone="outline">
                {ownerName(agent, t('library.shared'))}
              </Badge>
            ))}
          </div>

          {skill.frontmatter.length > 0 ? (
            <div className="flex flex-col gap-2">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('skills.frontmatter')}
              </span>
              <dl className="border-border grid grid-cols-[minmax(120px,auto)_1fr] gap-x-4 gap-y-1 rounded-lg border p-3">
                {skill.frontmatter.map((entry) => (
                  <div key={entry.key} className="contents">
                    <dt className="text-muted font-mono text-[0.75rem]">{entry.key}</dt>
                    <dd className="text-foreground text-[0.75rem] break-words">{entry.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('skills.content')}
            </span>
            {skill.content ? (
              <Markdown source={skill.content} />
            ) : (
              <EmptyState title={t('skills.noContent')} />
            )}
          </div>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
