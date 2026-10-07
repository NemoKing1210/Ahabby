import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Agent } from '@/shared/bindings/Agent'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { Input } from '@/shared/ui/Input'

/**
 * Facets a user can stack on top of the search box. Each one is something the agent card
 * already shows as a badge or a count, so a filter never hides an invisible property.
 * Selecting several narrows the list (they are ANDed), not widens it.
 */
export const AGENT_FACETS = [
  {
    id: 'update',
    labelKey: 'agents.updateAvailable',
    matches: (agent: Agent) => agent.update !== null,
  },
  {
    id: 'unverified',
    labelKey: 'agents.unverified',
    matches: (agent: Agent) => agent.unverified.length > 0,
  },
  {
    id: 'warnings',
    labelKey: 'agents.filters.warnings',
    matches: (agent: Agent) => agent.warnings.length > 0,
  },
  {
    id: 'skills',
    labelKey: 'agents.filters.skills',
    matches: (agent: Agent) => agent.skills.length > 0,
  },
  {
    id: 'mcp',
    labelKey: 'agents.filters.mcp',
    matches: (agent: Agent) => agent.mcpServers.length > 0,
  },
] as const

export type AgentFacet = (typeof AGENT_FACETS)[number]['id']

/** Which list sections the page shows; the sections themselves already split by installed state. */
export type AgentScope = 'all' | 'installed' | 'available'

const SCOPE_LABEL_KEYS: Record<AgentScope, string> = {
  all: 'agents.filters.scopeAll',
  installed: 'agents.filters.scopeInstalled',
  available: 'agents.filters.scopeAvailable',
}

const SCOPES = Object.keys(SCOPE_LABEL_KEYS) as AgentScope[]

export interface AgentFilterState {
  query: string
  scope: AgentScope
  facets: ReadonlySet<AgentFacet>
}

export interface AgentFilterCounts {
  all: number
  installed: number
  available: number
  facets: Record<AgentFacet, number>
}

/** Search across the same fields the card renders. */
export function agentMatchesQuery(agent: Agent, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle.length === 0) return true
  return (
    agent.name.toLowerCase().includes(needle) ||
    agent.description.toLowerCase().includes(needle) ||
    agent.id.includes(needle)
  )
}

/** `true` when every active facet matches — facets stack, they do not widen. */
export function agentMatchesFacets(agent: Agent, facets: ReadonlySet<AgentFacet>): boolean {
  for (const facet of AGENT_FACETS) {
    if (facets.has(facet.id) && !facet.matches(agent)) return false
  }
  return true
}

/**
 * The list's whole filter row: search box, install-state scope and the facet chips. A facet
 * chip's count is what turning it on would leave, so a chip that cannot apply to the current
 * selection disappears instead of leading to a dead end; the reset button covers the rest.
 */
export function AgentFilters({
  state,
  counts,
  dirty,
  onQueryChange,
  onScopeChange,
  onToggleFacet,
  onClear,
}: {
  state: AgentFilterState
  counts: AgentFilterCounts
  /** Whether anything is narrowing the list — shows the reset button. */
  dirty: boolean
  onQueryChange: (query: string) => void
  onScopeChange: (scope: AgentScope) => void
  onToggleFacet: (facet: AgentFacet) => void
  onClear: () => void
}) {
  const { t } = useTranslation()
  const facets = AGENT_FACETS.filter(
    (facet) => counts.facets[facet.id] > 0 || state.facets.has(facet.id),
  )

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        className="w-56 shrink-0"
        value={state.query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder={t('agents.searchPlaceholder')}
        aria-label={t('common.search')}
        leading={<Search className="size-3.5" />}
      />

      <span aria-hidden className="bg-border h-5 w-px shrink-0" />

      <div
        role="group"
        aria-label={t('agents.filters.scope')}
        className="flex items-center gap-1.5"
      >
        {SCOPES.map((scope) => (
          <Chip
            key={scope}
            label={t(SCOPE_LABEL_KEYS[scope])}
            active={state.scope === scope}
            count={counts[scope]}
            onClick={() => onScopeChange(scope)}
          />
        ))}
      </div>

      {facets.length > 0 ? (
        <>
          <span aria-hidden className="bg-border h-5 w-px shrink-0" />
          <div role="group" aria-label={t('agents.filters.signals')}>
            <AnimatedList grouped={false} className="flex flex-wrap items-center gap-1.5">
              {facets.map((facet) => (
                <Chip
                  key={facet.id}
                  label={t(facet.labelKey)}
                  active={state.facets.has(facet.id)}
                  count={counts.facets[facet.id]}
                  onClick={() => onToggleFacet(facet.id)}
                />
              ))}
            </AnimatedList>
          </div>
        </>
      ) : null}

      {dirty ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
          <X className="size-3.5" aria-hidden />
          {t('agents.filters.clear')}
        </Button>
      ) : null}
    </div>
  )
}
