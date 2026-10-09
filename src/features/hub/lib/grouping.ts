import type { HubEntry } from '@/shared/bindings/HubEntry'

/**
 * One plugin / collection of skills the Hub shows under a shared heading.
 *
 * Built only from `HubEntry.group` (the repository layout), never from subject tags — a tag like
 * `design` cuts across plugins and is not a thing the user can install as a unit.
 */
export interface HubEntryGroup {
  /** Raw group id from the layout (`accessibility-compliance`). */
  id: string
  entries: HubEntry[]
}

/**
 * Split a flat page of entries into plugin groups (skills that name one) and a trailing flat
 * list (ungrouped skills and every MCP server).
 *
 * Group order follows the first time a group appears in `entries`, so paging keeps the groups
 * the user already saw in place instead of resorting the whole screen.
 */
export function groupHubEntries(entries: HubEntry[]): {
  groups: HubEntryGroup[]
  ungrouped: HubEntry[]
} {
  const groups: HubEntryGroup[] = []
  const index = new Map<string, HubEntryGroup>()
  const ungrouped: HubEntry[] = []

  for (const entry of entries) {
    const id = entry.group?.trim()
    if (!id || entry.kind !== 'skill') {
      ungrouped.push(entry)
      continue
    }
    const existing = index.get(id)
    if (existing) {
      existing.entries.push(entry)
    } else {
      const group: HubEntryGroup = { id, entries: [entry] }
      index.set(id, group)
      groups.push(group)
    }
  }

  return { groups, ungrouped }
}

/**
 * Turn a kebab / snake plugin id into a short title for the group heading.
 *
 * The repository directory is the identity (`accessibility-compliance`); the heading is what a
 * person reads.
 */
export function formatGroupTitle(group: string): string {
  return group
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Whether a skill is selectable for a batch install: skills only, and only ones Ahabby can write.
 */
export function isBatchable(entry: HubEntry): boolean {
  return entry.kind === 'skill' && entry.installable
}

/**
 * The directory name an install would derive from a skill's name — the same rule the backend uses
 * (`skill_slug`), so a conflict warning matches the write that would happen.
 */
export function skillSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/**
 * Whether the chosen owner already holds a copy of this entry — the scan's annotation on the card.
 */
export function takenByOwner(entry: HubEntry, ownerId: string): boolean {
  if (!ownerId) return false
  return entry.installed.some((install) => install.owner.id === ownerId)
}
