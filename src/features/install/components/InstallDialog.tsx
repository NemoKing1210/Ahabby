import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Play, TriangleAlert } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { InstallAction } from '@/shared/bindings/InstallAction'
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
import { EmptyState } from '@/shared/ui/EmptyState'
import { Spinner } from '@/shared/ui/Primitives'
import { Select } from '@/shared/ui/Select'
import { toastAppError } from '@/shared/ui/Toast'

import { useInstallPlan, useRunInstall } from '../api/mutations'
import { JobConsole } from './JobConsole'

/**
 * Confirmation before anything is executed.
 *
 * The user sees the exact command line that was resolved from the agent's manifest (the
 * frontend cannot construct one), then output streams into the same dialog.
 *
 * The dialog is mounted per target and unmounted when it closes (see the callers), so all
 * of its state is naturally fresh for the next agent — no reset effect required.
 */
export function InstallDialog({
  agent,
  action,
  onOpenChange,
}: {
  agent: Agent
  action: InstallAction
  onOpenChange: () => void
}) {
  const { t } = useTranslation()
  const run = useRunInstall()
  const [methodOverride, setMethodOverride] = useState<string | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  const options = agent.installOptions
  const preferred =
    options.find((option) => option.detected && option.available) ??
    options.find((option) => option.available) ??
    options[0]
  const methodId = methodOverride ?? preferred?.id ?? null

  const plan = useInstallPlan(agent.id, action, methodId)
  const selected = options.find((option) => option.id === methodId)
  const actionLabel = t(`install.action.${action}`)
  const docsUrl = selected?.docsUrl ?? agent.installDocsUrl ?? agent.docs ?? agent.website

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
              disabled={
                !plan.data || !plan.data.managerAvailable || run.isPending || jobId !== null
              }
              onClick={() => {
                if (!plan.data) return
                run.mutate(
                  {
                    agentId: agent.id,
                    action,
                    methodId: plan.data.methodId,
                    displayCommand: plan.data.displayCommand,
                  },
                  {
                    onSuccess: (startedJobId) => setJobId(startedJobId),
                    onError: (error) => toastAppError(error),
                  },
                )
              }}
            >
              <Play className="size-3.5" aria-hidden />
              {t('install.run')}
            </Button>
          </>
        }
      >
        <DialogHeader>
          <DialogTitle>
            {jobId
              ? t('install.title')
              : t('install.confirmTitle', { action: actionLabel, agent: agent.name })}
          </DialogTitle>
          <DialogDescription>
            {action === 'uninstall' ? t('install.uninstallHint') : t('install.confirmBody')}
          </DialogDescription>
        </DialogHeader>

        <DialogBody className="flex flex-col gap-4">
          {options.length === 0 ? (
            <EmptyState title={t('install.noMethods')} />
          ) : jobId ? (
            <JobConsole jobId={jobId} />
          ) : (
            <>
              {action === 'update' ? (
                <div className="border-border bg-surface flex flex-col gap-2 rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted text-[0.8125rem]">
                      {t('install.versionInstalled')}
                    </span>
                    <code className="font-mono text-[0.75rem]">
                      {agent.version?.raw ?? t('agents.noVersion')}
                    </code>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted text-[0.8125rem]">
                      {t('install.versionLatest')}
                    </span>
                    {agent.update ? (
                      <code className="text-accent-strong font-mono text-[0.75rem]">
                        {agent.update.latest}
                      </code>
                    ) : (
                      <span className="text-faint text-[0.75rem]">
                        {t('install.versionLatestUnknown')}
                      </span>
                    )}
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted text-[0.8125rem]">{t('install.manager')}</span>
                <Select
                  ariaLabel={t('install.manager')}
                  value={methodId ?? ''}
                  onValueChange={setMethodOverride}
                  options={options.map((option) => ({
                    value: option.id,
                    label: option.available
                      ? option.id
                      : `${option.id} — ${option.unavailableReason ?? t('common.notAvailable')}`,
                  }))}
                />
                {selected?.detected ? (
                  <Badge tone="accent">{t('agents.detectedVia', { method: selected.id })}</Badge>
                ) : null}
                {selected?.manager === 'script' ? <Badge tone="warning">script</Badge> : null}
              </div>

              {plan.isLoading ? (
                <div className="text-muted flex items-center gap-2 text-[0.8125rem]">
                  <Spinner /> {t('common.loading')}
                </div>
              ) : null}

              {plan.data ? (
                <div className="flex flex-col gap-2">
                  <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                    {t('install.command')}
                  </span>
                  <code className="bg-surface-2 rounded-lg px-3 py-2 font-mono text-[0.75rem] break-all">
                    {plan.data.displayCommand}
                  </code>
                  {plan.data.managerAvailable ? null : (
                    <div className="border-border bg-surface flex items-start gap-2 rounded-lg border p-3">
                      <TriangleAlert className="text-warning-fg mt-0.5 size-4" aria-hidden />
                      <div className="flex flex-col gap-1">
                        <span className="text-foreground text-[0.8125rem]">
                          {t('install.managerMissing', { manager: plan.data.manager })}
                        </span>
                        <span className="text-muted text-[0.75rem]">
                          {t('install.managerMissingHint')}
                        </span>
                      </div>
                    </div>
                  )}
                  {plan.data.warnings.length > 0 ? (
                    <ul className="text-muted flex flex-col gap-1 text-[0.75rem]">
                      {plan.data.warnings.map((warning) => (
                        <li key={warning}>· {warning}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : null}

              {plan.error ? (
                <div className="border-border flex flex-col gap-2 rounded-lg border p-3">
                  <span className="text-foreground text-[0.8125rem]">{t('install.noMethods')}</span>
                  <span className="text-muted text-[0.75rem]">{String(plan.error)}</span>
                </div>
              ) : null}

              {docsUrl ? (
                <Button
                  variant="link"
                  size="sm"
                  className="self-start px-0"
                  onClick={() => void ipc.openUrl(docsUrl).catch(toastAppError)}
                >
                  <ExternalLink className="size-3.5" aria-hidden />
                  {t('install.docsInstead')}
                </Button>
              ) : null}
            </>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
