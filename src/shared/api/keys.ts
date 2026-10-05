/** React Query key factory — one place, so invalidation can never miss a query. */

export const queryKeys = {
  agents: (force = false) => ['agents', { force }] as const,
  agent: (agentId: string) => ['agents', agentId] as const,
  library: () => ['library'] as const,
  settings: () => ['settings'] as const,
  packageManagers: () => ['package-managers'] as const,
  config: (agentId: string, path: string) => ['config', agentId, path] as const,
  backups: (agentId: string, path: string) => ['backups', agentId, path] as const,
  installPlan: (agentId: string, action: string, methodId?: string | null) =>
    ['install-plan', agentId, action, methodId ?? null] as const,
}
