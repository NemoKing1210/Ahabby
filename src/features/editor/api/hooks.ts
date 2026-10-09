import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/** Raw snapshot of one addressable document: content plus the hash the editor must send back. */
export function useDocumentSnapshot(agentId: string, path: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.config(agentId, path),
    queryFn: () => ipc.readConfig(agentId, path),
    enabled,
    staleTime: 0,
  })
}

export interface SaveDocumentVars {
  agentId: string
  path: string
  content: string
  baseSha256: string
}

/**
 * Validates and diffs the edit without writing anything. The result also tells the editor
 * whether the file is still the one it started from.
 */
export function usePreviewDocumentSave() {
  return useMutation({
    mutationFn: (vars: SaveDocumentVars) =>
      ipc.previewConfigSave(vars.agentId, vars.path, vars.content, vars.baseSha256),
  })
}

/** Writes the file: validation, timestamped backup and atomic replace happen in Rust. */
export function useSaveDocument() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: SaveDocumentVars) =>
      ipc.saveConfig(vars.agentId, vars.path, vars.content, vars.baseSha256),
    onSuccess: (result, vars) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.library() })
      void client.invalidateQueries({ queryKey: queryKeys.backups(vars.agentId, vars.path) })
      void client.invalidateQueries({ queryKey: queryKeys.config(vars.agentId, vars.path) })
    },
  })
}

export function useDocumentBackups(agentId: string, path: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.backups(agentId, path),
    queryFn: () => ipc.listBackups(agentId, path),
    enabled,
  })
}

/** The text of one backup, read only while its comparison view is open. */
export function useBackupContent(
  agentId: string,
  path: string,
  backupPath: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.backup(agentId, path, backupPath),
    queryFn: () => ipc.readBackup(agentId, path, backupPath),
    enabled,
    // A backup of a path never changes: once read it is good for the life of the window.
    staleTime: Infinity,
  })
}

/** Removes one backup. Rust insists on an explicit `confirm`, so the dialog is the only way in. */
export function useDeleteDocumentBackup() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (vars: { agentId: string; path: string; backupPath: string; confirm: boolean }) =>
      ipc.deleteBackup(vars.agentId, vars.path, vars.backupPath, vars.confirm),
    // The command answers with what is left, so the panel is repainted without a second round trip.
    onSuccess: (entries, vars) => {
      client.setQueryData(queryKeys.backups(vars.agentId, vars.path), entries)
      client.removeQueries({ queryKey: queryKeys.backup(vars.agentId, vars.path, vars.backupPath) })
    },
  })
}

/** Editors installed on this machine, asked for once the file is known to be on disk. */
export function useExternalEditors(enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.externalEditors(),
    queryFn: () => ipc.listExternalEditors(),
    enabled,
    // What is installed on the machine does not change while a dialog is open.
    staleTime: Infinity,
  })
}

/** Hands the file to an editor. The editor outlives Ahabby; nothing comes back but acceptance. */
export function useOpenInEditor() {
  return useMutation({
    mutationFn: (vars: { agentId: string; path: string; editorId: string }) =>
      ipc.openInEditor(vars.agentId, vars.path, vars.editorId),
  })
}

export function useRestoreDocumentBackup() {
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
