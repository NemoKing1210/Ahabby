import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import type { Agent } from '@/shared/bindings/Agent'
import type { InstallAction } from '@/shared/bindings/InstallAction'
import { useSessionState } from '@/shared/lib/sessionState'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { CatalogProblems } from '@/shared/ui/CatalogProblems'
import { EmptyState, ErrorState } from '@/shared/ui/EmptyState'
import { PageHeader } from '@/shared/ui/PageHeader'
import { SkeletonList } from '@/shared/ui/Primitives'
import { toastAppError } from '@/shared/ui/Toast'

import { InstallDialog } from '@/features/install/components/InstallDialog'
import { useRunAgentInTerminal } from '@/features/terminal/api/hooks'

import { useAgents, useFavoriteAgents, useToggleFavoriteAgent } from '../api/queries'
import { useScanRefresh } from '../api/scan'
import { AgentCard } from '../components/AgentCard'
import { RemoveAgentDialog } from '../components/RemoveAgentDialog'
import {
  AgentFilters,
  AGENT_FACETS,
  agentMatchesFacets,
  agentMatchesQuery,
  type AgentFacet,
  type AgentFilterCounts,
  type AgentFilterState,
  type AgentScope,
} from '../components/AgentFilters'
import { orderByFavorite } from '../lib/favorites'

const EMPTY_FILTER: AgentFilterState = { query: '', scope: 'all', facets: new Set() }

