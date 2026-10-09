import { useQuery } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/**
 * The collections the hub reads: the ones Ahabby ships with plus the user's own source files.
 *
 * Sources are the hub's manifests — a synchronous local read that also reports a source file it
 * could not load, so one broken collection never empties the screen.
 */
export function useHubSources() {
  return useQuery({
    queryKey: queryKeys.hubSources(),
    queryFn: ipc.listHubSources,
    // Star counts are cached for a day on the backend; re-asking the list every minute only
    // burns GitHub's rate limit when the screen is revisited. Refresh still invalidates.
    staleTime: 5 * 60_000,
  })
}

/**
 * One entry, with the file list or the launch recipe the install dialog shows.
 *
 * `staleTime: Infinity` because an entry is a published artifact: reopening the dialog is a
 * cached answer, and the Refresh action on the card is what asks again.
 */
export function useHubEntry(entryId: string | null) {
  return useQuery({
    queryKey: queryKeys.hubEntry(entryId ?? ''),
    queryFn: () => ipc.getHubEntry(entryId ?? '', false),
    enabled: entryId !== null,
    staleTime: Infinity,
    retry: false,
  })
}

/**
 * Both `SKILL.md` texts for one installed copy of a hub skill — the collection's, and the owner's.
 *
 * Asked only while the compare dialog is open; the answer is the full files, not the truncated
 * preview the entry dialog shows.
 */
export function useHubSkillCompare(entryId: string, ownerId: string, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.hubSkillCompare(entryId, ownerId),
    queryFn: () => ipc.compareHubSkill(entryId, ownerId),
    enabled,
    staleTime: 0,
    retry: false,
  })
}
