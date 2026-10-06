import type { KeyboardEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { Pencil, Sparkles, Trash2 } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Skill } from '@/shared/bindings/Skill'
import { cn } from '@/shared/lib/cn'
import { formatBytes, shortenPath } from '@/shared/lib/format'
import { AgentTag } from '@/shared/ui/AgentTag'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Switch } from '@/shared/ui/Switch'
import { Timestamp } from '@/shared/ui/Timestamp'
import { Tooltip } from '@/shared/ui/Tooltip'

import { SkillContextMenu } from './SkillContextMenu'

/**
 * One skill, in the same shape as an agent card: a brand-neutral tile, the name in the serif
 * face, quiet metadata and the actions in their own column so a click there never opens the
 * detail view.
 *
 * `agents` is what turns the card into a library card — the agent page already knows whose
 * list it is showing, so it leaves the owners off.
 */
export function SkillCard({
  skill,
  agents,
  onOpen,
  onEdit,
  onDelete,
  onToggle,
  toggleBusy,
}: {
  skill: Skill
  /** Owners to show as tags; omit them on a page that is already scoped to one agent. */
  agents?: AgentRef[]
  onOpen?: (skill: Skill) => void
  /** Only offered for a skill that has an entry file. */
  onEdit?: (skill: Skill) => void
  /** Only offered for a skill Ahabby is allowed to delete. */
  onDelete?: (skill: Skill) => void
  /** Only offered for a skill Ahabby may switch off; the backend refuses the rest. */
  onToggle?: (skill: Skill, enabled: boolean) => void
  /** Disables this card's switch while its own mutation is in flight. */
  toggleBusy?: boolean
}) {
  const { t } = useTranslation()
  const size = formatBytes(skill.sizeBytes)
  const open = onOpen ? () => onOpen(skill) : undefined

  // The body is a div rather than a button: a button may not contain the block content the
  // card needs. Enter/Space keep it reachable from the keyboard.
  const activate = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!open) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      open()
    }
  }

  return (
    <SkillContextMenu
      skill={skill}
      onOpen={onOpen}
      onEdit={onEdit}
      onDelete={onDelete}
      onToggle={onToggle}
    >
      <Card
        className={cn(
          'group ease-warm hover:border-border-strong relative transition-[border-color,translate] duration-150 hover:-translate-y-px',
          !skill.enabled && 'border-dashed',
        )}
      >
        <div className="flex items-start gap-4 p-4">
          <div
            role="button"
            tabIndex={0}
            aria-label={skill.name}
            onClick={open}
            onKeyDown={activate}
            className="focus-visible:outline-ring flex min-w-0 flex-1 cursor-pointer items-start gap-4 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <span
              aria-hidden
              className={cn(
                'border-border bg-surface-2 text-accent-strong inline-flex size-10 shrink-0 items-center justify-center rounded-lg border',
                !skill.enabled && 'opacity-60',
              )}
            >
              <Sparkles className="size-4" />
            </span>

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={cn(
                    'group-hover:text-accent-strong font-serif text-[0.9375rem]',
                    skill.enabled ? 'text-foreground' : 'text-muted',
                  )}
                >
                  {skill.name}
                </span>
                {!skill.enabled ? <Badge tone="neutral">{t('skills.disabled')}</Badge> : null}
                {!skill.removable ? (
                  <Badge tone="neutral">{t('skills.pluginManaged')}</Badge>
                ) : null}
                {skill.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
              </div>

              {skill.description ? (
                <p className="text-muted max-w-prose text-[0.8125rem]">{skill.description}</p>
              ) : null}

              {agents && agents.length > 0 ? (
                <div className="flex flex-wrap items-center gap-1.5">
                  {agents.map((agent) => (
                    <AgentTag key={agent.id} agent={agent} />
                  ))}
                </div>
              ) : null}

              <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[0.75rem]">
                <code className="font-mono">{shortenPath(skill.path, 4)}</code>
                {size ? <span>{size}</span> : null}
                <Timestamp createdMs={skill.createdMs} modifiedMs={skill.modifiedMs} />
              </div>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
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
            <Button variant="secondary" size="sm" onClick={open} disabled={!open}>
              {t('common.open')}
            </Button>
            {onEdit && skill.entryPath ? (
              <Tooltip content={t('configs.edit')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('configs.edit')}
                  disabled={!skill.removable}
                  onClick={() => onEdit(skill)}
                >
                  <Pencil className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
            {onDelete && skill.removable ? (
              <Tooltip content={t('skills.delete')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('skills.delete')}
                  onClick={() => onDelete(skill)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </Card>
    </SkillContextMenu>
  )
}
