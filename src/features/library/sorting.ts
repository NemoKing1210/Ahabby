import type { McpServer } from '@/shared/bindings/McpServer'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import type { Skill } from '@/shared/bindings/Skill'

import type { LibraryGroup } from './grouping'

/** How the filtered library is ordered. */
export type LibrarySort = 'name' | 'name-desc' | 'newest' | 'oldest' | 'largest' | 'smallest'

export const LIBRARY_SORTS: LibrarySort[] = [
  'name',
  'name-desc',
  'newest',
  'oldest',
  'largest',
  'smallest',
]

/** The fields every sort reads. `OtherResource` names its item `label`, hence the adapters. */
export interface SortFields {
  name: string
  createdMs?: number | null
  modifiedMs?: number | null
  sizeBytes?: number | null
}

/**
 * A file with neither a creation nor a modification time still has to land somewhere, and
 * the end of the list is the honest place: unknown is not "the oldest".
 */
function byDate(a: SortFields, b: SortFields, direction: 1 | -1): number {
  const left = a.createdMs ?? a.modifiedMs ?? null
  const right = b.createdMs ?? b.modifiedMs ?? null
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return (left - right) * direction
}

function bySize(a: SortFields, b: SortFields, direction: 1 | -1): number {
  const left = a.sizeBytes ?? null
  const right = b.sizeBytes ?? null
  if (left === null) return right === null ? 0 : 1
  if (right === null) return -1
  return (left - right) * direction
}

export function compareItems(sort: LibrarySort, a: SortFields, b: SortFields): number {
  const byName = a.name.localeCompare(b.name)
  switch (sort) {
    case 'name':
      return byName
    case 'name-desc':
      return -byName
    case 'newest':
      return byDate(a, b, -1) || byName
    case 'oldest':
      return byDate(a, b, 1) || byName
    case 'largest':
      return bySize(a, b, -1) || byName
    case 'smallest':
      return bySize(a, b, 1) || byName
  }
}

export function sortItems<T>(items: T[], sort: LibrarySort, fields: (item: T) => SortFields): T[] {
  return [...items].sort((a, b) => compareItems(sort, fields(a), fields(b)))
}

/**
 * Order groups and their contents.
 *
 * Name sorts leave the grouping's own order alone — a name group is already alphabetical by
 * title, an agent group by agent name. Every other sort orders each group's items and then
 * the groups themselves by their leading item, so "newest" really does put the freshest work
 * on top.
 */
export function sortGroups<T>(
  groups: LibraryGroup<T>[],
  sort: LibrarySort,
  fields: (item: T) => SortFields,
): LibraryGroup<T>[] {
  const sorted = groups.map((group) => ({ ...group, items: sortItems(group.items, sort, fields) }))
  if (sort === 'name' || sort === 'name-desc') return sorted

  return sorted.sort((a, b) => {
    const first = a.items[0]
    const second = b.items[0]
    if (first === undefined) return 1
    if (second === undefined) return -1
    return compareItems(sort, fields(first), fields(second))
  })
}

export function skillFields(skill: Skill): SortFields {
  return skill
}

export function serverFields(server: McpServer): SortFields {
  return server
}

/** `OtherResource` calls its item `label`; everything else lines up with `SortFields`. */
export function resourceFields(resource: OtherResource): SortFields {
  return {
    name: resource.label,
    createdMs: resource.createdMs,
    modifiedMs: resource.modifiedMs,
    sizeBytes: resource.sizeBytes,
  }
}
