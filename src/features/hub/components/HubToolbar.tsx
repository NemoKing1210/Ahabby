import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'

import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import {
  FilterBar,
  FilterChipGroup,
  FilterClear,
  FilterRow,
  FilterSearch,
} from '@/shared/ui/FilterBar'
import { Select } from '@/shared/ui/Select'
import { TagFilterRow } from '@/shared/ui/TagFilterRow'

import type { InstalledFilter } from '../installed'

/**
 * The controls above the hub: the search box and the source filter on the first row, the kind and
 * installed-state chips under them, the tags last — the same strip every filtered screen wears.
 *
 * There is deliberately no sort control: the order of a section is the source's own (the MCP
 * registry orders by relevance, a repository by name), and re-sorting a page the backend has not
 * finished sending would only reorder what happens to be loaded.
 */
export function HubToolbar({
  query,
  onQueryChange,
  kind,
  onKindChange,
  installed,
  onInstalledChange,
  sourceId,
  onSourceChange,
  sources,
  tags,
  selectedTags,
  onToggleTag,
  onRefresh,
  refreshing,
  dirty,
  onClear,
}: {
  query: string
  onQueryChange: (value: string) => void
  kind: HubResourceKind | null
  onKindChange: (value: HubResourceKind | null) => void
  installed: InstalledFilter
  onInstalledChange: (value: InstalledFilter) => void
  sourceId: string
  onSourceChange: (value: string) => void
  sources: HubSource[]
  /** Every tag the sources in view declare; what the Hub offers as filters. */
  tags: string[]
  selectedTags: string[]
  onToggleTag: (tag: string) => void
  onRefresh: () => void
  refreshing: boolean
  /** Whether anything is narrowing the list — shows the reset button. */
  dirty: boolean
  onClear: () => void
}) {
  const { t } = useTranslation()
  const kinds: { value: HubResourceKind | null; label: string }[] = [
    { value: null, label: t('common.all') },
    { value: 'skill', label: t('hub.kind.skill') },
    { value: 'mcp', label: t('hub.kind.mcp') },
  ]
  const installedOptions: { value: InstalledFilter; label: string }[] = [
    { value: 'all', label: t('common.all') },
    { value: 'installed', label: t('hub.installedState.installed') },
    { value: 'missing', label: t('hub.installedState.missing') },
  ]

  return (
    <FilterBar>
      <FilterRow>
        <FilterSearch
          value={query}
          onValueChange={onQueryChange}
          placeholder={t('hub.searchPlaceholder')}
          className="sm:w-72"
        />

        {sources.length > 1 ? (
          <Select
            ariaLabel={t('hub.source')}
            className="max-w-64 min-w-40"
            value={sourceId}
            onValueChange={onSourceChange}
            options={[
              { value: 'all', label: t('hub.sourceAll') },
              ...sources.map((source) => ({ value: source.id, label: source.name })),
            ]}
          />
        ) : null}

        <div className="ml-auto flex items-center gap-2">
          {dirty ? <FilterClear onClick={onClear} /> : null}
          <Button variant="secondary" size="sm" onClick={onRefresh} loading={refreshing}>
            {refreshing ? null : <RefreshCw className="size-3.5" aria-hidden />}
            {t('hub.refresh')}
          </Button>
        </div>
      </FilterRow>

      <FilterRow>
        <FilterChipGroup label={t('hub.kindFilter')}>
          {kinds.map((option) => (
            <Chip
              key={option.value ?? 'all'}
              label={option.label}
              active={kind === option.value}
              onClick={() => onKindChange(option.value)}
            />
          ))}
        </FilterChipGroup>

        {/* Whether the machine already has an entry — the question the Hub is opened with, and the
            one a filter can answer without a request: the scan, not the collection, is the source
            of the answer, so this narrows what is on screen rather than what is asked for. */}
        <FilterChipGroup label={t('hub.installedFilter')}>
          {installedOptions.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={installed === option.value}
              onClick={() => onInstalledChange(option.value)}
            />
          ))}
        </FilterChipGroup>
      </FilterRow>

      {/* What the entries are *for*, as opposed to which collection they come from. The row is the
          shared one (`shared/ui/TagFilterRow`), exactly as the Library wears it. */}
      <TagFilterRow tags={tags} selected={selectedTags} onToggle={onToggleTag} />
    </FilterBar>
  )
}
