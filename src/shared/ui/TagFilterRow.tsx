import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'

import { cn } from '@/shared/lib/cn'
import { tagColor } from '@/shared/lib/tagColor'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'

/**
 * How many tags the row shows before the rest folds away.
 *
 * A vocabulary of tags is as long as whatever declares them, and a filter row that grows with
 * every one of them would push the list it filters off the screen.
 */
export const TAG_LIMIT = 8

/**
 * The vocabulary with every selected tag in it: a tag that is switched on always has a chip.
 *
 * The vocabulary is a view of what is on screen, so narrowing a search can take the chip of a tag
 * that is still selected out of it — and that chip is the only way to switch it back off.
 */
export function withSelected(tags: string[], selected: string[]): string[] {
  const known = [...tags]
  for (const tag of selected) {
    if (!known.some((existing) => existing.toLowerCase() === tag.toLowerCase())) known.push(tag)
  }
  return known
}

/**
 * The tags the row shows while it is folded: the first few, plus every tag that is switched on.
 *
 * A filter that is on must never hide its own chip — that is the one chip that can switch it off.
 */
export function foldedTags(tags: string[], selected: string[]): string[] {
  if (tags.length <= TAG_LIMIT) return tags
  const shown = tags.slice(0, TAG_LIMIT)
  for (const tag of tags.slice(TAG_LIMIT)) {
    if (selected.includes(tag)) shown.push(tag)
  }
  return shown
}

/**
 * The tag row above a list: every tag the caller offers, each wearing a colour hashed out of its
 * own name (`shared/lib/tagColor`), and the ones switched on in the accent.
 *
 * A tag is a word somebody else wrote — in a collection's source file, in a `SKILL.md` — so the
 * same tag keeps one colour here, on a card and in every dialog, and the words themselves are
 * never translated: they are the same strings the entries carry, and translating one end would
 * break the only link between the two.
 *
 * Several tags at once ask for an entry carrying *any* of them, exactly as the Hub's queries do.
 * The row folds to [`TAG_LIMIT`] chips and keeps every switched-on tag in sight; a vocabulary with
 * no tags at all renders nothing, so a caller can hand the row to a screen without asking first.
 */
export function TagFilterRow({
  tags,
  selected,
  onToggle,
}: {
  /** Every tag the caller can offer, in its own order. */
  tags: string[]
  selected: string[]
  onToggle: (tag: string) => void
}) {
  const { t } = useTranslation()
  // Folded to start with: the row is the handful of subjects used most, and the rest is one click
  // away. It never hides a tag that is switched on (see `foldedTags`).
  const [allTags, setAllTags] = useState(false)
  const known = withSelected(tags, selected)
  if (known.length === 0) return null
  const shown = allTags ? known : foldedTags(known, selected)
  const foldable = known.length > TAG_LIMIT

  return (
    <div role="group" aria-label={t('tags.filter')}>
      <AnimatedList grouped={false} className="flex flex-wrap items-center gap-2">
        <span key="label" className="text-faint text-[0.75rem]">
          {t('tags.label')}
        </span>
        {shown.map((tag) => (
          <Chip
            key={tag}
            label={tag}
            active={selected.includes(tag)}
            className="ah-tag"
            style={tagColor(tag)}
            onClick={() => onToggle(tag)}
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
            {allTags ? t('tags.fewer') : t('tags.more', { count: known.length - shown.length })}
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
  )
}
