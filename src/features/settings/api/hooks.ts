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

/**
 * Collapses or opens the sidebar rail.
 *
 * Shell-owned settings (`sidebarCollapsed`, `lastRoute`, `tourCompleted`) are written by these
 * hooks, not by `useSaveSettings`: the backend keeps them out of a whole-document save, so the
 * Settings page's draft can never roll them back. The rail moves from the click instead of from
 * the round trip, and falls back to where it was if the write fails.
 */
export function useSetSidebarCollapsed() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (collapsed: boolean) => ipc.setSidebarCollapsed(collapsed),
    onMutate: (collapsed) => {
      const previous = client.getQueryData<Settings>(queryKeys.settings())
      if (previous) {
        client.setQueryData(queryKeys.settings(), { ...previous, sidebarCollapsed: collapsed })
      }
      return { previous }
    },
    onError: (_error, _collapsed, context) => {
      if (context?.previous) client.setQueryData(queryKeys.settings(), context.previous)
    },
    onSuccess: (saved) => client.setQueryData(queryKeys.settings(), saved),
  })
}

/** Remembers the screen the window is on, so the next launch opens there. */
export function useSetLastRoute() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (route: string) => ipc.setLastRoute(route),
    onSuccess: (saved) => client.setQueryData(queryKeys.settings(), saved),
  })
}

/** Remembers that the product tour was finished or skipped. */
export function useSetTourCompleted() {
  const client = useQueryClient()
  return useMutation({
    mutationFn: (completed: boolean) => ipc.setTourCompleted(completed),
    onMutate: (completed) => {
      const previous = client.getQueryData<Settings>(queryKeys.settings())
      if (previous) {
        client.setQueryData(queryKeys.settings(), { ...previous, tourCompleted: completed })
      }
      return { previous }
    },
    onError: (_error, _completed, context) => {
      if (context?.previous) client.setQueryData(queryKeys.settings(), context.previous)
    },
    onSuccess: (saved) => client.setQueryData(queryKeys.settings(), saved),
  })
}
