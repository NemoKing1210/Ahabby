import { ipc } from '@/shared/api/ipc'
import type { HubEntry } from '@/shared/bindings/HubEntry'

/** Page size for a group fetch — the backend clamps to 100. */
const GROUP_PAGE = 100

/**
 * Every skill of one plugin group in a source, walking pages until the source says there are none.
 *
 * The toolbar's subject tags are not groups: membership is filtered by the group tag the backend
 * already puts on the entry, then narrowed again to `entry.group === group` so a skill that only
 * shares a subject tag is never pulled in.
 */
export async function fetchGroupSkills(sourceId: string, group: string): Promise<HubEntry[]> {
  const collected: HubEntry[] = []
  let cursor: string | null = null

  for (;;) {
    const page = await ipc.searchHub(sourceId, {
      query: '',
      kind: 'skill',
      tags: [group],
      cursor,
      limit: GROUP_PAGE,
      refresh: false,
    })
    for (const entry of page.entries) {
      if (entry.kind === 'skill' && entry.group === group) {
        collected.push(entry)
      }
    }
    const next = page.report.nextCursor
    if (!next) break
    cursor = next
  }

  return collected
}
