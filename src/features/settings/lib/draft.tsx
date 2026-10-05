import { createContext, useContext } from 'react'

import type { Settings } from '@/shared/bindings/Settings'

/**
 * The unsaved settings draft, shared by every settings subpage.
 *
 * The layout owns the single `Settings` document and one Save button, so a subpage is free to
 * come and go: switching sections must not drop what the user has typed.
 */
export interface SettingsDraft {
  /** The saved document with the pending edits applied. */
  draft: Settings
  /** Applies a patch to the draft; nothing reaches the backend until Save. */
  update: (patch: Partial<Settings>) => void
}

const SettingsDraftContext = createContext<SettingsDraft | null>(null)

export const SettingsDraftProvider = SettingsDraftContext.Provider

export function useSettingsDraft(): SettingsDraft {
  const value = useContext(SettingsDraftContext)
  if (!value) throw new Error('useSettingsDraft must be used inside SettingsLayout')
  return value
}
