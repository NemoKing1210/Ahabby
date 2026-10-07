import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, RefreshCw, Search, X } from 'lucide-react'

import type { HubResourceKind } from '@/shared/bindings/HubResourceKind'
import type { HubSource } from '@/shared/bindings/HubSource'
import { cn } from '@/shared/lib/cn'
import { tagColor } from '@/shared/lib/tagColor'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'

/**
 * How many tags the row shows before the rest folds away. The four collections Ahabby ships with
 * declare more than this between them, and a filter row that grows with every source would push
 * the library itself off the screen.
 */
const TAG_LIMIT = 8

/**
 * The tags the row shows while it is folded: the first few, plus every tag that is switched on.
 *
 * A filter that is on must never hide its own chip — that is the one chip that can switch it off.
 */
function foldedTags(tags: string[], selected: string[]): string[] {
  if (tags.length <= TAG_LIMIT) return tags
  const shown = tags.slice(0, TAG_LIMIT)
  for (const tag of tags.slice(TAG_LIMIT)) {
    if (selected.includes(tag)) shown.push(tag)
  }
  return shown
}

/**
 * The controls above the hub: one search box, one kind filter, one source filter, the tags.
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
  // Folded to start with: the row is the handful of subjects that are used most, and the rest is
  // one click away. It never hides a tag that is switched on (see `foldedTags`).
  const [allTags, setAllTags] = useState(false)
  const shownTags = allTags ? tags : foldedTags(tags, selectedTags)
  const foldable = tags.length > TAG_LIMIT
  const kinds: { value: HubResourceKind | null; label: string }[] = [
    { value: null, label: t('common.all') },
    { value: 'skill', label: t('hub.kind.skill') },
    { value: 'mcp', label: t('hub.kind.mcp') },
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

        <div className="flex flex-wrap items-center gap-2">
          {kinds.map((option) => (
            <Chip
              key={option.value ?? 'all'}
              label={option.label}
              active={kind === option.value}
              onClick={() => onKindChange(option.value)}
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

      {/* What the entries are *for*, as opposed to which collection they come from: several tags
          ask for an entry carrying any of them. Each tag keeps a colour of its own (hashed from
          its name), and the row stays one or two lines until the user asks for the rest. */}
      {tags.length > 0 ? (
        <div role="group" aria-label={t('hub.tagFilter')}>
          <AnimatedList grouped={false} className="flex flex-wrap items-center gap-2">
            <span key="label" className="text-faint text-[0.75rem]">
              {t('hub.tags')}
            </span>
            {shownTags.map((tag) => (
              <Chip
                key={tag}
                label={tag}
                active={selectedTags.includes(tag)}
                className="ah-tag"
                style={tagColor(tag)}
                onClick={() => onToggleTag(tag)}
              />
            ))}
            {foldable ? (
              <Button
                key="fold"
                variant="ghost"
                size="sm"
                aria-expanded={allTags}
                onClick={() => setAllTags((open) => !open)}
              >
                {allTags
                  ? t('hub.fewerTags')
                  : t('hub.moreTags', { count: tags.length - shownTags.length })}
                <ChevronDown
                  className={cn(
                    'ease-warm size-3.5 transition-transform duration-150',
                    allTags && 'rotate-180',
                  )}
                  aria-hidden
                />
              </Button>
            ) : null}
          </AnimatedList>
        </div>
      ) : null}
    </div>
  )
}
