import { useTranslation } from 'react-i18next'
import {
  Boxes,
  ExternalLink,
  FileCog,
  FileText,
  Network,
  Server,
  Sparkles,
  Star,
  Terminal,
  Trash2,
  TriangleAlert,
} from 'lucide-react'
import { Link } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import { cn } from '@/shared/lib/cn'
import { shortenPath } from '@/shared/lib/format'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { toastAppError } from '@/shared/ui/Toast'
import { Tooltip } from '@/shared/ui/Tooltip'

import { AgentContextMenu } from './AgentContextMenu'

/**
 * One agent in the list. Everything shown here comes from the scan; nothing is hardcoded
 * per agent, so a new manifest automatically gets a complete card.
 *
 * Clicking anywhere on the icon/title/description area opens the agent's own page; the
 * action column (website, docs, install/update) sits outside that link so a click there
 * never navigates.
 */
export function AgentCard({
  agent,
  onInstall,
  onRemove,
  onRun,
  favorite = false,
  onToggleFavorite,
  refreshing = false,
  landed = false,
}: {
  agent: Agent
  onInstall: (agent: Agent, action: 'install' | 'update') => void
  /** When given, the card offers to remove the agent from Ahabby. */
  onRemove?: (agent: Agent) => void
  /** When given, an installed agent can be started in the configured terminal. */
  onRun?: (agent: Agent) => void
  /** Whether the agent is pinned to the top of the list and into the sidebar. */
  favorite?: boolean
  /** When given, the card offers a star toggle that pins the agent. */
  onToggleFavorite?: (agent: Agent) => void
  /** This agent is being re-inspected right now (the scan sweep). */
  refreshing?: boolean
  /** Fresh data just arrived for this agent (the landing highlight). */
  landed?: boolean
}) {
  const { t } = useTranslation()
  const installed = agent.status === 'installed'

  return (
    <AgentContextMenu
      agent={agent}
      onInstall={onInstall}
      onRemove={onRemove}
      onRun={onRun}
      favorite={favorite}
      onToggleFavorite={onToggleFavorite}
    >
      <Card
        className={cn(
          'group ease-warm hover:border-border-strong relative overflow-hidden transition-[border-color,translate] duration-150 hover:-translate-y-px',
          landed && 'ah-scan-landed',
        )}
      >
        {refreshing ? <span aria-hidden className="ah-scan-line" /> : null}
        <div className="flex items-start gap-4 p-4">
          <Link
            to={`/agents/${agent.id}`}
            aria-label={agent.name}
            className="focus-visible:outline-ring flex min-w-0 flex-1 items-start gap-4 rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            <AgentIcon name={agent.name} icon={agent.icon} />

            <div className="flex min-w-0 flex-1 flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-foreground group-hover:text-accent-strong font-serif text-[0.9375rem]">
                  {agent.name}
                </span>
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

              <p className="text-muted max-w-prose text-[0.8125rem]">{agent.description}</p>

              <div className="text-faint flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-[0.75rem]">
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
                {agent.facts.some((fact) => fact.kind === 'proxy') ? (
                  <span className="inline-flex items-center gap-1">
                    <Network className="size-3" aria-hidden />
                    {t('agents.card.proxy')}
                  </span>
                ) : null}
                {agent.skills.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Sparkles className="size-3" aria-hidden />
                    {t('agents.card.skills', { count: agent.skills.length })}
                  </span>
                ) : null}
                {agent.mcpServers.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Server className="size-3" aria-hidden />
                    {t('agents.card.mcp', { count: agent.mcpServers.length })}
                  </span>
                ) : null}
                {agent.configs.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <FileCog className="size-3" aria-hidden />
                    {t('agents.card.configs', { count: agent.configs.length })}
                  </span>
                ) : null}
                {agent.other.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    <Boxes className="size-3" aria-hidden />
                    {t('agents.card.other', { count: agent.other.length })}
                  </span>
                ) : null}
              </div>
            </div>
          </Link>

          <div className="flex shrink-0 items-center gap-1.5">
            {onRun && installed ? (
              <Tooltip content={t('agents.runInTerminal')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('agents.runInTerminal')}
                  onClick={() => onRun(agent)}
                >
                  <Terminal className="size-3.5" aria-hidden />
                </Button>
              </Tooltip>
            ) : null}
            {onToggleFavorite ? (
              <Tooltip content={favorite ? t('agents.unfavorite') : t('agents.favorite')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={favorite ? t('agents.unfavorite') : t('agents.favorite')}
                  onClick={() => onToggleFavorite(agent)}
                >
                  <Star
                    className={cn('size-3.5', favorite && 'text-accent-strong fill-current')}
                    aria-hidden
                  />
                </Button>
              </Tooltip>
            ) : null}
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
              ) : null
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

            {onRemove ? (
              <Tooltip content={t('agents.remove')}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('agents.remove')}
                  onClick={() => onRemove(agent)}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </Tooltip>
            ) : null}
          </div>
        </div>
      </Card>
    </AgentContextMenu>
  )
}
