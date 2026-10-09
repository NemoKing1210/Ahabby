import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncItemRef } from '@/shared/bindings/SyncItemRef'
import type { SyncItemStatus } from '@/shared/bindings/SyncItemStatus'
import type { SyncKind } from '@/shared/bindings/SyncKind'

/**
 * The kinds cloud sync actually carries, in the order the pickers show them.
 *
 * Mirrors `SyncKind::SYNCABLE` in `src-tauri/src/domain/sync.rs` — the files an agent page shows:
 * a config (a `.env` included), a skill and an MCP config file. The rest of the enum survives in
 * the backend for reading an older document, but nothing derives or offers them.
 */
export const SYNC_KINDS: SyncKind[] = ['config', 'env', 'skill', 'mcp']

/**
 * The tone a local item's state is painted with.
 *
 * A state, not a label: the three interesting ones (changed, saved, gone) have to keep the same
 * colour wherever an item is shown — a card, a row, the agent's own tab.
 */
export function statusTone(status: SyncItemStatus): 'neutral' | 'success' | 'warning' | 'danger' {
  switch (status) {
    case 'synced':
      return 'success'
    case 'modified':
      return 'warning'
    case 'missing':
      return 'danger'
    default:
      return 'neutral'
  }
}

/**
 * How a command addresses one local item.
 *
 * The shape the backend accepts is `{ ownerId, itemId }` and nothing else — it re-derives every
 * path from the scan — so building it is a named contract, not a rename.
 */
export function itemRef(item: SyncItem): SyncItemRef {
  return { ownerId: item.ownerId, itemId: item.id }
}
