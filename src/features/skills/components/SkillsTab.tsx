import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Sparkles } from 'lucide-react'

import type { Skill } from '@/shared/bindings/Skill'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'

import { useDeleteSkill } from '../api/hooks'
import { SkillCard } from './SkillCard'
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
          <SkillCard
            key={skill.id}
            skill={skill}
            onOpen={setDetail}
            onEdit={setEditTarget}
            onDelete={setDeleteTarget}
          />
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
