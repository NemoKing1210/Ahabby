import { describe, expect, it } from 'vitest'

import type { LibraryGroup } from './grouping'
import { sortGroups, sortItems, type SortFields } from './sorting'

function at(
  name: string,
  created: number | null = null,
  modified: number | null = null,
  size: number | null = null,
): SortFields {
  return { name, createdMs: created, modifiedMs: modified, sizeBytes: size }
}

describe('sortItems', () => {
  it('orders by name in both directions', () => {
    const items = [at('beta'), at('Alpha'), at('gamma')]
    expect(sortItems(items, 'name', (item) => item).map((item) => item.name)).toEqual([
      'Alpha',
      'beta',
      'gamma',
    ])
    expect(sortItems(items, 'name-desc', (item) => item).map((item) => item.name)).toEqual([
      'gamma',
      'beta',
      'Alpha',
    ])
  })

  it('prefers the creation time and falls back to the modification time', () => {
    const items = [
      at('created-late', 300),
      at('modified-only', null, 200),
      at('created-early', 100),
    ]
    expect(sortItems(items, 'newest', (item) => item).map((item) => item.name)).toEqual([
      'created-late',
      'modified-only',
      'created-early',
    ])
    expect(sortItems(items, 'oldest', (item) => item).map((item) => item.name)).toEqual([
      'created-early',
      'modified-only',
      'created-late',
    ])
  })

  it('sinks items without a date to the bottom in both directions', () => {
    const items = [at('unknown'), at('dated', 100)]
    expect(sortItems(items, 'newest', (item) => item).map((item) => item.name)).toEqual([
      'dated',
      'unknown',
    ])
    expect(sortItems(items, 'oldest', (item) => item).map((item) => item.name)).toEqual([
      'dated',
      'unknown',
    ])
  })

  it('orders by size and breaks ties by name', () => {
    const items = [
      at('small', null, null, 10),
      at('big', null, null, 900),
      at('also-small', null, null, 10),
      at('no-size'),
    ]
    expect(sortItems(items, 'largest', (item) => item).map((item) => item.name)).toEqual([
      'big',
      'also-small',
      'small',
      'no-size',
    ])
    expect(sortItems(items, 'smallest', (item) => item).map((item) => item.name)).toEqual([
      'also-small',
      'small',
      'big',
      'no-size',
    ])
  })
})

describe('sortGroups', () => {
  const group = (title: string, items: SortFields[]): LibraryGroup<SortFields> => ({
    key: title,
    title,
    agents: [],
    items,
  })

  it('keeps the grouping order for name sorts but orders the items inside', () => {
    const groups = [group('B', [at('b2'), at('b1')]), group('A', [at('a1')])]
    const sorted = sortGroups(groups, 'name', (item) => item)

    expect(sorted.map((entry) => entry.title)).toEqual(['B', 'A'])
    expect(sorted[0]?.items.map((item) => item.name)).toEqual(['b1', 'b2'])
  })

  it('orders groups by their leading item for date sorts', () => {
    const groups = [group('old', [at('old', 100)]), group('new', [at('new', 900)])]

    expect(sortGroups(groups, 'newest', (item) => item).map((entry) => entry.title)).toEqual([
      'new',
      'old',
    ])
    expect(sortGroups(groups, 'oldest', (item) => item).map((entry) => entry.title)).toEqual([
      'old',
      'new',
    ])
  })
})
