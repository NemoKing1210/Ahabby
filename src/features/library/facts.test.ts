import { describe, expect, it } from 'vitest'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { Skill } from '@/shared/bindings/Skill'

import { serverGroupFacts, skillGroupFacts } from './facts'

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }
const opencode: AgentRef = { id: 'opencode', name: 'OpenCode', icon: 'opencode' }

function skill(name: string, path: string, extra: Partial<Skill> = {}): Skill {
  return {
    id: `${name}#${path}`,
    name,
    description: null,
    path,
    entryPath: `${path}/SKILL.md`,
    scope: { kind: 'global' },
    agents: [claude],
    frontmatter: [],
    tags: [],
    content: null,
    sizeBytes: 10,
    enabled: true,
    removable: true,
    unverified: false,
    ...extra,
  }
}

function server(name: string, type: 'stdio' | 'http', file: string): McpServer {
  return {
    id: `${name}#${file}`,
    name,
    transport:
      type === 'http'
        ? { type: 'http', url: 'https://mcp.example.com', protocol: 'http' }
        : { type: 'stdio', command: 'npx', args: ['-y'] },
    scope: { kind: 'global' },
    agent: claude,
    sourceConfig: file,
    keyPath: ['mcpServers', name],
    env: [],
    headers: [],
    raw: '{}',
    hasSecrets: false,
    enabled: true,
    removable: true,
    unverified: false,
  }
}

describe('skillGroupFacts', () => {
  it('names each directory once, newest modified, and counts what is off or unverified', () => {
    const facts = skillGroupFacts([
      skill('pdf', '/a/skills/pdf', { modifiedMs: Date.UTC(2025, 1, 1) }),
      skill('pdf', '/b/skills/pdf', { agents: [opencode], modifiedMs: Date.UTC(2025, 5, 1) }),
      // The same directory as the first one, so it adds no location of its own.
      skill('review', '/a/skills/review', { enabled: false, unverified: true }),
    ])

    expect(facts.locations).toEqual(['/a/skills', '/b/skills'])
    expect(facts.off).toBe(1)
    expect(facts.unverified).toBe(1)
    expect(facts.modifiedMs).toBe(Date.UTC(2025, 5, 1))
    // The tab's own axis, not this module's: a group of skills says nothing about transports.
    expect(facts.transports).toEqual([])
  })

  it('reports no date for a group whose files the platform does not date', () => {
    expect(skillGroupFacts([skill('pdf', '/a/skills/pdf')]).modifiedMs).toBeNull()
  })
})

describe('serverGroupFacts', () => {
  it("names the config files and the transports in the tab's own order", () => {
    const facts = serverGroupFacts([
      server('remote', 'http', '/b/.mcp.json'),
      server('github', 'stdio', '/a/.mcp.json'),
    ])

    expect(facts.locations).toEqual(['/a/.mcp.json', '/b/.mcp.json'])
    expect(facts.transports).toEqual(['stdio', 'http'])
  })
})
