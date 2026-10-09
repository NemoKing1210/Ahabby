import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Sparkles } from 'lucide-react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Skill } from '@/shared/bindings/Skill'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { useSessionState } from '@/shared/lib/sessionState'
import { ActivityChips } from '@/shared/ui/ActivityChips'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'
import { CloudItemAction, useCloudActions } from '@/features/sync/components/CloudActions'
import { CloudOnlyCard } from '@/features/sync/components/CloudOnlyCard'

import { useDeleteSkill, useSetSkillEnabled } from '../api/hooks'
import { CreateSkillDialog } from './CreateSkillDialog'
import { SkillCard } from './SkillCard'
import { SkillDetailDialog } from './SkillDetailDialog'

/**
 * Skills of one agent. Deletion always goes through a confirmation dialog first.
 *
 * `owner` is present only when the agent can hold a new skill (it is installed): the tab then
 * offers creating one, in the manifest's own skills directory.
 */
export function SkillsTab({
  agentId,
  skills,
  owner,
}: {
  agentId: string
  skills: Skill[]
  owner?: AgentRef | null
}) {
  const { t } = useTranslation()
  const remove = useDeleteSkill()
  const toggle = useSetSkillEnabled()
  // The cloud actions of this owner, when the page mounted a provider: null on a page that did
  // not (the tab then shows the skills exactly as it always did).
  const cloud = useCloudActions()
  // Copies the account holds and this machine does not: still shown, so a fresh machine can pull
  // a skill it never had.
  const cloudSkills = cloud?.cloudOnly(['skill']) ?? []
  // The dialog carries a switch, so it keeps the id and reads the live skill out of the list
  // the mutation refreshes: a snapshot would leave that switch showing a stale state.
  const [detailId, setDetailId] = useState<string | null>(null)
  const detail = skills.find((skill) => skill.id === detailId) ?? null
  const [editTarget, setEditTarget] = useState<Skill | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Skill | null>(null)
  // Which half of the list is looked at is kept for the session, like the pages' own filters: an
  // agent page, a project and the next agent all narrow the same tab.
  const [activity, setActivity] = useSessionState<ActivityFilter>('skills.activity', 'all')
  const [createOpen, setCreateOpen] = useState(false)
  const createButton = owner ? (
    <Button variant="secondary" size="sm" onClick={() => setCreateOpen(true)}>
      <Plus className="size-3.5" aria-hidden />
      {t('skills.create')}
    </Button>
  ) : null

  // Every card carries a switch, so the list can be narrowed to what is on or off — the state
  // is on the scanned skill itself, nothing to remember here.
  const visible = skills.filter((skill) => matchesActivity(skill.enabled, activity))

  const toggleSkill = (skill: Skill, enabled: boolean) => {
    toggle.mutate(
      { agentId, skillId: skill.id, enabled },
      {
        onSuccess: (result) => {
          toast.success(
            t(enabled ? 'skills.toggledOn' : 'skills.toggledOff', { name: result.data.name }),
          )
        },
        onError: (error) => toastAppError(error),
      },
    )
  }

  if (skills.length === 0 && cloudSkills.length === 0) {
    return (
      <>
        <EmptyState
          title={t('skills.none')}
          hint={owner ? t('skills.noneHintCreate') : t('skills.noneHint')}
          icon={Sparkles}
          action={createButton}
        />
        {createOpen && owner ? (
          <CreateSkillDialog owners={[owner]} onClose={() => setCreateOpen(false)} />
        ) : null}
      </>
    )
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <ActivityChips items={skills} value={activity} onChange={setActivity} />
          {createButton}
        </div>
        {visible.length === 0 && cloudSkills.length === 0 ? (
          <EmptyState
            title={t(activity === 'on' ? 'activity.noneOn' : 'activity.noneOff')}
            hint={t('activity.noneHint')}
            icon={Sparkles}
          />
        ) : (
          <AnimatedList>
            {visible.map((skill) => {
              const item = cloud?.itemAt(skill.path)
              return (
                <SkillCard
                  key={skill.id}
                  skill={skill}
                  onOpen={(skill) => setDetailId(skill.id)}
                  onEdit={setEditTarget}
                  onDelete={setDeleteTarget}
                  onToggle={toggleSkill}
                  toggleBusy={toggle.isPending && toggle.variables?.skillId === skill.id}
                  cloudAction={item ? <CloudItemAction item={item} /> : undefined}
                />
              )
            })}
            {cloudSkills.map((copy) => (
              <CloudOnlyCard key={copy.remoteId} remote={copy} />
            ))}
          </AnimatedList>
        )}
      </div>

      {createOpen && owner ? (
        <CreateSkillDialog owners={[owner]} onClose={() => setCreateOpen(false)} />
      ) : null}

      <SkillDetailDialog
        skill={detail}
        open={detail !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null)
        }}
        onEdit={(skill) => {
          setDetailId(null)
          setEditTarget(skill)
        }}
        onDelete={(skill) => {
          setDetailId(null)
          setDeleteTarget(skill)
        }}
        onToggle={toggleSkill}
        toggleBusy={toggle.isPending && toggle.variables?.skillId === detail?.id}
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
