import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Package, Sparkles } from 'lucide-react'

import type { Skill } from '@/shared/bindings/Skill'
import { shortenPath } from '@/shared/lib/format'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'

import { useDeleteSkill } from '../api/hooks'
import { SkillDetailDialog } from './SkillDetailDialog'

/** Skills of one agent. Deletion always goes through a confirmation dialog first. */
export function SkillsTab({ agentId, skills }: { agentId: string; skills: Skill[] }) {
  const { t } = useTranslation()
  const remove = useDeleteSkill()
  const [detail, setDetail] = useState<Skill | null>(null)
  const [editTarget, setEditTarget] = useState<Skill | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)

  if (skills.length === 0) {
    return <EmptyState title={t('skills.none')} hint={t('skills.noneHint')} icon={Sparkles} />
  }

  return (
    <>
      <AnimatedList>
        {skills.map((skill) => (
          <Card key={skill.id} className="flex items-start gap-3 p-4">
            <Package className="text-faint mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  className="text-foreground hover:text-accent-strong text-sm"
                  onClick={() => setDetail(skill)}
                >
                  {skill.name}
                </button>
                {!skill.removable ? (
                  <Badge tone="neutral">{t('skills.pluginManaged')}</Badge>
                ) : null}
                {skill.unverified ? <Badge tone="warning">{t('agents.unverified')}</Badge> : null}
              </div>
              {skill.description ? (
                <p className="text-muted max-w-prose text-[0.75rem]">{skill.description}</p>
              ) : null}
              <code className="text-faint font-mono text-[0.6875rem]">
                {shortenPath(skill.path, 4)}
              </code>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setDetail(skill)}>
              {t('common.open')}
            </Button>
          </Card>
        ))}
      </AnimatedList>

      <SkillDetailDialog
        skill={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetail(null)
        }}
        onEdit={(skill) => {
          setDetail(null)
          setEditTarget(skill)
        }}
        onDelete={(skill) => {
          setDetail(null)
          setDeleteTarget(skill)
        }}
      />

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('skills.deleteTitle', { name: deleteTarget?.name ?? '' })}
        description={t('skills.deleteBody', { path: deleteTarget?.path ?? '' })}
        confirmLabel={t('skills.delete')}
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          const target = deleteTarget
          remove.mutate(
            { agentId, skillId: target.id },
            {
              onSuccess: () => {
                toast.success(t('skills.deleted', { name: target.name }))
                setDeleteTarget(null)
              },
              onError: (error) => {
                toastAppError(error)
                setDeleteTarget(null)
              },
            },
          )
        }}
      />
      {editTarget?.entryPath ? (
        <DocumentEditorDialog
          key={editTarget.entryPath}
          agentId={agentId}
          document={{
            path: editTarget.entryPath,
            label: editTarget.name,
            format: 'markdown',
            editable: editTarget.removable,
            description: editTarget.description,
          }}
          onOpenChange={() => setEditTarget(null)}
        />
      ) : null}
    </>
  )
}
