import { useEffect, useRef } from 'react'

import { appearanceApplier } from '@/app/appearance'
import { themeApplier } from '@/app/theme'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n } from '@/shared/i18n'

/**
 * Applies the appearance draft to the real interface for as long as the settings are open and
 * puts the saved values back when the last one closes, so a choice can be judged in place and an
 * edit nobody commits leaves nothing behind. Renders nothing: the whole thing is CSS custom
 * properties on the root element (`globals.css`).
 *
 * It lives in the settings layout, so walking between subpages neither re-applies nor restores.
 */
export function LiveAppearance({ draft, saved }: { draft: Settings; saved: Settings }) {
  const { theme, language, accent, accentCustom, interfaceScale, textScale, fontFamily, monoFont } =
    draft
  // The latest *saved* settings, so the unmount below restores them, not the values the page
  // was rendered with. Written from an effect, because refs must not change during render.
  const persisted = useRef(saved)
  useEffect(() => {
    persisted.current = saved
  }, [saved])

  useEffect(() => {
    themeApplier.apply(theme)
    appearanceApplier.apply({
      accent,
      accentCustom,
      interfaceScale,
      textScale,
      fontFamily,
      monoFont,
    })
    initI18n(language)
  }, [theme, language, accent, accentCustom, interfaceScale, textScale, fontFamily, monoFont])

  useEffect(
    () => () => {
      const previous = persisted.current
      themeApplier.apply(previous.theme)
      appearanceApplier.apply(previous)
      initI18n(previous.language)
    },
    [],
  )

  return null
}
