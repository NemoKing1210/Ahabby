import type { McpServer } from '@/shared/bindings/McpServer'
import type { Skill } from '@/shared/bindings/Skill'
import { parentPath } from '@/shared/lib/format'

/** Transport kinds the MCP tab refines by, in display order — a facet's chips and a group's badges. */
export const MCP_TRANSPORTS = ['stdio', 'http', 'unknown'] as const

/**
 * What a group says about itself under the title of its strip.
 *
 * A group is a slice of the list, not a thing the backend reports, so every fact here is derived
 * from the members the filters left in it. It is what makes a folded list readable: the strip of a
 * group nobody opened still answers where it lives, how much of it is switched on, and when it last
 * changed.
 */
export interface LibraryGroupFacts {
  /** Where the group lives: one entry per distinct directory (skills) or config file (servers). */
  locations: string[]
  /** Members switched off — still on disk, just not loaded by their agent. */
  off: number
  /** Members whose manifest path is not verified against the vendor's documentation yet. */
  unverified: number
  /** Kinds of MCP transport its servers use, in the tab's own order. */
  transports: string[]
  /** The newest modification any member reports, or `null` when none of them reports one. */
  modifiedMs: number | null
}

/** The fields every member of a group has, whatever the tab holds. */
interface Member {
  enabled: boolean
  unverified: boolean
  modifiedMs?: number | null
}

function factsOf<T extends Member>(
  items: T[],
  location: (item: T) => string,
  transports: string[] = [],
): LibraryGroupFacts {
  const locations: string[] = []
  let off = 0
  let unverified = 0
  let modifiedMs: number | null = null

  for (const item of items) {
    const where = location(item)
    if (!locations.includes(where)) locations.push(where)
    if (!item.enabled) off += 1
    if (item.unverified) unverified += 1
    const modified = item.modifiedMs ?? null
    if (modified !== null && (modifiedMs === null || modified > modifiedMs)) modifiedMs = modified
  }

  return { locations: locations.sort(), off, unverified, transports, modifiedMs }
}

/**
 * Where a group of skills lives: the skills directories behind it, not the skills themselves — a
 * group of a whole agent is one directory, and a name several agents share is one per agent.
 */
export function skillGroupFacts(skills: Skill[]): LibraryGroupFacts {
  return factsOf(skills, (skill) => parentPath(skill.path))
}

/** Where a group of servers lives: the config files that declare them. */
export function serverGroupFacts(servers: McpServer[]): LibraryGroupFacts {
  const transports = MCP_TRANSPORTS.filter((type) =>
    servers.some((server) => server.transport.type === type),
  )
  return factsOf(servers, (server) => server.sourceConfig, [...transports])
}
