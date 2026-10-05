import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { Skill } from '@/shared/bindings/Skill'
import { groupBy } from '@/shared/lib/format'

/** The two ways the library can slice a list: by the thing's own name, or by who owns it. */
export type LibraryGroupMode = 'name' | 'agent'

export interface LibraryGroup<T> {
  /** Stable React key. */
  key: string
  /** Header text — the name of the thing, or the agent that owns it. */
  title: string
  /** Every agent behind the group; a name group can span several. */
  agents: AgentRef[]
  items: T[]
}

function byTitle<T>(groups: LibraryGroup<T>[]): LibraryGroup<T>[] {
  return groups.sort((a, b) => a.title.localeCompare(b.title))
}

function mergeAgents(target: AgentRef[], incoming: AgentRef[]): void {
  const seen = new Set(target.map((agent) => agent.id))
  for (const agent of incoming) {
    if (seen.has(agent.id)) continue
    seen.add(agent.id)
    target.push(agent)
  }
}

/**
 * One group per skill name. Two agents shipping a skill with the same name but different
 * contents stay separate cards — the backend never merges them — but they share a header, so
 * the group tells you at a glance how widely the skill is installed.
 */
export function groupSkillsByName(skills: Skill[]): LibraryGroup<Skill>[] {
  return byTitle(
    [...groupBy(skills, (skill) => skill.name.toLowerCase()).entries()].map(([key, items]) => {
      const agents: AgentRef[] = []
      for (const skill of items) mergeAgents(agents, skill.agents)
      return { key, title: items[0]?.name ?? key, agents, items }
    }),
  )
}

/** One group per owning agent; a skill shared by two agents appears under both. */
export function groupSkillsByAgent(skills: Skill[]): LibraryGroup<Skill>[] {
  const groups = new Map<string, LibraryGroup<Skill>>()
  for (const skill of skills) {
    for (const agent of skill.agents) {
      const existing = groups.get(agent.id)
      if (existing) existing.items.push(skill)
      else
        groups.set(agent.id, {
          key: agent.id,
          title: agent.name,
          agents: [agent],
          items: [skill],
        })
    }
  }
  return byTitle([...groups.values()])
}

/** One group per server name — the same server configured for several agents lands together. */
export function groupServersByName(servers: McpServer[]): LibraryGroup<McpServer>[] {
  return byTitle(
    [...groupBy(servers, (server) => server.name.toLowerCase()).entries()].map(([key, items]) => {
      const agents: AgentRef[] = []
      for (const server of items) mergeAgents(agents, [server.agent])
      return { key, title: items[0]?.name ?? key, agents, items }
    }),
  )
}

/** One group per owning agent. */
export function groupServersByAgent(servers: McpServer[]): LibraryGroup<McpServer>[] {
  const groups = new Map<string, LibraryGroup<McpServer>>()
  for (const server of servers) {
    const existing = groups.get(server.agent.id)
    if (existing) existing.items.push(server)
    else
      groups.set(server.agent.id, {
        key: server.agent.id,
        title: server.agent.name,
        agents: [server.agent],
        items: [server],
      })
  }
  return byTitle([...groups.values()])
}

export function groupSkills(skills: Skill[], mode: LibraryGroupMode): LibraryGroup<Skill>[] {
  return mode === 'agent' ? groupSkillsByAgent(skills) : groupSkillsByName(skills)
}

export function groupServers(
  servers: McpServer[],
  mode: LibraryGroupMode,
): LibraryGroup<McpServer>[] {
  return mode === 'agent' ? groupServersByAgent(servers) : groupServersByName(servers)
}

/** Case-insensitive match against whatever the card renders, so search never misses a field. */
export function matchesLibraryQuery(
  needle: string,
  parts: ReadonlyArray<string | null | undefined>,
): boolean {
  if (needle.length === 0) return true
  return parts.some(
    (part) => part !== null && part !== undefined && part.toLowerCase().includes(needle),
  )
}

/** `agentId` is `'all'` or a concrete agent id; a resource matches when any owner does. */
export function ownedBy(agents: AgentRef[], agentId: string): boolean {
  return agentId === 'all' || agents.some((agent) => agent.id === agentId)
}
