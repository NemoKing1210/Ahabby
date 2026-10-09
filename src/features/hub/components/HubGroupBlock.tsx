import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubSource } from '@/shared/bindings/HubSource'
import { useSessionState } from '@/shared/lib/sessionState'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Reveal } from '@/shared/ui/Reveal'

import { isBatchable, type HubEntryGroup } from '../lib/grouping'
import { HubEntryCard } from './HubEntryCard'
import { HubGroupHeader } from './HubGroupHeader'

/**
 * One plugin group of a source: its foldable heading and the skill cards underneath.
 *
 * Collapse is kept for the session (`useSessionState`), keyed by source and group, so scrolling
 * away and back — or switching filters and returning — finds the group as it was left.
 */
export function HubGroupBlock({
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
  onInstallAll: () => void
  refreshingId?: string | null
}) {
  const [collapsed, setCollapsed] = useSessionState(`hub.collapsed.${source.id}.${group.id}`, false)
  const selectable = group.entries.filter(isBatchable)
  const selectedCount = selectable.filter((entry) => selectedIds.has(entry.id)).length
  const allSelected = selectable.length > 0 && selectedCount >= selectable.length

  return (
    <div className="flex flex-col gap-2">
      <HubGroupHeader
        groupId={group.id}
        count={group.entries.length}
        selectable={selectable.length}
        selectedCount={selectedCount}
        collapsed={collapsed}
        onToggleCollapsed={() => setCollapsed((value) => !value)}
        installingAll={loadingInstall}
        onSelectAll={() =>
          allSelected ? onDeselectEntries(selectable) : onSelectEntries(selectable)
        }
        onInstallAll={onInstallAll}
      />
      <Reveal open={!collapsed}>
        <AnimatedList>
          {group.entries.map((entry) => (
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
      </Reveal>
    </div>
  )
}
