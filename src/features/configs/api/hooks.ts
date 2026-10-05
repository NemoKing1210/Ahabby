import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/** Raw snapshot of a config file: content plus the hash the editor must send back. */
export function useConfigSnapshot(agentId: string, path: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.config(agentId, path),
    queryFn: () => ipc.readConfig(agentId, path),
    enabled,
    staleTime: 0,
  })
}

export interface SaveConfigVars {
  agentId: string
  path: string
  content: string
  baseSha256: string
}

/**
 * Validates and diffs the edit without writing anything. The result also tells the editor
 * whether the file is still the one it started from.
 */
export function usePreviewConfigSave() {
  return useMutation({
    mutationFn: (vars: SaveConfigVars) =>
      ipc.previewConfigSave(vars.agentId, vars.path, vars.content, vars.baseSha256),
  })
}

/** Writes the file: validation, timestamped backup and atomic replace happen in Rust. */
export function useSaveConfig() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: SaveConfigVars) =>
      ipc.saveConfig(vars.agentId, vars.path, vars.content, vars.baseSha256),
    onSuccess: (result, vars) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
      void client.invalidateQueries({ queryKey: queryKeys.backups(vars.agentId, vars.path) })
      void client.invalidateQueries({ queryKey: queryKeys.config(vars.agentId, vars.path) })
    },
  })
}

export function useBackups(agentId: string, path: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.backups(agentId, path),
    queryFn: () => ipc.listBackups(agentId, path),
    enabled,
  })
}

export function useRestoreBackup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; path: string; backupPath: string }) =>
      ipc.restoreBackup(vars.agentId, vars.path, vars.backupPath),
    onSuccess: (result, vars) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.config(vars.agentId, vars.path) })
      void client.invalidateQueries({ queryKey: queryKeys.backups(vars.agentId, vars.path) })
    },
  })
}
