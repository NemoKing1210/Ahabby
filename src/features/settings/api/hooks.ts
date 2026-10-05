import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n } from '@/shared/i18n'
import { appearanceApplier } from '@/app/appearance'
import { themeApplier } from '@/app/theme'

export function useSettings() {
  return useQuery({
    queryKey: queryKeys.settings(),
    queryFn: ipc.getSettings,
    staleTime: Infinity,
  })
}

export function usePackageManagers() {
  return useQuery({
    queryKey: queryKeys.packageManagers(),
    queryFn: ipc.listPackageManagers,
    staleTime: 5 * 60 * 1000,
  })
}

export function useUserCatalogDir() {
  return useQuery({
    queryKey: ['user-catalog-dir'],
    queryFn: ipc.userCatalogDir,
    staleTime: Infinity,
  })
}

export function useBackupRoot() {
  return useQuery({ queryKey: ['backup-root'], queryFn: ipc.backupRoot, staleTime: Infinity })
}

/**
 * Saves settings and immediately applies what can be applied without a restart: theme,
 * appearance (accent, sizes, fonts) and language. The backend rebuilds its own derived state
 * (version checker, scan paths).
 */
export function useSaveSettings() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (settings: Settings) => ipc.saveSettings(settings),
    onSuccess: (saved) => {
      client.setQueryData(queryKeys.settings(), saved)
      initI18n(saved.language)
      themeApplier.apply(saved.theme)
      appearanceApplier.apply(saved)
      void client.invalidateQueries({ queryKey: ['backup-root'] })
    },
  })
}
