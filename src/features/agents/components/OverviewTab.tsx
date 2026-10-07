import { useTranslation } from 'react-i18next'
import { Check, FileText, FolderOpen, GitBranch, Globe, Play, RefreshCw } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import { formatDuration, shortenPath } from '@/shared/lib/format'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, KeyValue } from '@/shared/ui/Card'
import { ManagerBadge, ManagerIcon } from '@/shared/ui/ManagerIcon'
import { toastAppError } from '@/shared/ui/Toast'

import { useBrowser } from '@/features/browser/context'

import { AgentFactsCard } from './AgentFactsCard'

/**
 * "Overview": everything Ahabby knows about the agent, including which method it thinks was
 * used to install it and every command it is allowed to run.
 */
export function OverviewTab({
  agent,
  onInstall,
}: {
  agent: Agent
  onInstall: (agent: Agent, action: InstallAction) => void
}) {
  const { t } = useTranslation()
  const browser = useBrowser()
  const installed = agent.status === 'installed'
  // The method the scan recognised the install by, so its own manager can mark the row.
  const installedViaOption = agent.installOptions.find((option) => option.id === agent.installedVia)

  return (
    <div className="flex flex-col gap-5">
      <div className="ah-card-stack">
        <Card className="flex flex-col gap-4 p-5">
          <div className="flex flex-col gap-1.5">
            <h3 className="text-[0.9375rem]">{t('agent.overview.about')}</h3>
            <p className="text-muted max-w-prose text-[0.8125rem]">{agent.description}</p>
          </div>

          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <KeyValue label={t('agent.overview.vendor')}>
              {agent.vendor ?? <span className="text-muted">{t('common.unknown')}</span>}
            </KeyValue>
            <KeyValue label={t('agent.overview.category')}>
              {agent.category ? (
                t(`agent.category.${agent.category}`, { defaultValue: agent.category })
              ) : (
                <span className="text-muted">{t('common.unknown')}</span>
              )}
            </KeyValue>
          </dl>

          {agent.website || agent.docs || agent.github ? (
            <div className="flex flex-wrap gap-2">
              {agent.website ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => browser.open(agent.website ?? '')}
                >
                  <Globe className="size-3.5" aria-hidden />
                  {t('agents.website')}
                </Button>
              ) : null}
              {agent.docs ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => browser.open(agent.docs ?? '')}
                >
                  <FileText className="size-3.5" aria-hidden />
                  {t('agents.docs')}
                </Button>
              ) : null}
              {agent.github ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => browser.open(`https://github.com/${agent.github ?? ''}`)}
                >
                  <GitBranch className="size-3.5" aria-hidden />
                  {t('agent.overview.repository')}
                </Button>
              ) : null}
            </div>
          ) : null}

          {agent.features.length > 0 ? (
            <div className="flex flex-col gap-2">
              <h4 className="text-[0.8125rem] font-medium">{t('agent.overview.features')}</h4>
              <AnimatedList
                as="ul"
                grouped={false}
                className="text-muted flex flex-col gap-1.5 text-[0.8125rem]"
              >
                {agent.features.map((feature) => (
                  <div key={feature} className="flex items-start gap-2">
                    <Check className="text-accent-strong mt-0.5 size-3.5 shrink-0" aria-hidden />
                    {feature}
                  </div>
                ))}
              </AnimatedList>
            </div>
          ) : null}
        </Card>

        <AgentFactsCard agent={agent} />

        <Card className="p-5">
          <dl className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
            <KeyValue label={t('agent.overview.status')}>
              {installed ? (
                <Badge tone="success" dot="success">
                  {t('agents.installed')}
                </Badge>
              ) : (
                <Badge tone="neutral" dot="neutral">
                  {t('agents.notInstalled')}
                </Badge>
              )}
            </KeyValue>

            <KeyValue label={t('agent.overview.version')}>
              {agent.version ? (
                <span className="flex items-center gap-2">
                  <code className="font-mono">{agent.version.raw}</code>
                  {agent.update ? (
                    <Badge tone="accent">
                      {t('agents.updateTo', { version: agent.update.latest })}
                    </Badge>
                  ) : null}
                </span>
              ) : (
                <span className="text-muted">{t('agents.noVersion')}</span>
              )}
            </KeyValue>

            <KeyValue label={t('agent.overview.binary')} mono>
              {agent.binaryPath ?? <span className="text-muted">{t('agents.notInstalled')}</span>}
            </KeyValue>

            <KeyValue label={t('agent.overview.foundIn')}>
              {agent.foundIn === 'path' || agent.foundIn === 'the system PATH'
                ? t('agent.overview.foundInPath')
                : (agent.foundIn ?? t('common.unknown'))}
            </KeyValue>

            <KeyValue label={t('agent.overview.installedVia')}>
              {agent.installedVia ? (
                <span className="flex items-center gap-2">
                  {installedViaOption ? (
                    <ManagerIcon manager={installedViaOption.manager} size="xs" />
                  ) : null}
                  <span>{agent.installedVia}</span>
                </span>
              ) : (
                <span className="text-muted">{t('common.unknown')}</span>
              )}
            </KeyValue>

            <KeyValue label={t('agent.overview.manifest')}>
              {agent.manifestSource.kind === 'builtin'
                ? t('agent.overview.manifestBuiltin')
                : t('agent.overview.manifestUser', { path: agent.manifestSource.path })}
            </KeyValue>
          </dl>

          {agent.binaryPath ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => void ipc.revealPath(agent.binaryPath ?? '').catch(toastAppError)}
              >
                <FolderOpen className="size-3.5" aria-hidden />
                {t('common.reveal')}
              </Button>
            </div>
          ) : null}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h3 className="text-[0.9375rem]">{t('agent.overview.installOptions')}</h3>
          {agent.installOptions.length === 0 ? (
            <p className="text-muted text-[0.8125rem]">{t('install.noMethods')}</p>
          ) : (
            <AnimatedList as="ul" grouped={false} className="flex flex-col gap-2">
              {agent.installOptions.map((option) => (
                <div
                  key={option.id}
                  className="border-border flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2"
                >
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-foreground text-[0.8125rem]">{option.id}</span>
                      <ManagerBadge manager={option.manager} />
                      {option.detected ? (
                        <Badge tone="accent">
                          {t('agents.detectedVia', { method: option.manager })}
                        </Badge>
                      ) : null}
                      {!option.available ? (
                        <Badge tone="neutral">
                          {option.unavailableReason ?? t('common.notAvailable')}
                        </Badge>
                      ) : null}
                    </div>
                    <code className="text-faint font-mono text-[0.6875rem] break-all">
                      {shortenPath(option.command, 8)}
                    </code>
                  </div>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!option.available}
                    onClick={() => onInstall(agent, installed ? 'update' : 'install')}
                  >
                    {installed ? (
                      <RefreshCw className="size-3.5" aria-hidden />
                    ) : (
                      <Play className="size-3.5" aria-hidden />
                    )}
                    {installed ? t('agents.update') : t('agents.install')}
                  </Button>
                </div>
              ))}
            </AnimatedList>
          )}
          {agent.installDocsUrl ? (
            <Button
              variant="link"
              size="sm"
              className="self-start px-0"
              onClick={() => browser.open(agent.installDocsUrl ?? '')}
            >
              {t('install.docsInstead')}
            </Button>
          ) : null}
        </Card>

        {agent.warnings.length > 0 ? (
          <Card className="flex flex-col gap-2 p-5">
            <h3 className="text-[0.9375rem]">{t('agent.overview.warnings')}</h3>
            <AnimatedList
              as="ul"
              grouped={false}
              className="text-muted flex flex-col gap-1 font-mono text-[0.75rem]"
            >
              {agent.warnings.map((warning) => (
                <div key={warning} className="break-all">
                  · {warning}
                </div>
              ))}
            </AnimatedList>
          </Card>
        ) : null}

        {agent.unverified.length > 0 || agent.notes ? (
          <Card className="flex flex-col gap-2 p-5">
            <h3 className="text-[0.9375rem]">
              {agent.unverified.length > 0 ? t('agents.unverified') : t('agent.overview.notes')}
            </h3>
            {agent.unverified.length > 0 ? (
              <AnimatedList
                as="ul"
                grouped={false}
                className="text-warning-fg flex flex-col gap-1 font-mono text-[0.75rem]"
              >
                {agent.unverified.map((field) => (
                  <div key={field}>{field}</div>
                ))}
              </AnimatedList>
            ) : null}
            {agent.unverified.length > 0 ? (
              <p className="text-muted text-[0.75rem]">{t('agents.unverifiedHint')}</p>
            ) : null}
            {agent.notes ? (
              <p className="text-muted text-[0.75rem] whitespace-pre-line">{agent.notes}</p>
            ) : null}
          </Card>
        ) : null}
      </div>

      <p className="text-faint text-[0.75rem]">
        {t('agent.overview.scanTime', {
          duration: formatDuration(agent.scanMs) ?? '—',
        })}
      </p>
    </div>
  )
}
