import { useTranslation } from 'react-i18next'
import { RefreshCw, Search, X } from 'lucide-react'

import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { TagFilterRow } from '@/shared/ui/TagFilterRow'

import type { InstalledFilter } from '../installed'

/**
 * The controls above the hub: one search box, one kind filter, one installed filter, one source
 * filter, the tags.
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
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Input
          className="max-w-md min-w-56 flex-1"
          value={query}
          placeholder={t('hub.searchPlaceholder')}
          aria-label={t('hub.searchPlaceholder')}
          leading={<Search className="size-3.5" aria-hidden />}
          trailing={
            query.length > 0 ? (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t('hub.clearSearch')}
                onClick={() => onQueryChange('')}
              >
                <X className="size-3.5" />
              </Button>
            ) : null
          }
          onChange={(event) => onQueryChange(event.target.value)}
        />

        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('hub.kindFilter')}
        >
          {kinds.map((option) => (
            <Chip
              key={option.value ?? 'all'}
              label={option.label}
              active={kind === option.value}
              onClick={() => onKindChange(option.value)}
            />
          ))}
        </div>

        {/* Whether the machine already has an entry — the question the Hub is opened with, and the
            one a filter can answer without a request: the scan, not the collection, is the source
            of the answer, so this narrows what is on screen rather than what is asked for. */}
        <div
          className="flex flex-wrap items-center gap-2"
          role="group"
          aria-label={t('hub.installedFilter')}
        >
          {installedOptions.map((option) => (
            <Chip
              key={option.value}
              label={option.label}
              active={installed === option.value}
              onClick={() => onInstalledChange(option.value)}
            />
          ))}
        </div>

        {sources.length > 1 ? (
          <Select
            ariaLabel={t('hub.source')}
            className="max-w-64"
            value={sourceId}
            onValueChange={onSourceChange}
            options={[
              { value: 'all', label: t('hub.sourceAll') },
              ...sources.map((source) => ({ value: source.id, label: source.name })),
            ]}
          />
        ) : null}

        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={onRefresh}
          loading={refreshing}
        >
          {refreshing ? null : <RefreshCw className="size-3.5" aria-hidden />}
          {t('hub.refresh')}
        </Button>
      </div>

      {/* What the entries are *for*, as opposed to which collection they come from. The row is the
          shared one (`shared/ui/TagFilterRow`), exactly as the Library wears it. */}
      <TagFilterRow tags={tags} selected={selectedTags} onToggle={onToggleTag} />
    </div>
  )
}
