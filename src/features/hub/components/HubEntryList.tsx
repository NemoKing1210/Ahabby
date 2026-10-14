import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubSource } from '@/shared/bindings/HubSource'
import { useLazyRows } from '@/shared/lib/lazyRows'
import { AnimatedList } from '@/shared/ui/AnimatedList'

import { HubEntryCard } from './HubEntryCard'

/**
 * A run of entry cards, mounted a batch at a time.
 *
 * Every list of entries in the Hub goes through here — the flat list of a source and the skills of
 * one plugin group — so a long collection costs the same in either place. `useLazyRows` decides how
 * many rows are mounted, and `entries` is what tells it the list on screen is a different one
 * (another filter, another query) so the batches start over; the cards themselves are memoized, so
 * a click on one checkbox repaints that card and nothing else.
 */
export function HubEntryList({
  entries,
  source,
  selectedIds,
  refreshingId,
  onView,
  onInstall,
  onRefresh,
  onToggleSelect,
}: {
  /** The entries to show, in order. */
  entries: HubEntry[]
  source: HubSource
  selectedIds: ReadonlySet<string>
  /** The entry whose collection is being re-read right now, if any. */
  refreshingId?: string | null
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  onToggleSelect: (entry: HubEntry) => void
}) {
  const { count, sentinelRef } = useLazyRows(entries.length, { resetKey: entries })

  return (
    <>
      <AnimatedList>
        {entries.slice(0, count).map((entry) => (
          <HubEntryCard
            key={entry.id}
            entry={entry}
            source={source}
            onView={onView}
            onInstall={onInstall}
            onRefresh={onRefresh}
            refreshing={refreshingId === entry.id}
            selected={selectedIds.has(entry.id)}
            onToggleSelect={onToggleSelect}
          />
        ))}
      </AnimatedList>
      {/* The marker the next batch is watched through. It sits outside the card group, so it can
          never take part in the corners a group keeps for its exposed ends. */}
      {count < entries.length ? (
        <div ref={sentinelRef} className="h-px w-full" aria-hidden />
      ) : null}
    </>
  )
}