export function AgentsPage() {
  const { t } = useTranslation()
  const { data, isLoading, error, refetch } = useAgents()
  const { rescan, isScanning, scanning, landed } = useScanRefresh()
  const favoriteIds = useFavoriteAgents()
  const toggleFavorite = useToggleFavoriteAgent()
  const runInTerminal = useRunAgentInTerminal()
  // The filters are how this screen is being looked at, not a preference: `useSessionState`
  // keeps them for the length of the session, so coming back from an agent page finds the same
  // narrowed list instead of a reset one.
  const [filters, setFilters] = useSessionState<AgentFilterState>('agents.filters', EMPTY_FILTER)
  const [installTarget, setInstallTarget] = useState<{
    agent: Agent
    action: InstallAction
  } | null>(null)
  const [removeTarget, setRemoveTarget] = useState<Agent | null>(null)

  // The search box is applied first; each facet chip then counts what turning *it* on would
  // leave, i.e. the other active facets minus itself. A chip whose count reaches zero is not
  // offered at all, so a stacked selection can never silently dead-end.
  const searched = useMemo(
    () => (data?.agents ?? []).filter((agent) => agentMatchesQuery(agent, filters.query)),
    [data, filters.query],
  )

  const counts = useMemo<AgentFilterCounts>(
    () => ({
      all: searched.length,
      installed: searched.filter((agent) => agent.status === 'installed').length,
      available: searched.filter((agent) => agent.status !== 'installed').length,
      facets: Object.fromEntries(
        AGENT_FACETS.map((facet) => {
          const others = new Set(filters.facets)
          others.delete(facet.id)
          return [
            facet.id,
            searched.filter((agent) => agentMatchesFacets(agent, others) && facet.matches(agent))
              .length,
          ]
        }),
      ) as Record<AgentFacet, number>,
    }),
    [searched, filters.facets],
  )

  // Favourites come first in each section, in the order the user pinned them; the rest keep
  // the scan order (`orderByFavorite` is shared with the home page's roster).
  const favorites = useMemo(() => new Set(favoriteIds), [favoriteIds])

  const { installed, available } = useMemo(() => {
    const matching = searched.filter((agent) => agentMatchesFacets(agent, filters.facets))
    return {
      installed: orderByFavorite(
        matching.filter((agent) => agent.status === 'installed'),
        favoriteIds,
      ),
      available: orderByFavorite(
        matching.filter((agent) => agent.status !== 'installed'),
        favoriteIds,
      ),
    }
  }, [searched, filters.facets, favoriteIds])

  const query = filters.query.trim()
  const dirty = query.length > 0 || filters.scope !== 'all' || filters.facets.size > 0
  const clear = () => setFilters(EMPTY_FILTER)
  const clearAction = dirty ? (
    <Button variant="secondary" size="sm" onClick={clear}>
      {t('agents.filters.clear')}
    </Button>
  ) : undefined

  const toggleFacet = (facet: AgentFacet) =>
    setFilters((previous) => {
      const facets = new Set(previous.facets)
      if (facets.has(facet)) facets.delete(facet)
      else facets.add(facet)
      return { ...previous, facets }
    })

  /** What an empty section says: search miss, filter dead end, or genuinely nothing to show. */
  const emptyCopy = (kind: 'installed' | 'available') => {
    if (query.length > 0) return { title: t('agents.noSearchResults', { query }) }
    if (filters.facets.size > 0) return { title: t('agents.filters.noResults') }
    return kind === 'installed'
      ? { title: t('agents.empty'), hint: t('agents.emptyHint') }
      : { title: t('agents.emptyAvailable'), hint: t('agents.emptyAvailableHint') }
  }

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

  const narrowed = query.length > 0 || filters.facets.size > 0
  const sections = (
    [
      { key: 'installed' as const, title: t('agents.installed'), agents: installed },
      { key: 'available' as const, title: t('agents.available'), agents: available },
    ] as const
  )
    .filter((section) => filters.scope === 'all' || filters.scope === section.key)
    // A section the filters emptied is dropped rather than shown as an empty box, but a
    // section the catalog itself has nothing for keeps its own explanation.
    .filter((section) => section.agents.length > 0 || !narrowed)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl">{t('agents.title')}</h1>
          <p className="text-muted text-[0.8125rem]">
            {t('agents.installedCount', { count: data?.installed ?? 0 })} ·{' '}
            {t('agents.availableCount', { count: data?.availableToInstall ?? 0 })}
          </p>
        </div>
        <Button variant="secondary" onClick={rescan} loading={isScanning}>
          {isScanning ? null : <RefreshCw className="size-3.5" aria-hidden />}
          {t('agents.rescan')}
        </Button>
      </PageHeader>

      <AgentFilters
        state={filters}
        counts={counts}
        dirty={dirty}
        onQueryChange={(value) => setFilters((previous) => ({ ...previous, query: value }))}
        onScopeChange={(scope: AgentScope) => setFilters((previous) => ({ ...previous, scope }))}
        onToggleFacet={toggleFacet}
        onClear={clear}
      />

      {data ? <CatalogProblems problems={data.problems} /> : null}

      {sections.length === 0 ? (
        <EmptyState
          {...emptyCopy(filters.scope === 'available' ? 'available' : 'installed')}
          action={clearAction}
        />
      ) : (
        sections.map((section) => (
          <section key={section.key} className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg">
              {section.title}
              <Badge tone="neutral">{section.agents.length}</Badge>
            </h2>
            {section.agents.length === 0 ? (
              <EmptyState {...emptyCopy(section.key)} action={clearAction} />
            ) : (
              <AnimatedList>
                {section.agents.map((agent) => (
                  <AgentCard
                    key={agent.id}
                    agent={agent}
                    refreshing={scanning.has(agent.id)}
                    landed={landed.has(agent.id)}
                    favorite={favorites.has(agent.id)}
                    onToggleFavorite={(target) =>
                      toggleFavorite.mutate(
                        { agentId: target.id, favorite: !favorites.has(target.id) },
                        { onError: (mutationError) => toastAppError(mutationError) },
                      )
                    }
                    onInstall={(target, action) => setInstallTarget({ agent: target, action })}
                    onRemove={setRemoveTarget}
                    onRun={runInTerminal}
                  />
                ))}
              </AnimatedList>
            )}
          </section>
        ))
      )}

      {installTarget ? (
        <InstallDialog
          key={`${installTarget.agent.id}-${installTarget.action}`}
          agent={installTarget.agent}
          action={installTarget.action}
          onOpenChange={() => setInstallTarget(null)}
        />
      ) : null}

      {removeTarget ? (
        <RemoveAgentDialog
          key={removeTarget.id}
          agent={removeTarget}
          onClose={() => setRemoveTarget(null)}
          onUninstall={(agent) => {
            setRemoveTarget(null)
            setInstallTarget({ agent, action: 'uninstall' })
          }}
        />
      ) : null}
    </div>
  )
}
