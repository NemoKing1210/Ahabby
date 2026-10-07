/** React Query key factory — one place, so invalidation can never miss a query. */

export const queryKeys = {
  agents: (force = false) => ['agents', { force }] as const,
  agent: (agentId: string) => ['agents', agentId] as const,
  library: () => ['library'] as const,
  hubSources: () => ['hub-sources'] as const,
  hubSource: (
    sourceId: string,
    kind: string | null,
    query: string,
    limit: number,
    refresh: number,
    tags: string[],
  ) => ['hub-source', sourceId, kind, query, limit, refresh, tags] as const,
  hubEntry: (entryId: string) => ['hub-entry', entryId] as const,
  settings: () => ['settings'] as const,
  packageManagers: () => ['package-managers'] as const,
  config: (agentId: string, path: string) => ['config', agentId, path] as const,
  backups: (agentId: string, path: string) => ['backups', agentId, path] as const,
  installPlan: (agentId: string, action: string, methodId?: string | null) =>
    ['install-plan', agentId, action, methodId ?? null] as const,
  terminals: () => ['terminals'] as const,
  /** One page read for Ahabby's own browser, keyed by the address it was read from. */
  webPage: (url: string) => ['web-page', url] as const,
}
