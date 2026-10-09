import { describe, expect, it } from 'vitest'

import type { HubEntry } from '@/shared/bindings/HubEntry'

import { formatGroupTitle, groupHubEntries, isBatchable, skillSlug, takenByOwner } from './grouping'

function entry(overrides: Partial<HubEntry> = {}): HubEntry {
  return {
    id: 'src/plugins/teams/skills/review',
    sourceId: 'src',
    sourceName: 'Source',
    kind: 'skill',
    name: 'review',
    title: null,
    description: null,
    version: null,
    vendor: null,
    homepage: null,
    repository: null,
    license: null,
    tags: ['teams'],
    group: 'teams',
    fileCount: 1,
    sizeBytes: 100,
    installable: true,
    installProblem: null,
    inputCount: 0,
    hasScripts: false,
    installed: [],
    ...overrides,
  }
}

describe('groupHubEntries', () => {
  it('keeps plugin groups in first-seen order and leaves the rest flat', () => {
    const a = entry({ id: 'a', group: 'teams', name: 'review' })
    const b = entry({ id: 'b', group: 'docs', name: 'write' })
    const c = entry({ id: 'c', group: 'teams', name: 'plan' })
    const lone = entry({ id: 'd', group: null, name: 'pdf' })
    const mcp = entry({
      id: 'e',
      kind: 'mcp',
      group: 'teams',
      name: 'server',
      installable: true,
    })

    const { groups, ungrouped } = groupHubEntries([a, b, c, lone, mcp])
    expect(groups.map((group) => group.id)).toEqual(['teams', 'docs'])
    expect(groups[0]?.entries.map((item) => item.id)).toEqual(['a', 'c'])
    expect(ungrouped.map((item) => item.id)).toEqual(['d', 'e'])
  })
})

describe('formatGroupTitle', () => {
  it('turns a kebab plugin id into a short title', () => {
    expect(formatGroupTitle('accessibility-compliance')).toBe('Accessibility Compliance')
    expect(formatGroupTitle('api_testing')).toBe('Api Testing')
  })
})

describe('batch helpers', () => {
  it('only batch-installs installable skills', () => {
    expect(isBatchable(entry())).toBe(true)
    expect(isBatchable(entry({ installable: false }))).toBe(false)
    expect(isBatchable(entry({ kind: 'mcp' }))).toBe(false)
  })

  it('matches the backend skill slug for conflict detection', () => {
    expect(skillSlug('PDF Toolkit')).toBe('pdf-toolkit')
    expect(
      takenByOwner(
        entry({
          name: 'pdf',
          installed: [
            {
              owner: { id: 'shared', name: 'Shared', icon: null },
              scope: { kind: 'global' },
              path: '/skills/pdf',
              enabled: true,
              identical: true,
            },
          ],
        }),
        'shared',
      ),
    ).toBe(true)
    expect(takenByOwner(entry({ name: 'pdf' }), 'shared')).toBe(false)
  })
})
