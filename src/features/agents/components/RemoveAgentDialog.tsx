import { useTranslation } from 'react-i18next'

import type { Agent } from '@/shared/bindings/Agent'
import { ConfirmDialog } from '@/shared/ui/ConfirmDialog'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRemoveAgent } from '../api/queries'

/**
 * Confirmation for removing an agent from Ahabby.
 *
 * What actually happens depends on where the manifest came from — the backend reports it as
 * `agent.removal`, so the dialog promises exactly one thing: a user-catalog manifest is moved
 * to the OS trash, a shipped agent is hidden and can be brought back from Settings.
 */
export function RemoveAgentDialog({
  agent,
  onClose,
  onRemoved,
}: {
  agent: Agent
  onClose: () => void
  /** Called after the agent is actually gone, before the dialog closes. */
  onRemoved?: (agent: Agent) => void
}) {
  const { t } = useTranslation()
  const remove = useRemoveAgent()
  const deletesManifest = agent.removal === 'manifest'
  const manifestPath = agent.manifestSource.kind === 'user' ? agent.manifestSource.path : ''

  return (
    <ConfirmDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
      title={t('agents.removeTitle', { name: agent.name })}
      description={
        deletesManifest
          ? t('agents.removeBodyManifest', { path: manifestPath })
          : t('agents.removeBodyHidden')
      }
      confirmLabel={deletesManifest ? t('agents.removeDelete') : t('agents.remove')}
      busy={remove.isPending}
      onConfirm={() => {
        remove.mutate(agent.id, {
          onSuccess: (result) => {
            toast.success(
              t(result.data.deleted ? 'agents.removedDeleted' : 'agents.removedHidden', {
                name: agent.name,
              }),
            )
            onRemoved?.(agent)
            onClose()
          },
          onError: (error) => {
            toastAppError(error)
            onClose()
          },
        })
      }}
    />
  )
}
