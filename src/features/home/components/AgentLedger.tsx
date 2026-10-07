import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import type { Agent } from '@/shared/bindings/Agent'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { EmptyState } from '@/shared/ui/EmptyState'

/**
 * The machine's roster: one row per installed agent — brand mark, name, the version its CLI
 * reported. This is the one thing only this app can show, so it is the page's centrepiece;
 * the rows stay quiet (no colour, no ornament) and the marks carry the identity.
 */
export function AgentLedger({ agents }: { agents: Agent[] }) {
  const { t } = useTranslation()

  if (agents.length === 0) {
    return (
      <EmptyState
        title={t('home.noAgents')}
        hint={t('home.noAgentsHint')}
        action={
          <Button variant="secondary" size="sm" asChild>
            <Link to="/agents">{t('home.browseAgents')}</Link>
          </Button>
        }
      />
    )
  }

  return (
    <AnimatedList as="ul" grouped={false} className="grid gap-2 sm:grid-cols-2">
      {agents.map((agent) => (
        <Link
          key={agent.id}
          to={`/agents/${agent.id}`}
          className="group border-border bg-surface hover:border-border-strong hover:bg-surface-2 ease-warm flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors duration-150"
        >
          <AgentIcon name={agent.name} icon={agent.icon} size="sm" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-[0.875rem]">{agent.name}</span>
            <span className="text-faint truncate font-mono text-[0.6875rem]">
              {agent.version?.raw ?? t('agents.noVersion')}
            </span>
          </span>
          {agent.update ? (
            <Badge tone="accent" title={t('agents.updateTo', { version: agent.update.latest })}>
              {t('agents.updateAvailable')}
            </Badge>
          ) : null}
          <ChevronRight
            aria-hidden
            className="text-faint size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      ))}
    </AnimatedList>
  )
}
