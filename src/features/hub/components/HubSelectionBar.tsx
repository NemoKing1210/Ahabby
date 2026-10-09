import { useTranslation } from 'react-i18next'
import { Download, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'

import { Button } from '@/shared/ui/Button'

/**
 * Floating strip above the bottom of the Hub while skills are selected for a batch install.
 *
 * Mounted by the page, not by a section: selection can span groups and sources, and the strip
 * has to stay put while the list scrolls under it.
 */
export function HubSelectionBar({
  count,
  onClear,
  onInstall,
}: {
  count: number
  onClear: () => void
  onInstall: () => void
}) {
  const { t } = useTranslation()

  return (
    <AnimatePresence>
      {count > 0 ? (
        <motion.div
          role="status"
          aria-live="polite"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 12 }}
          transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
          className="pointer-events-none sticky bottom-3 z-20 flex justify-center"
        >
          <div className="border-border-strong bg-surface shadow-popover pointer-events-auto flex items-center gap-3 rounded-xl border px-3 py-2">
            <p className="text-foreground text-[0.8125rem] tabular-nums">
              {t('hub.selectedCount', { count })}
            </p>
            <div className="flex items-center gap-1.5">
              <Button variant="ghost" size="sm" onClick={onClear}>
                <X className="size-3.5" aria-hidden />
                {t('hub.clearSelection')}
              </Button>
              <Button variant="primary" size="sm" onClick={onInstall}>
                <Download className="size-3.5" aria-hidden />
                {t('hub.installSelected')}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}
