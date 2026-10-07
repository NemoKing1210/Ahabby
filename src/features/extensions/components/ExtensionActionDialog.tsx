import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Play } from 'lucide-react'

import type { Extension } from '@/shared/bindings/Extension'
import type { ExtensionAction } from '@/shared/bindings/ExtensionAction'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'
import { Spinner } from '@/shared/ui/Primitives'
import { toastAppError } from '@/shared/ui/Toast'

import { JobConsole } from '@/features/install/components/JobConsole'

import { useExtensionPlan, useRunExtensionAction } from '../api/hooks'

/**
 * Confirmation before the agent's own CLI runs for one package.
 *
 * The user sees the exact command line the backend resolved from the manifest and the last scan
 * (the frontend cannot construct one), then output streams into this same dialog through the job
 * console every install already uses — so cancellation, the `job://done` rescan and the tail of
 * the output are not reimplemented here.
 */
export function ExtensionActionDialog({
  agentId,
  extension,
  action,
  onOpenChange,
}: {
  agentId: string
  extension: Extension
  action: ExtensionAction
  onOpenChange: () => void
}) {
  const { t } = useTranslation()
  const plan = useExtensionPlan(agentId, extension.id, action)
  const run = useRunExtensionAction()
  const [jobId, setJobId] = useState<string | null>(null)

  // The job is the same machinery an install uses; only the label the console shows differs.
  const jobAction: InstallAction = action === 'update' ? 'update' : 'uninstall'

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent
        footer={
          <>
            <Button variant="ghost" onClick={onOpenChange}>
              {jobId ? t('common.close') : t('common.cancel')}
            </Button>
            <Button
              variant="primary"
              disabled={!plan.data || jobId !== null}
              loading={run.isPending}
              onClick={() => {
                if (!plan.data) return
                run.mutate(
                  {
                    agentId,
                    extensionId: extension.id,
                    action,
                    jobAction,
                    displayCommand: plan.data.displayCommand,
                  },
                  {
                    onSuccess: (startedJobId) => setJobId(startedJobId),
                    onError: (error) => toastAppError(error),
                  },
                )
              }}
            >
              {run.isPending ? null : <Play className="size-3.5" aria-hidden />}
              {t('install.run')}
            </Button>
          </>
        }
      >
        <DialogHeader>
          <DialogTitle>
            {jobId
              ? t('extensions.running', { name: extension.name })
              : t(action === 'update' ? 'extensions.updateTitle' : 'extensions.removeTitle', {
                  name: extension.name,
                })}
          </DialogTitle>
          <DialogDescription>
            {t(action === 'update' ? 'extensions.updateBody' : 'extensions.removeBody')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {jobId ? (
            <JobConsole jobId={jobId} />
          ) : plan.isLoading ? (
            <div className="text-muted flex items-center gap-2 text-[0.8125rem]">
              <Spinner /> {t('common.loading')}
            </div>
          ) : plan.data ? (
            <div className="flex flex-col gap-2">
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('extensions.command')}
              </span>
              <code className="bg-surface-2 rounded-lg px-3 py-2 font-mono text-[0.75rem] break-all">
                {plan.data.displayCommand}
              </code>
              <p className="text-muted text-[0.75rem]">{t('extensions.commandHint')}</p>
            </div>
          ) : plan.error ? (
            <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
              <span className="text-foreground text-[0.8125rem]">{t('extensions.noCommand')}</span>
              <span className="text-muted text-[0.75rem]">{String(plan.error)}</span>
            </div>
          ) : null}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
