import { Bell, Check } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { ToastDuration } from '@/shared/bindings/ToastDuration'
import type { ToastPosition } from '@/shared/bindings/ToastPosition'
import { cn } from '@/shared/lib/cn'
import { Button } from '@/shared/ui/Button'
import { Chip } from '@/shared/ui/Chip'
import { SwitchField } from '@/shared/ui/Switch'
import { toast } from '@/shared/ui/Toast'

import {
  SettingRow,
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

/** The six corners in the order the picker paints them: the top row of the window, then the bottom. */
const POSITIONS: readonly ToastPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
]

/** Where the message sits on the little window each position is drawn as. */
const BAR: Record<ToastPosition, string> = {
  'top-left': 'top-1.5 left-1.5',
  'top-center': 'top-1.5 left-1/2 -translate-x-1/2',
  'top-right': 'top-1.5 right-1.5',
  'bottom-left': 'bottom-1.5 left-1.5',
  'bottom-center': 'bottom-1.5 left-1/2 -translate-x-1/2',
  'bottom-right': 'bottom-1.5 right-1.5',
}

/** The delays on offer, shortest first — the order the row reads in. */
const DURATIONS: readonly ToastDuration[] = ['short', 'normal', 'long', 'persistent']

/** One corner, drawn as the window with a message on the edge it names. */
function PositionCard({
  position,
  name,
  selected,
  onSelect,
}: {
  position: ToastPosition
  name: string
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={cn(
        'border-border ease-warm flex flex-col gap-2 rounded-xl border p-2 text-left transition-colors duration-150',
        selected ? 'border-accent bg-accent-soft' : 'hover:border-border-strong',
      )}
    >
      <span
        aria-hidden
        className="border-border bg-surface-2 relative block h-11 rounded-md border"
      >
        <span
          className={cn(
            'absolute h-1.5 w-1/2 rounded-full',
            BAR[position],
            selected ? 'bg-accent' : 'bg-surface-3',
          )}
        />
      </span>
      <span className="flex min-w-0 items-center gap-1.5 px-0.5">
        <span className="truncate text-[0.8125rem]">{name}</span>
        {selected ? <Check className="text-accent-strong size-3.5 shrink-0" aria-hidden /> : null}
      </span>
    </button>
  )
}

/**
 * The messages Ahabby shows: where they appear, how long they stay, or whether they appear at all.
 *
 * The choice is painted on the real toaster while this page is open ([`LiveToasts`]), so the picker
 * and the delay row are previews of the thing itself; the button below pushes a real message
 * through the same path every other screen uses.
 */
export function SettingsNotificationsPage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()
  const settings = draft.toast

  const setToast = (patch: Partial<typeof settings>) => update({ toast: { ...settings, ...patch } })

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={Bell}
        title={t('settings.notifications')}
        hint={t('settings.notificationsHint')}
      />

      <SettingsSections>
        <SettingsSection title={t('settings.toasts')} hint={t('settings.toastsHint')}>
          <SwitchField
            id="show-toasts"
            label={t('settings.showToasts')}
            hint={t('settings.showToastsHint')}
            checked={settings.enabled}
            onCheckedChange={(enabled) => setToast({ enabled })}
          />

          <div className="flex flex-col gap-2 py-3">
            <span className="text-sm">{t('settings.toastPosition')}</span>
            <p className="text-muted max-w-prose text-[0.8125rem]">
              {t('settings.toastPositionHint')}
            </p>
            <div
              role="radiogroup"
              aria-label={t('settings.toastPosition')}
              className="grid max-w-md grid-cols-3 gap-2 pt-1"
            >
              {POSITIONS.map((position) => (
                <PositionCard
                  key={position}
                  position={position}
                  name={t(`settings.toastPositions.${position}`)}
                  selected={settings.position === position}
                  onSelect={() => setToast({ position })}
                />
              ))}
            </div>
          </div>

          <SettingRow label={t('settings.toastDuration')} hint={t('settings.toastDurationHint')}>
            <div className="flex flex-wrap gap-1.5">
              {DURATIONS.map((duration) => (
                <Chip
                  key={duration}
                  label={t(`settings.toastDurations.${duration}`)}
                  active={settings.duration === duration}
                  onClick={() => setToast({ duration })}
                />
              ))}
            </div>
          </SettingRow>

          <SettingRow
            label={t('settings.toastPreview')}
            hint={settings.enabled ? t('settings.toastPreviewHint') : t('settings.toastPreviewOff')}
          >
            <Button
              variant="ghost"
              size="sm"
              disabled={!settings.enabled}
              onClick={() =>
                toast.success(t('settings.toastTestTitle'), t('settings.toastTestBody'))
              }
            >
              {t('settings.showTestToast')}
            </Button>
          </SettingRow>
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
