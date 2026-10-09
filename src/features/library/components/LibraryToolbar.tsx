import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ActivityFilter } from '@/shared/lib/activity'
import { ActivityChips } from '@/shared/ui/ActivityChips'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { Input } from '@/shared/ui/Input'
import { Select, type SelectOption } from '@/shared/ui/Select'

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
 * how they are ordered, and the tab's own chip facets — plus the grouping toggle. Every
 * control here only narrows or orders the already-loaded report, so changing one is instant.
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
  groupMode: LibraryGroupMode
  onGroupModeChange: (mode: LibraryGroupMode) => void
  showGrouping: boolean
  dirty: boolean
  onClear: () => void
}) {
  const { t } = useTranslation()
  const facetVisible = facet !== null && facet.options.length > 1

  return (
    <div className="flex flex-col gap-3" data-tour="library-toolbar">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          className="w-64 shrink-0"
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder={t('library.searchPlaceholder')}
          aria-label={t('common.search')}
          leading={<Search className="size-3.5" />}
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

        {dirty ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
            <X className="size-3.5" aria-hidden />
            {t('library.clearFilters')}
          </Button>
        ) : null}
      </div>

      {showGrouping || activity || facetVisible ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {showGrouping ? (
            <div
              role="group"
              aria-label={t('library.groupBy')}
              className="flex items-center gap-1.5"
            >
              <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
                {t('library.groupBy')}
              </span>
              {GROUP_MODES.map((option) => (
                <Chip
                  key={option.mode}
                  label={t(option.labelKey)}
                  active={groupMode === option.mode}
                  onClick={() => onGroupModeChange(option.mode)}
                />
              ))}
            </div>
          ) : null}

          {showGrouping && (activity !== null || facetVisible) ? (
            <span aria-hidden className="bg-border h-5 w-px shrink-0" />
          ) : null}

          {activity ? (
            <ActivityChips
              items={activity.items}
              value={activity.value}
              onChange={activity.onChange}
            />
          ) : null}

          {(showGrouping || activity !== null) && facetVisible ? (
            <span aria-hidden className="bg-border h-5 w-px shrink-0" />
          ) : null}

          {facetVisible && facet !== null ? (
            <div
              role="group"
              aria-label={t('library.facet')}
              className="flex flex-wrap items-center gap-1.5"
            >
              {facet.options.map((option) => (
                <Chip
                  key={option.value}
                  label={option.label}
                  count={option.count}
                  active={facet.value === option.value}
                  onClick={() => facet.onChange(option.value)}
                />
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
