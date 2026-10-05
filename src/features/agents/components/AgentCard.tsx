import { useTranslation } from 'react-i18next'
import { ExternalLink, FileText, Sparkles, TriangleAlert } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import { shortenPath } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

/**
 * One agent in the list. Everything shown here comes from the scan; nothing is hardcoded
 * per agent, so a new manifest automatically gets a complete card.
 */
export function AgentCard({
  agent,
  onInstall,
}: {
  agent: Agent
  onInstall: (agent: Agent, action: 'install' | 'update') => void
}) {
  const { t } = useTranslation()
  const installed = agent.status === 'installed'

  return (
    <Card className="group ease-warm hover:border-border-strong transition-colors duration-150">
      <div className="flex items-start gap-4 p-4">
        <AgentIcon id={agent.id} name={agent.name} />

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to={`/agents/${agent.id}`}
              className="text-foreground hover:text-accent-strong font-serif text-[15px]"
            >
              {agent.name}
            </Link>
            {installed ? (
              <Badge tone="neutral">{agent.version?.raw ?? t('agents.noVersion')}</Badge>
            ) : (
              <Badge tone="outline">{t('agents.notInstalled')}</Badge>
            )}
            {agent.update ? (
              <Tooltip content={t('agents.updateTo', { version: agent.update.latest })}>
                <Badge tone="accent" className="gap-1">
                  <Sparkles className="size-3" aria-hidden />
                  {t('agents.updateAvailable')}
                </Badge>
              </Tooltip>
            ) : null}
            {agent.unverified.length > 0 ? (
              <Tooltip content={t('agents.unverifiedHint')}>
                <Badge tone="warning">
                  <TriangleAlert className="size-3" aria-hidden />
                  {t('agents.unverified')}
                </Badge>
              </Tooltip>
            ) : null}
          </div>

          <p className="text-muted max-w-prose text-[13px]">{agent.description}</p>

          <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[12px]">
            {agent.binaryPath ? (
              <code className="font-mono">{shortenPath(agent.binaryPath, 3)}</code>
            ) : null}
            {agent.installedVia ? (
              <span>{t('agents.detectedVia', { method: agent.installedVia })}</span>
            ) : null}
            {agent.warnings.length > 0 ? (
              <Tooltip content={agent.warnings.join('\n')}>
                <span className="text-warning-fg">
                  {t('agents.warnings', { count: agent.warnings.length })}
                </span>
              </Tooltip>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          {agent.website ? (
            <Tooltip content={t('agents.website')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agents.website')}
                onClick={() => void ipc.openUrl(agent.website ?? '').catch(toastAppError)}
              >
                <ExternalLink className="size-3.5" />
              </Button>
            </Tooltip>
          ) : null}
          {agent.docs ? (
            <Tooltip content={t('agents.docs')}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('agents.docs')}
                onClick={() => void ipc.openUrl(agent.docs ?? '').catch(toastAppError)}
              >
                <FileText className="size-3.5" />
              </Button>
            </Tooltip>
          ) : null}

          {installed ? (
            agent.canUpdate ? (
              <Button variant="secondary" size="sm" onClick={() => onInstall(agent, 'update')}>
                {t('agents.update')}
              </Button>
            ) : (
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/agents/${agent.id}`}>{t('common.open')}</Link>
              </Button>
            )
          ) : agent.canInstall ? (
            <Button variant="primary" size="sm" onClick={() => onInstall(agent, 'install')}>
              {t('agents.install')}
            </Button>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              disabled={!agent.installDocsUrl}
              onClick={() => void ipc.openUrl(agent.installDocsUrl ?? '').catch(toastAppError)}
            >
              {t('install.docsInstead')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
