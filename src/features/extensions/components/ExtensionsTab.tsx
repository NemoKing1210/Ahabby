import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Puzzle } from 'lucide-react'

import type { Extension } from '@/shared/bindings/Extension'
import type { ExtensionAction } from '@/shared/bindings/ExtensionAction'
import type { ExtensionKind } from '@/shared/bindings/ExtensionKind'
import { matchesActivity, type ActivityFilter } from '@/shared/lib/activity'
import { useSessionState } from '@/shared/lib/sessionState'
import { ActivityChips } from '@/shared/ui/ActivityChips'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { EmptyState } from '@/shared/ui/EmptyState'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { DocumentEditorDialog } from '@/features/editor/components/DocumentEditorDialog'

import { useDeleteExtension, useSetExtensionEnabled } from '../api/hooks'
import { ExtensionActionDialog } from './ExtensionActionDialog'
import { ExtensionCard } from './ExtensionCard'
import { ExtensionInfoDialog } from './ExtensionInfoDialog'

/** The origins the filter offers, in display order: a package is what the user installed. */
const KIND_ORDER: ExtensionKind[] = ['package', 'local', 'builtin']

/**
 * What the list shows before the user asks for more: the packages the agent tracks.
 *
 * The modules in the extensions directory and the ones the agent ships itself are still there —
 * they are behind the type filter, not gone — because a list whose majority is things nobody
 * installed is a list nobody reads.
 */
const DEFAULT_KINDS: ExtensionKind[] = ['package']

/**
 * Extensions of one agent: the packages it tracks, the modules in its extensions directory and
 * the ones it ships itself.
 *
 * The tab is shown for every agent, but only an agent whose manifest declares an extensions
 * surface has anything to read — `supported` is what tells the two apart, so an agent with no
 * extension mechanism gets a sentence instead of a misleading empty list.
 */
