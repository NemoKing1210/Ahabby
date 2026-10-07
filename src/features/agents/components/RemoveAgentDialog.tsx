import { useTranslation } from 'react-i18next'
import { PackageX, Trash2, Undo2 } from 'lucide-react'
import type { ReactNode } from 'react'

import type { Agent } from '@/shared/bindings/Agent'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { ManagerIcon } from '@/shared/ui/ManagerIcon'
import { MANAGER_NAME_KEY } from '@/shared/ui/managerBrands'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRemoveAgent } from '../api/queries'

/** One removal choice: an explanation on the left, the action button on the right. */
function RemovalOption({
  icon,
  label,
  hint,
  command,
  action,
  danger = false,
  disabled,
  onSelect,
}: {
  icon: ReactNode
  label: string
  hint: string
  command?: string
  action: string
  danger?: boolean
  disabled: boolean
  onSelect: () => void
}) {
  return (
    <div className="border-border flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex min-w-0 items-start gap-3">
        <span className="text-muted mt-0.5 shrink-0" aria-hidden>
          {icon}
        </span>
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="text-foreground text-[0.875rem]">{label}</span>
          <span className="text-muted text-[0.75rem] leading-relaxed">{hint}</span>
          {command ? (
            <code className="bg-surface-2 text-faint rounded-md px-2 py-1 font-mono text-[0.6875rem] break-all">
              {command}
            </code>
          ) : null}
        </div>
      </div>
      <Button
        variant={danger ? 'danger' : 'secondary'}
        size="sm"
        className="shrink-0 self-start"
        disabled={disabled}
        onClick={onSelect}
      >
        {action}
      </Button>
    </div>
  )
}

/**
 * What "Remove" offers for an agent.
 *
 * Hiding is always possible and only touches Ahabby's own settings. Deleting is offered
 * only when the backend says it is possible: an agent shipped with Ahabby can be really
 * removed from the machine by running the uninstall command its manifest declares (a job,
 * with its own confirmation and live output), while an agent that came from the user
 * catalog can have that manifest moved to the OS trash.
 */
export function RemoveAgentDialog({
  agent,
  onClose,
  onUninstall,
  onRemoved,
}: {
  agent: Agent
  onClose: () => void
  /** Ask the page to open the uninstall flow (the resolved command + job console). */
  onUninstall: (agent: Agent) => void
  /** Called after the agent is hidden or its manifest is deleted, before the dialog closes. */
  onRemoved?: (agent: Agent) => void
}) {
  const { t } = useTranslation()
  const remove = useRemoveAgent()

  const uninstallable = agent.installOptions.filter((option) => option.uninstallCommand)
  const uninstallOption = uninstallable.find((option) => option.available) ?? uninstallable[0]
  const uninstallManager = uninstallable[0]?.manager
  const canUninstall = agent.canUninstall
  const canDeleteManifest = agent.removal === 'manifest'

  // Why a real deletion is not on offer — so the dialog never leaves the question hanging.
  const deleteUnavailableHint =
    uninstallable.length === 0
      ? t('agents.uninstallNoCommand')
      : t('agents.uninstallManagerMissing', {
          manager: uninstallManager ? t(MANAGER_NAME_KEY[uninstallManager]) : '',
        })

  const fail = (error: unknown) => {
    toastAppError(error)
    onClose()
  }

  const hide = () =>
    remove.mutate(
      { agentId: agent.id, mode: 'hide' },
      {
        onSuccess: () => {
          toast.success(t('agents.removedHidden', { name: agent.name }))
          onRemoved?.(agent)
          onClose()
        },
        onError: fail,
      },
    )

  const removeManifest = () =>
    remove.mutate(
      { agentId: agent.id, mode: 'delete' },
      {
        onSuccess: () => {
          toast.success(t('agents.removedDeleted', { name: agent.name }))
          onRemoved?.(agent)
          onClose()
        },
        onError: fail,
      },
    )

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent className="w-[min(560px,92vw)]">
        <DialogHeader>
          <DialogTitle>{t('agents.removeTitle', { name: agent.name })}</DialogTitle>
          <DialogDescription>{t('agents.removeChoose')}</DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-3">
          <RemovalOption
            icon={<Undo2 className="size-4" />}
            label={t('agents.removeHide')}
            hint={t('agents.removeHideHint')}
            action={t('agents.removeHideAction')}
            disabled={remove.isPending}
            onSelect={hide}
          />

          {canUninstall ? (
            <RemovalOption
              icon={
                uninstallOption ? (
                  <ManagerIcon manager={uninstallOption.manager} size="xs" />
                ) : (
                  <PackageX className="size-4" />
                )
              }
              label={t('agents.removeUninstall')}
              hint={t('agents.removeUninstallHint')}
              command={uninstallOption?.uninstallCommand ?? undefined}
              action={t('agents.removeUninstallAction')}
              danger
              disabled={remove.isPending}
              onSelect={() => {
                onClose()
                onUninstall(agent)
              }}
            />
          ) : canDeleteManifest ? (
            <RemovalOption
              icon={<Trash2 className="size-4" />}
              label={t('agents.removeDeleteManifest')}
              hint={t('agents.removeDeleteManifestHint', {
                path: agent.manifestSource.kind === 'user' ? agent.manifestSource.path : '',
              })}
              action={t('agents.removeDeleteAction')}
              danger
              disabled={remove.isPending}
              onSelect={removeManifest}
            />
          ) : (
            <div className="flex items-start gap-2">
              <Badge tone="neutral">{t('agents.removeUnavailable')}</Badge>
              <span className="text-faint text-[0.75rem] leading-relaxed">
                {deleteUnavailableHint}
              </span>
            </div>
          )}
        </DialogBody>

        <div className="border-border flex items-center justify-end border-t px-6 py-4">
          <Button variant="ghost" onClick={onClose} disabled={remove.isPending}>
            {t('common.cancel')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
