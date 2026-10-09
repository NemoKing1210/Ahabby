import { useTranslation } from 'react-i18next'

import { Button } from '@/shared/ui/Button'
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/shared/ui/Dialog'

/**
 * First-launch (and Settings replay) welcome before the driver.js spotlight starts.
 */
export function WelcomeTourDialog({
  onStart,
  onSkip,
}: {
  onStart: () => void
  onSkip: () => void
}) {
  const { t } = useTranslation()

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onSkip()
      }}
    >
      <DialogContent
        className="w-[min(440px,92vw)]"
        footer={
          <>
            <Button variant="ghost" onClick={onSkip}>
              {t('tour.skip')}
            </Button>
            <Button variant="primary" onClick={onStart}>
              {t('tour.start')}
            </Button>
          </>
        }
      >
        <DialogHeader>
          <DialogTitle>{t('tour.welcomeTitle')}</DialogTitle>
          <DialogDescription>{t('tour.welcomeBody')}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <p className="text-muted text-[0.8125rem] leading-relaxed">{t('tour.welcomeHint')}</p>
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}
