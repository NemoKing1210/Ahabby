import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw, Search, TriangleAlert } from 'lucide-react'

import type { Agent } from '@/shared/bindings/Agent'
import type { CatalogProblem } from '@/shared/bindings/CatalogProblem'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/ui/Card'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { Input } from '@/shared/ui/Input'
import { SkeletonList } from '@/shared/ui/Primitives'
import { toastAppError } from '@/shared/ui/Toast'

import { InstallDialog } from '@/features/install/components/InstallDialog'

import { useAgents, useRescan } from '../api/queries'
import { AgentCard } from '../components/AgentCard'

/** Manifests that failed to load — shown instead of silently hiding an agent. */
function CatalogProblems({ problems }: { problems: CatalogProblem[] }) {
  const { t } = useTranslation()
  const failures = problems.filter((problem) => problem.severity === 'error')
  if (failures.length === 0) return null

  return (
    <Card className="border-warning/40">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-[15px]">
          <TriangleAlert className="text-warning-fg size-4" aria-hidden />
          {t('agents.problems')}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        <p className="text-muted text-[13px]">{t('agents.problemsHint')}</p>
        <ul className="text-muted flex flex-col gap-1 font-mono text-[12px]">
          {failures.map((problem, index) => (
            <li key={`${problem.source}-${index}`} className="break-all">
              {problem.manifestId ? `${problem.manifestId}: ` : ''}
              {problem.message}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export function AgentsPage() {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useAgents()
  const rescan = useRescan()
  const [query, setQuery] = useState('')
  const [installTarget, setInstallTarget] = useState<{
    agent: Agent
    action: InstallAction
  } | null>(null)

  const { installed, available } = useMemo(() => {
    const agents = data?.agents ?? []
    const needle = query.trim().toLowerCase()
    const matches = (agent: Agent) =>
      needle.length === 0 ||
      agent.name.toLowerCase().includes(needle) ||
      agent.description.toLowerCase().includes(needle) ||
      agent.id.includes(needle)

    return {
      installed: agents.filter((agent) => agent.status === 'installed' && matches(agent)),
      available: agents.filter((agent) => agent.status !== 'installed' && matches(agent)),
    }
  }, [data, query])

  if (isLoading && !data) {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl">{t('agents.title')}</h1>
        <SkeletonList rows={4} />
      </div>
    )
  }

  if (error && !data) {
    return <ErrorState error={error} onRetry={() => void refetch()} />
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">{t('agents.title')}</h1>
          <p className="text-muted text-[13px]">
            {t('agents.installedCount', { count: data?.installed ?? 0 })} ·{' '}
            {t('agents.availableCount', { count: data?.availableToInstall ?? 0 })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            className="w-64"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('agents.searchPlaceholder')}
            aria-label={t('common.search')}
            leading={<Search className="size-3.5" />}
          />
          <Button
            variant="secondary"
            disabled={rescan.isPending}
            onClick={() => rescan.mutate(undefined, { onError: (error) => toastAppError(error) })}
          >
            <RefreshCw
              className={rescan.isPending ? 'size-3.5 animate-spin' : 'size-3.5'}
              aria-hidden
            />
            {rescan.isPending ? t('agents.rescanning') : t('agents.rescan')}
          </Button>
        </div>
      </header>

      {data ? <CatalogProblems problems={data.problems} /> : null}

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg">
          {t('agents.installed')}
          <Badge tone="neutral">{installed.length}</Badge>
        </h2>
        {installed.length === 0 ? (
          <EmptyState
            title={query.length > 0 ? t('agents.noSearchResults', { query }) : t('agents.empty')}
            hint={query.length > 0 ? undefined : t('agents.emptyHint')}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {installed.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onInstall={(target, action) => setInstallTarget({ agent: target, action })}
              />
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="flex items-center gap-2 text-lg">
          {t('agents.available')}
          <Badge tone="neutral">{available.length}</Badge>
        </h2>
        {available.length === 0 ? (
          <EmptyState
            title={
              query.length > 0 ? t('agents.noSearchResults', { query }) : t('agents.emptyAvailable')
            }
            hint={query.length > 0 ? undefined : t('agents.emptyAvailableHint')}
          />
        ) : (
          <div className="flex flex-col gap-3">
            {available.map((agent) => (
              <AgentCard
                key={agent.id}
                agent={agent}
                onInstall={(target, action) => setInstallTarget({ agent: target, action })}
              />
            ))}
          </div>
        )}
      </section>

      {installTarget ? (
        <InstallDialog
          key={`${installTarget.agent.id}-${installTarget.action}`}
          agent={installTarget.agent}
          action={installTarget.action}
          onOpenChange={() => setInstallTarget(null)}
        />
      ) : null}
    </div>
  )
}