export function ExtensionsTab({
  agentId,
  extensions,
  supported,
}: {
  agentId: string
  extensions: Extension[]
  /** `true` when the agent's manifest declares an extensions surface at all. */
  supported: boolean
}) {
  const { t } = useTranslation()
  const remove = useDeleteExtension()
  const toggle = useSetExtensionEnabled()
  // The dialog reads the live row out of the list the mutations refresh, so its switch never
  // shows a stale state after a successful write.
  const [infoId, setInfoId] = useState<string | null>(null)
  const info = extensions.find((extension) => extension.id === infoId) ?? null
  const [editTarget, setEditTarget] = useState<Extension | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Extension | null>(null)
  const [actionTarget, setActionTarget] = useState<{
    extension: Extension
    action: ExtensionAction
  } | null>(null)
  // Both filters are kept for the session, like the pages' own: narrowing to packages and then
  // leaving the screen must not switch the local modules back on.
  const [kinds, setKinds] = useSessionState<ExtensionKind[]>('extensions.kinds', DEFAULT_KINDS)
  const [activity, setActivity] = useSessionState<ActivityFilter>('extensions.activity', 'all')

  const toggleExtension = (extension: Extension, enabled: boolean) => {
    toggle.mutate(
      { agentId, extensionId: extension.id, enabled },
      {
        onSuccess: (result) => {
          toast.success(
            t(enabled ? 'extensions.toggledOn' : 'extensions.toggledOff', {
              name: result.data.name,
            }),
          )
        },
        onError: (error) => toastAppError(error),
      },
    )
  }

  // A package is removed through the agent's own CLI (a job the user confirms first); a local
  // module is Ahabby's own file, so it goes through the trash after its own dialog.
  const removeExtension = (extension: Extension) => {
    if (extension.kind === 'package') {
      setActionTarget({ extension, action: 'remove' })
    } else {
      setDeleteTarget(extension)
    }
  }

  if (!supported) {
    return (
      <EmptyState
        title={t('extensions.unsupported')}
        hint={t('extensions.unsupportedHint')}
        icon={Puzzle}
      />
    )
  }

  if (extensions.length === 0) {
    return <EmptyState title={t('extensions.none')} hint={t('extensions.noneHint')} icon={Puzzle} />
  }

  const ofKinds = extensions.filter((extension) => kinds.includes(extension.kind))
  const visible = ofKinds.filter((extension) => matchesActivity(extension.enabled, activity))

  // Only shown when the type filter — not the agent — is what left nothing behind, and always
  // with a way out: a filter that hides everything must not look like an empty machine.
  const clearFilters = () => {
    setKinds([...KIND_ORDER])
    setActivity('all')
  }
  const clearAction = (
    <Button variant="secondary" size="sm" onClick={clearFilters}>
      {t('extensions.clearFilters')}
    </Button>
  )

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div
            role="group"
            aria-label={t('extensions.kindLabel')}
            className="flex flex-wrap items-center gap-1.5"
          >
            <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
              {t('extensions.kindLabel')}
            </span>
            {KIND_ORDER.map((kind) => (
              <Chip
                key={kind}
                label={t(`extensions.kind.${kind}`)}
                count={extensions.filter((extension) => extension.kind === kind).length}
                active={kinds.includes(kind)}
                onClick={() =>
                  setKinds((current) =>
                    current.includes(kind)
                      ? current.filter((item) => item !== kind)
                      : [...current, kind],
                  )
                }
              />
            ))}
          </div>
          <ActivityChips items={ofKinds} value={activity} onChange={setActivity} />
        </div>

        {ofKinds.length === 0 ? (
          <EmptyState
            title={t('extensions.filteredEmpty')}
            hint={t('extensions.filteredEmptyHint')}
            icon={Puzzle}
            action={clearAction}
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title={t(activity === 'on' ? 'activity.noneOn' : 'activity.noneOff')}
            hint={t('activity.noneHint')}
            icon={Puzzle}
          />
        ) : (
          <AnimatedList>
            {visible.map((extension) => (
              <ExtensionCard
                key={extension.id}
                extension={extension}
                onInfo={(target) => setInfoId(target.id)}
                onUpdate={(target) => setActionTarget({ extension: target, action: 'update' })}
                onEdit={setEditTarget}
                onRemove={removeExtension}
                onToggle={toggleExtension}
                toggleBusy={toggle.isPending && toggle.variables?.extensionId === extension.id}
              />
            ))}
          </AnimatedList>
        )}
      </div>

      <ExtensionInfoDialog
        extension={info}
        open={info !== null}
        onOpenChange={(open) => {
          if (!open) setInfoId(null)
        }}
        onUpdate={(target) => {
          setInfoId(null)
          setActionTarget({ extension: target, action: 'update' })
        }}
        onEdit={(target) => {
          setInfoId(null)
          setEditTarget(target)
        }}
        onRemove={(target) => {
          setInfoId(null)
          removeExtension(target)
        }}
        onToggle={toggleExtension}
        toggleBusy={toggle.isPending && toggle.variables?.extensionId === info?.id}
      />

      {editTarget?.entryPath ? (
        <DocumentEditorDialog
          key={editTarget.entryPath}
          agentId={agentId}
          document={{
            path: editTarget.entryPath,
            label: editTarget.name,
            format: 'text',
            editable: true,
            description: t('extensions.editHint'),
          }}
          onOpenChange={() => setEditTarget(null)}
        />
      ) : null}

      {actionTarget ? (
        <ExtensionActionDialog
          key={`${actionTarget.extension.id}:${actionTarget.action}`}
          agentId={agentId}
          extension={actionTarget.extension}
          action={actionTarget.action}
          onOpenChange={() => setActionTarget(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title={t('extensions.removeTitle', { name: deleteTarget?.name ?? '' })}
        description={t('extensions.deleteBody', { path: deleteTarget?.path ?? '' })}
        confirmLabel={t('extensions.remove')}
        busy={remove.isPending}
        onConfirm={() => {
          if (!deleteTarget) return
          const target = deleteTarget
          remove.mutate(
            { agentId, extensionId: target.id },
            {
              onSuccess: () => {
                toast.success(t('extensions.removed', { name: target.name }))
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
    </>
  )
}
