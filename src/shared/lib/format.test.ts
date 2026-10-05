import { describe, expect, it } from 'vitest'

import { fileName, formatBytes, formatDuration, groupBy, shortenPath } from './format'

describe('formatBytes', () => {
  it('scales and rounds', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(999)).toBe('999 B')
    expect(formatBytes(2048)).toBe('2.0 KB')
    expect(formatBytes(15 * 1024 * 1024)).toBe('15 MB')
    expect(formatBytes(null)).toBeNull()
    expect(formatBytes(undefined)).toBeNull()
  })
})

describe('formatDuration', () => {
  it('uses ms below a second', () => {
    expect(formatDuration(320)).toBe('320 ms')
    expect(formatDuration(1500)).toBe('1.5 s')
    expect(formatDuration(25_000)).toBe('25 s')
  })
})

describe('shortenPath', () => {
  it('keeps the tail', () => {
    expect(shortenPath('/home/me/.claude/skills/pdf/SKILL.md', 2)).toBe('…/pdf/SKILL.md')
    expect(shortenPath('C:\\Users\\me\\.claude\\settings.json', 5)).toBe(
      'C:\\Users\\me\\.claude\\settings.json',
    )
  })
})

describe('fileName', () => {
  it('handles both separators', () => {
    expect(fileName('/a/b/c.json')).toBe('c.json')
    expect(fileName('C:\\a\\b\\c.json')).toBe('c.json')
  })
})

describe('groupBy', () => {
  it('preserves insertion order of the groups', () => {
    const grouped = groupBy(
      [
        { id: 'b', name: 'beta' },
        { id: 'a', name: 'alpha' },
        { id: 'b2', name: 'beta' },
      ],
      (item) => item.name,
    )
    expect([...grouped.keys()]).toEqual(['beta', 'alpha'])
    expect(grouped.get('beta')?.length).toBe(2)
    expect(grouped.get('alpha')?.length).toBe(1)
  })
})
