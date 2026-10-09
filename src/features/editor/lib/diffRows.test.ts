import { describe, expect, it } from 'vitest'

import { buildDiff, toSplitRows, type DiffLine } from './diffRows'

describe('buildDiff', () => {
  it('numbers both sides and counts a replaced line', () => {
    const model = buildDiff('a\nb\nc\nd\n', 'a\nB\nc\nd\n')

    expect(model.added).toBe(1)
    expect(model.removed).toBe(1)
    expect(model.hunks).toHaveLength(1)
    expect(model.hunks[0]?.header).toBe('@@ -1,4 +1,4 @@')
    expect(model.hunks[0]?.lines).toEqual([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'remove', oldNo: 2, text: 'b' },
      { kind: 'add', newNo: 2, text: 'B' },
      { kind: 'context', oldNo: 3, newNo: 3, text: 'c' },
      { kind: 'context', oldNo: 4, newNo: 4, text: 'd' },
    ])
  })

  it('folds changes far apart into their own hunks', () => {
    const long = `${Array.from({ length: 20 }, (_, index) => `L${index + 1}`).join('\n')}\n`
    const model = buildDiff(long, long.replace('L2', 'X').replace('L18', 'Y'), 2)

    expect(model.hunks.map((hunk) => hunk.header)).toEqual(['@@ -1,4 +1,4 @@', '@@ -16,5 +16,5 @@'])
  })

  it('reports nothing for identical text', () => {
    expect(buildDiff('x\n', 'x\n')).toEqual({ hunks: [], added: 0, removed: 0 })
  })

  it('keeps the missing-newline marker as a line of its own', () => {
    // A file rewritten without its trailing newline: jsdiff marks both sides.
    const model = buildDiff('a', 'a\nb')

    expect(model.hunks[0]?.lines.map((line) => line.kind)).toEqual([
      'remove',
      'meta',
      'add',
      'add',
      'meta',
    ])
  })
})

describe('toSplitRows', () => {
  it('pairs a removal with the addition that replaced it', () => {
    const rows = toSplitRows([
      { kind: 'context', oldNo: 1, newNo: 1, text: 'a' },
      { kind: 'remove', oldNo: 2, text: 'b' },
      { kind: 'add', newNo: 2, text: 'B' },
    ])

    expect(rows.map((row) => row.kind)).toEqual(['context', 'change'])
    expect(rows[0]?.left?.text).toBe('a')
    expect(rows[1]).toMatchObject({ left: { text: 'b' }, right: { text: 'B' } })
  })

  it('leaves a line with no counterpart on one side only', () => {
    const lines: DiffLine[] = [
      { kind: 'remove', oldNo: 1, text: 'gone' },
      { kind: 'add', newNo: 1, text: 'one' },
      { kind: 'add', newNo: 2, text: 'two' },
    ]

    const rows = toSplitRows(lines)

    expect(rows.map((row) => row.kind)).toEqual(['change', 'add'])
    expect(rows[1]?.left).toBeUndefined()
    expect(rows[1]?.right?.text).toBe('two')
  })
})
