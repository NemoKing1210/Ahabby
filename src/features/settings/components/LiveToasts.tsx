import { useEffect, useRef } from 'react'

import type { Settings } from '@/shared/bindings/Settings'
import { applyToastSettings } from '@/shared/ui/Toast'

/**
 * Paints the *draft* toast settings into the real toaster for as long as the settings are open, and
 * puts the saved ones back when the last area closes — the same contract [`LiveAppearance`] keeps
 * for the accent and the sizes, so a position and a delay are judged on a real message and an edit
 * nobody commits leaves nothing behind.
 *
 * It lives in the settings layout, so walking between areas neither re-applies nor restores.
 */
export function LiveToasts({ draft, saved }: { draft: Settings; saved: Settings }) {
  const { enabled, position, duration } = draft.toast
  // The latest *saved* settings, so the unmount below restores them, not the values this component
  // was rendered with. Written from an effect, because refs must not change during render.
  const persisted = useRef(saved.toast)
  useEffect(() => {
    persisted.current = saved.toast
  }, [saved.toast])

  useEffect(() => {
    applyToastSettings({ enabled, position, duration })
  }, [enabled, position, duration])

  useEffect(() => () => applyToastSettings(persisted.current), [])

  return null
}
