import type { HubEntry } from '@/shared/bindings/HubEntry'

/**
 * The three ways to look at a collection by whether this machine already holds an entry.
 *
 * `all` is the neutral state the Hub opens with; the other two are the question a user actually
 * asks — "what do I not have yet", and its mirror.
 */
export type InstalledFilter = 'all' | 'installed' | 'missing'

/**
 * Whether an entry passes the installed filter.
 *
 * "Installed" is the scan's answer, never the Hub's memory: `commands::hub` annotates every entry
 * it answers with the owners the last report found it for, so a copy written anywhere shows up
 * here as soon as the report lands. An entry that is off — a skill renamed to `.disabled`, a server
 * in the disabled container — is still installed; it is on disk and the card says so.
 */
export function matchesInstalled(entry: HubEntry, filter: InstalledFilter): boolean {
  if (filter === 'all') return true
  return filter === 'installed' ? entry.installed.length > 0 : entry.installed.length === 0
}
