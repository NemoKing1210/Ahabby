import { useQuery } from '@tanstack/react-query'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'

/**
 * One page, read by the backend for Ahabby's own browser.
 *
 * `retry: false`: a page that did not answer is a page the reader says so about, and asking
 * again three times would only make the user wait for the same answer. `staleTime` is the
 * session's: going Back to a page that was just read is a cached answer, never a second
 * request — Reload in the toolbar is what asks again.
 */
export function useWebPage(url: string | null) {
  return useQuery({
    queryKey: queryKeys.webPage(url ?? ''),
    queryFn: () => ipc.fetchWebPage(url ?? ''),
    enabled: url !== null,
    staleTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  })
}
