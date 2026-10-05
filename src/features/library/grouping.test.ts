import { describe, expect, it } from 'vitest'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { Skill } from '@/shared/bindings/Skill'

import {
  groupServersByName,
  groupSkillsByAgent,
  groupSkillsByName,
  matchesLibraryQuery,
  ownedBy,
} from './grouping'

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }
const opencode: AgentRef = { id: 'opencode', name: 'OpenCode', icon: 'opencode' }

function skill(name: string, path: string, agents: AgentRef[]): Skill {
  return {
    id: `${name}#${path}`,
    name,
    description: `about ${name}`,
    path,
    entryPath: `${path}/SKILL.md`,
    scope: { kind: 'global' },
    agents,
    frontmatter: [],
    content: '# body',
    sizeBytes: 10,
    removable: true,
    unverified: false,
  }
}

function server(name: string, agent: AgentRef, file: string): McpServer {
  return {
    id: `${name}#${file}`,
    name,
    transport: { type: 'stdio', command: 'npx', args: ['-y'] },
    scope: { kind: 'global' },
    agent,
    sourceConfig: file,
    keyPath: ['mcpServers', name],
    env: [],
    headers: [],
    raw: '{}',
    hasSecrets: false,
    removable: true,
    unverified: false,
  }
}

describe('groupSkillsByName', () => {
  it('collects one group per name across agents and unions the owners', () => {
    const groups = groupSkillsByName([
      skill('pdf', '/a/pdf', [claude]),
      skill('pdf', '/b/pdf', [opencode]),
      skill('review', '/a/review', [claude]),
    ])

    expect(groups.map((group) => group.title)).toEqual(['pdf', 'review'])
    expect(groups[0]?.items).toHaveLength(2)
    expect(groups[0]?.agents.map((agent) => agent.id)).toEqual(['claude-code', 'opencode'])
    expect(groups[1]?.agents.map((agent) => agent.id)).toEqual(['claude-code'])
  })
})

describe('groupSkillsByAgent', () => {
  it('lists a shared skill under every agent that owns it', () => {
    const groups = groupSkillsByAgent([
      skill('pdf', '/a/pdf', [claude, opencode]),
      skill('review', '/a/review', [claude]),
    ])

    expect(groups.map((group) => group.title)).toEqual(['Claude Code', 'OpenCode'])
    expect(groups[0]?.items.map((entry) => entry.name)).toEqual(['pdf', 'review'])
    expect(groups[1]?.items.map((entry) => entry.name)).toEqual(['pdf'])
  })
})

describe('groupServersByName', () => {
  it('merges the same server configured for several agents', () => {
    const groups = groupServersByName([
      server('github', claude, '/a/.mcp.json'),
      server('github', opencode, '/b/config.json'),
      server('linear', claude, '/a/.mcp.json'),
    ])

    expect(groups.map((group) => group.title)).toEqual(['github', 'linear'])
    expect(groups[0]?.items).toHaveLength(2)
    expect(groups[0]?.agents.map((agent) => agent.id)).toEqual(['claude-code', 'opencode'])
  })
})

describe('matchesLibraryQuery', () => {
  it('matches case-insensitively and ignores absent fields', () => {
    expect(matchesLibraryQuery('', [undefined])).toBe(true)
    expect(matchesLibraryQuery('pdf', ['My PDF skill', null])).toBe(true)
    expect(matchesLibraryQuery('pdf', [undefined, '/skills/pdf'])).toBe(true)
    expect(matchesLibraryQuery('nope', ['pdf', null])).toBe(false)
  })
})

describe('ownedBy', () => {
  it('treats "all" as a match and otherwise requires an owner', () => {
    expect(ownedBy([claude], 'all')).toBe(true)
    expect(ownedBy([claude, opencode], 'opencode')).toBe(true)
    expect(ownedBy([claude], 'codex')).toBe(false)
  })
})
