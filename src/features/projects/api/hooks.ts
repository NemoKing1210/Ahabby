import { useMutation, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/**
 * The operating system's folder picker.
 *
 * It changes nothing and returns no state to cache: it answers with the path the user chose (or
 * `null` when the dialog was cancelled), which the form only shows. The folder itself is
 * validated, remembered and scanned by `useAddProjectFolder` when the user confirms.
 */
export function usePickProjectFolder() {
  return useMutation({ mutationFn: ipc.pickProjectFolder })
}

/**
 * Adds one of the user's folders to the Projects screen.
 *
 * The backend validates the directory, remembers it in Settings and rescans; the answer is the
 * whole fresh report, so the new folder and its projects are on screen as soon as it lands.
 */
export function useAddProjectFolder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (path: string) => ipc.addProjectFolder(path),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })
}

/**
 * Forgets a folder. Only Ahabby's own list changes — the backend never touches the directory.
 * The answer carries the fresh report, so the projects it held disappear with the folder.
 */
export function useRemoveProjectFolder() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (folderId: string) => ipc.removeProjectFolder(folderId),
    onSuccess: (result) => {
      client.setQueryData(queryKeys.agents(), result.report)
      void client.invalidateQueries({ queryKey: queryKeys.settings() })
    },
  })
}
