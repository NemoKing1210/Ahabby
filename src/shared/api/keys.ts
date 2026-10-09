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
  /** Every page of every source — what a wider refresh invalidates. */
  hubSourceAll: () => ['hub-source'] as const,
  hubEntry: (entryId: string) => ['hub-entry', entryId] as const,
  /** Every entry read, so a screen that says "already installed" can say it again. */
  hubEntryAll: () => ['hub-entry'] as const,
  /** Collection vs local `SKILL.md` for one owner of one hub skill. */
  hubSkillCompare: (entryId: string, ownerId: string) =>
    ['hub-skill-compare', entryId, ownerId] as const,
  settings: () => ['settings'] as const,
  /** Where the window is (maximized, focused) and whether the app draws its own header. */
  windowChrome: () => ['window-chrome'] as const,
  /** The cloud sync connection and the last runs. */
  syncStatus: () => ['sync-status'] as const,
  /** The syncable items of this machine, optionally one owner's. */
  syncItems: (ownerId: string | null) => ['sync-items', ownerId] as const,
  /** Every local item read, whichever owner asked. */
  syncItemsAll: () => ['sync-items'] as const,
  /** The copies the connected account holds. */
  syncRemote: () => ['sync-remote'] as const,
  /** What restoring one copy would do, for one owner. */
  syncPreview: (remoteId: string, ownerId: string) => ['sync-preview', remoteId, ownerId] as const,
  /** The content of one item of this machine, for the viewer. */
  syncItemContent: (ownerId: string, itemId: string) =>
    ['sync-item-content', ownerId, itemId] as const,
  /** The content of one cloud copy, for the viewer. */
  syncRemoteContent: (remoteId: string) => ['sync-remote-content', remoteId] as const,
  /** One item against its cloud copy, for the compare dialog. */
  syncComparison: (remoteId: string, ownerId: string) =>
    ['sync-comparison', remoteId, ownerId] as const,
  packageManagers: () => ['package-managers'] as const,
  config: (agentId: string, path: string) => ['config', agentId, path] as const,
  /** Editors installed on this machine — a machine-level list, so one key is enough. */
  externalEditors: () => ['external-editors'] as const,
  backups: (agentId: string, path: string) => ['backups', agentId, path] as const,
  backup: (agentId: string, path: string, backupPath: string) =>
    ['backup', agentId, path, backupPath] as const,
  installPlan: (agentId: string, action: string, methodId?: string | null) =>
    ['install-plan', agentId, action, methodId ?? null] as const,
  extensionPlan: (agentId: string, extensionId: string, action: string) =>
    ['extension-plan', agentId, extensionId, action] as const,
  terminals: () => ['terminals'] as const,
  /** One page read for Ahabby's own browser, keyed by the address it was read from. */
  webPage: (url: string) => ['web-page', url] as const,
}
