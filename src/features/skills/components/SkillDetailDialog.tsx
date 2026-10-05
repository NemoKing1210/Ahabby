import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'

import type { Skill } from '@/shared/bindings/Skill'
import { formatBytes } from '@/shared/lib/format'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@/shared/ui/Dialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { Markdown } from '@/shared/ui/Markdown'
import { PathRow } from '@/shared/ui/PathRow'
import { Tooltip } from '@/shared/ui/Tooltip'

/** Full view of one skill: metadata, frontmatter and the rendered SKILL.md body. */
export function SkillDetailDialog({
  skill,
  open,
  onOpenChange,
  onEdit,
  onDelete,
}: {
  skill: Skill | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onEdit?: (skill: Skill) => void
  onDelete?: (skill: Skill) => void
}) {
  const { t } = useTranslation()
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
          <DialogTitle>{skill.name}</DialogTitle>
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

          <div className="flex flex-wrap items-center gap-2">
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('skills.agents')}
            </span>
            {skill.agents.map((agent) => (
              <Badge key={agent.id} tone="outline">
                {agent.name}
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
