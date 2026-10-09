import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { RemoteItem } from '@/shared/bindings/RemoteItem'
import type { SyncContentSide } from '@/shared/bindings/SyncContentSide'
import type { SyncItem } from '@/shared/bindings/SyncItem'
import type { SyncKind } from '@/shared/bindings/SyncKind'

/**
 * What the file reader was opened on.
 *
 * One shape for both sides and both surfaces: an item here and its cloud copy are the same thing
 * seen from two ends, and whichever end the user clicked decides the side it opens on.
 */
export interface SyncViewTarget {
  owner: AgentRef
  ownerId: string
  name: string
  kind: SyncKind
  /** The item of this machine, when it holds one. */
  itemId: string | null
  /** The cloud copy, when there is one. */
  remoteId: string | null
  /** The side the reader opens on. */
  side: SyncContentSide
}

/** What the comparison was opened on — it always compares one cloud copy against one owner. */
export interface SyncCompareTarget {
  remoteId: string
  ownerId: string
  owner: AgentRef
  name: string
}

/** The reader, opened on an item of this machine. */
export function viewOfLocal(item: SyncItem, owner: AgentRef): SyncViewTarget {
  return {
    owner,
    ownerId: item.ownerId,
    name: item.label,
    kind: item.kind,
    itemId: item.id,
    remoteId: item.remoteId ?? null,
    side: 'local',
  }
}

/** The reader, opened on a cloud copy — with the local item's id when this machine holds it too. */
export function viewOfRemote(
  item: RemoteItem,
  owner: AgentRef,
  localItemId: string | null,
): SyncViewTarget {
  return {
    owner,
    ownerId: item.ownerId,
    name: item.label || item.name,
    kind: item.kind,
    itemId: localItemId,
    remoteId: item.remoteId,
    side: 'remote',
  }
}

/**
 * The comparison of one cloud copy against the owner it would be restored into.
 *
 * Built from the two ids and a display name rather than from a row, because the comparison can be
 * opened from either end: the local item knows its copy's id, and the copy knows its own.
 */
export function compareOf(
  remoteId: string,
  ownerId: string,
  owner: AgentRef,
  name: string,
): SyncCompareTarget {
  return { remoteId, ownerId, owner, name }
}
