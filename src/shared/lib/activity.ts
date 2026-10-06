/**
 * The activity axis of a resource list: every skill and MCP server carries a switch, so a list
 * can be narrowed to what is on, what is off, or both.
 *
 * The state lives on the resource itself (`enabled`) and is read straight off the scan, so the
 * filters never have to remember anything of their own.
 */
export type ActivityFilter = 'all' | 'on' | 'off'

/** The choices, in display order. */
export const ACTIVITY_FILTERS: readonly ActivityFilter[] = ['all', 'on', 'off']

/** `true` when a resource in the given state survives the filter. */
export function matchesActivity(enabled: boolean, filter: ActivityFilter): boolean {
  return filter === 'all' || (filter === 'on') === enabled
}

/** How many resources each choice would show, for the chip labels. */
export function activityCounts(
  items: readonly { enabled: boolean }[],
): Record<ActivityFilter, number> {
  const on = items.filter((item) => item.enabled).length
  return { all: items.length, on, off: items.length - on }
}
