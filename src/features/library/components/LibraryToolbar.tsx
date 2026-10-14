import { useTranslation } from 'react-i18next'

import type { ActivityFilter } from '@/shared/lib/activity'
import { ActivityChips } from '@/shared/ui/ActivityChips'
import { Chip } from '@/shared/ui/Chip'
import {
  FilterBar,
  FilterChipGroup,
  FilterClear,
  FilterRow,
  FilterSearch,
} from '@/shared/ui/FilterBar'
import { Select, type SelectOption } from '@/shared/ui/Select'
import { TagFilterRow } from '@/shared/ui/TagFilterRow'

import type { LibraryGroupMode, LibraryOrigin } from '../grouping'
import { LIBRARY_SORTS, type LibrarySort } from '../sorting'

const GROUP_MODES: { mode: LibraryGroupMode; labelKey: string }[] = [
  { mode: 'name', labelKey: 'library.groupByName' },
  { mode: 'agent', labelKey: 'library.groupByAgent' },
]

const SORT_LABEL_KEYS: Record<LibrarySort, string> = {
  name: 'library.sortNameAsc',
  'name-desc': 'library.sortNameDesc',
  newest: 'library.sortNewest',
  oldest: 'library.sortOldest',
  largest: 'library.sortLargest',
  smallest: 'library.sortSmallest',
}

/** A tab-specific refinement rendered as a chip row (transport, kind, verification, …). */
export interface LibraryFacet {
  value: string
  options: { value: string; label: string; count?: number }[]
  onChange: (value: string) => void
}

/**
 * The library's filter row: what to search, whose resources to show, where they come from,
 * how they are ordered, the tab's own chip facets and the tags its resources declare — plus
 * the grouping toggle. Every control here only narrows or orders the already-loaded report,
 * so changing one is instant.
 */
export function LibraryToolbar({
  query,
  onQueryChange,
  owner,
  onOwnerChange,
  ownerOptions,
  origin,
  onOriginChange,
  originOptions,
  sort,
  onSortChange,
  facet,
  activity,
  tagFilter,
  groupMode,
  onGroupModeChange,
  showGrouping,
  dirty,
  onClear,
}: {
  query: string
  onQueryChange: (query: string) => void
  owner: string
  onOwnerChange: (owner: string) => void
  ownerOptions: SelectOption[]
  origin: LibraryOrigin
  onOriginChange: (origin: LibraryOrigin) => void
  originOptions: SelectOption[]
  sort: LibrarySort
  onSortChange: (sort: LibrarySort) => void
  /** `null` on a tab that has no meaningful refinement (the "other" tab has kinds instead). */
  facet: LibraryFacet | null
  /**
   * The activity chip row (what is switched on / off). `null` on a tab whose resources have no
   * switch — the "other" tab is documents and rules, which are never switched off.
   */
  activity: {
    items: readonly { enabled: boolean }[]
    value: ActivityFilter
    onChange: (filter: ActivityFilter) => void
  } | null
  /**
   * The tag row (see `shared/ui/TagFilterRow`): the tags the tab's resources declare, and the ones
   * switched on. `null` on a tab whose resources never carry tags — an MCP server declares none —
   * so such a screen wears no row rather than an empty one.
   */
  tagFilter: {
    tags: string[]
    selected: string[]
    onToggle: (tag: string) => void
  } | null
  groupMode: LibraryGroupMode
  onGroupModeChange: (mode: LibraryGroupMode) => void
  showGrouping: boolean
  dirty: boolean
  onClear: () => void
}) {
  const { t } = useTranslation()
  const facetVisible = facet !== null && facet.options.length > 1

  return (
    <FilterBar data-tour="library-toolbar">
      <FilterRow>
        <FilterSearch
          value={query}
          onValueChange={onQueryChange}
          placeholder={t('library.searchPlaceholder')}
        />

        <Select
          ariaLabel={t('library.filterAgent')}
          value={owner}
          onValueChange={onOwnerChange}
          options={ownerOptions}
          className="min-w-44"
        />

        <Select
          ariaLabel={t('library.source')}
          value={origin}
          onValueChange={(value) => onOriginChange(value as LibraryOrigin)}
          options={originOptions}
          className="min-w-36"
        />

        <Select
          ariaLabel={t('library.sort')}
          value={sort}
          onValueChange={(value) => onSortChange(value as LibrarySort)}
          options={LIBRARY_SORTS.map((option) => ({
            value: option,
            label: t(SORT_LABEL_KEYS[option]),
          }))}
          className="min-w-40"
        />

        {dirty ? <FilterClear onClick={onClear} /> : null}
      </FilterRow>

      {showGrouping || activity || facetVisible ? (
        <FilterRow>
          {showGrouping ? (
            <FilterChipGroup label={t('library.groupBy')}>
              {GROUP_MODES.map((option) => (
                <Chip
                  key={option.mode}
                  label={t(option.labelKey)}
                  active={groupMode === option.mode}
                  onClick={() => onGroupModeChange(option.mode)}
                />
              ))}
            </FilterChipGroup>
          ) : null}

          {activity ? (
            <ActivityChips
              items={activity.items}
              value={activity.value}
              onChange={activity.onChange}
            />
          ) : null}

          {facetVisible && facet !== null ? (
            <FilterChipGroup label={t('library.facet')}>
              {facet.options.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  count={option.count}
                  active={facet.value === option.value}
                  onClick={() => facet.onChange(option.value)}
                />
              ))}
            </FilterChipGroup>
          ) : null}
        </FilterRow>
      ) : null}

      {/* What the resources are *for*, the way the Hub's row says it: the tags their own files
          declare, each in its own colour. A tab whose resources carry none wears no row. */}
      {tagFilter ? (
        <TagFilterRow
          tags={tagFilter.tags}
          selected={tagFilter.selected}
          onToggle={tagFilter.onToggle}
        />
      ) : null}
    </FilterBar>
  )
}
