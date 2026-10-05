import { Search, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { Input } from '@/shared/ui/Input'
import { Select, type SelectOption } from '@/shared/ui/Select'

import type { LibraryGroupMode } from '../grouping'

const GROUP_MODES: { mode: LibraryGroupMode; labelKey: string }[] = [
  { mode: 'name', labelKey: 'library.groupByName' },
  { mode: 'agent', labelKey: 'library.groupByAgent' },
]

/**
 * The library's whole filter row: search, the agent the resources belong to, and how the
 * remaining list is grouped. The grouping toggle is hidden on a tab that has its own fixed
 * grouping (the "other" resources group by kind).
 */
export function LibraryToolbar({
  query,
  onQueryChange,
  agent,
  onAgentChange,
  agentOptions,
  groupMode,
  onGroupModeChange,
  showGrouping,
  dirty,
  onClear,
}: {
  query: string
  onQueryChange: (query: string) => void
  agent: string
  onAgentChange: (agent: string) => void
  agentOptions: SelectOption[]
  groupMode: LibraryGroupMode
  onGroupModeChange: (mode: LibraryGroupMode) => void
  showGrouping: boolean
  dirty: boolean
  onClear: () => void
}) {
  const { t } = useTranslation()

  return (
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
        value={agent}
        onValueChange={onAgentChange}
        options={agentOptions}
        className="min-w-44"
      />

      {showGrouping ? (
        <>
          <span aria-hidden className="bg-border h-5 w-px shrink-0" />
          <div role="group" aria-label={t('library.groupBy')} className="flex items-center gap-1.5">
            {GROUP_MODES.map((option) => (
              <Chip
                key={option.mode}
                label={t(option.labelKey)}
                active={groupMode === option.mode}
                onClick={() => onGroupModeChange(option.mode)}
              />
            ))}
          </div>
        </>
      ) : null}

      {dirty ? (
        <Button variant="ghost" size="sm" className="ml-auto" onClick={onClear}>
          <X className="size-3.5" aria-hidden />
          {t('library.clearFilters')}
        </Button>
      ) : null}
    </div>
  )
}
