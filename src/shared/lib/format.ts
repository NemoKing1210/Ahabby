/** Presentation helpers. Everything locale aware uses `Intl`. */

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

export function formatBytes(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined) return null
  if (bytes < 1024) return `${bytes} B`
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)} ${UNITS[unit]}`
}

/** `2026-10-05T12:00:00Z` → `3 minutes ago`, using the active UI language. */
export function formatRelative(ms: number | null | undefined, locale: string): string | null {
  if (!ms) return null
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
  const deltaSeconds = Math.round((ms - Date.now()) / 1000)
  const thresholds: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, 'second'],
    [60, 'minute'],
    [24, 'hour'],
  ]
  let value = deltaSeconds
  for (const [limit, unit] of thresholds) {
    if (Math.abs(value) < limit) return formatter.format(value, unit)
    value = Math.round(value / limit)
  }
  return formatter.format(value, 'day')
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null
  if (ms < 1000) return `${ms} ms`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`
}

export function formatCount(value: number, locale: string): string {
  return new Intl.NumberFormat(locale).format(value)
}

/** Shortens `/home/me/.claude/plugins/very/deep/path/SKILL.md` from the left. */
export function shortenPath(path: string, maxSegments = 4): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const segments = path.split(separator).filter((segment) => segment.length > 0)
  if (segments.length <= maxSegments) return path
  const tail = segments.slice(-maxSegments).join(separator)
  return `${separator === '\\' ? '…\\' : '…/'}${tail}`
}

export function fileName(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const segments = path.split(separator)
  return segments[segments.length - 1] ?? path
}

/** Stable grouping helper used by the library view. */
export function groupBy<T, K extends string>(items: T[], key: (item: T) => K): Map<K, T[]> {
  const groups = new Map<K, T[]>()
  for (const item of items) {
    const group = key(item)
    const bucket = groups.get(group)
    if (bucket) {
      bucket.push(item)
    } else {
      groups.set(group, [item])
    }
  }
  return groups
}
