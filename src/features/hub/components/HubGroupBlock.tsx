import { memo, useMemo } from 'react'

import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubSource } from '@/shared/bindings/HubSource'
import { cn } from '@/shared/lib/cn'
import { useSessionState } from '@/shared/lib/sessionState'
import { Reveal } from '@/shared/ui/Reveal'

import { isBatchable, type HubEntryGroup } from '../lib/grouping'
import { HubEntryList } from './HubEntryList'
import { HubGroupHeader } from './HubGroupHeader'

/**
 * One plugin group of a source: its foldable heading and the skill cards underneath.
 *
 * A group starts folded away — a source holds a dozen of them and the headings are what the user
 * reads first — and the ones opened are kept for the session (`useSessionState`), keyed by source
 * and group, so scrolling away and back — or switching filters and returning — finds the group as
 * it was left.
 *
 * The group is a card of the same make as a source, one level in: its heading is the strip, its
 * skills sit on the canvas inside it, and the source welds the groups into a run of their own — so
 * a collection reads the same way at every level.
 *
 * The group is memoized on its own props: a section re-renders whenever a filter, a selection or
 * the answer of its query changes, and a group whose entries are the same objects has nothing to
 * redraw but the count on its heading.
 */
export const HubGroupBlock = memo(function HubGroupBlock({
  source,
  group,
  selectedIds,
  loadingInstall,
  onView,
  onInstall,
  onRefresh,
  onToggleSelect,
  onSelectEntries,
  onDeselectEntries,
  onInstallAll,
  refreshingId,
}: {
  source: HubSource
  group: HubEntryGroup
  selectedIds: ReadonlySet<string>
  loadingInstall: boolean
  onView: (entry: HubEntry) => void
  onInstall: (entry: HubEntry) => void
  onRefresh: (entry: HubEntry) => void
  onToggleSelect: (entry: HubEntry) => void
  onSelectEntries: (entries: HubEntry[]) => void
  onDeselectEntries: (entries: HubEntry[]) => void
  /** Installs every skill the group holds, group id included — the section reads the rest. */
  onInstallAll: (groupId: string) => void
  refreshingId?: string | null
}) {
  const [opened, setOpened] = useSessionState(`hub.expanded.${source.id}.${group.id}`, false)
  const collapsed = !opened
  const selectable = useMemo(() => group.entries.filter(isBatchable), [group.entries])
  const selectedCount = selectable.filter((entry) => selectedIds.has(entry.id)).length
  const allSelected = selectable.length > 0 && selectedCount >= selectable.length

  return (
    <section
      className={cn(
        'border-border ease-warm bg-surface flex min-w-0 flex-col overflow-hidden border transition-[border-color,translate] duration-150',
        collapsed && 'hover:border-border-strong hover:-translate-y-px',
      )}
    >
      <HubGroupHeader
        groupId={group.id}
        count={group.entries.length}
        selectable={selectable.length}
        selectedCount={selectedCount}
        collapsed={collapsed}
        onToggleCollapsed={() => setOpened((value) => !value)}
        installingAll={loadingInstall}
        onSelectAll={() =>
          allSelected ? onDeselectEntries(selectable) : onSelectEntries(selectable)
        }
        onInstallAll={() => onInstallAll(group.id)}
      />
      <Reveal open={!collapsed}>
        {/* The group's skills keep the page canvas, exactly as a source's entries do — the card is
            the frame, its strip the band above them. */}
        <div className="border-border bg-background flex flex-col gap-2 border-t px-3 pt-3 pb-3">
          <HubEntryList
            entries={group.entries}
            source={source}
            selectedIds={selectedIds}
            refreshingId={refreshingId}
            onView={onView}
            onInstall={onInstall}
            onRefresh={onRefresh}
            onToggleSelect={onToggleSelect}
          />
        </div>
      </Reveal>
    </section>
  )
})
