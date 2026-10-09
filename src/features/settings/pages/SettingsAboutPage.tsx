import { Info, Sparkles } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { useOptionalTour } from '@/features/tour/TourProvider'
import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { ManagerIcon } from '@/shared/ui/ManagerIcon'
import { MANAGER_NAME_KEY } from '@/shared/ui/managerBrands'

import {
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { usePackageManagers } from '../api/hooks'

export function SettingsAboutPage() {
  const { t } = useTranslation()
  const managers = usePackageManagers()
  const { startTour } = useOptionalTour()

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading icon={Info} title={t('settings.about')} />

      <SettingsSections>
        <SettingsSection>
          <div className="flex flex-col gap-2 py-3">
            <span className="text-sm">
              {t('settings.aboutVersion', { version: __APP_VERSION__ })}
            </span>
            <p className="text-muted max-w-prose text-[0.8125rem]">{t('settings.aboutText')}</p>
          </div>
        </SettingsSection>

        <SettingsSection title={t('settings.tour')}>
          <div className="flex flex-col gap-3 py-3" data-tour="settings-tour">
            <p className="text-muted max-w-prose text-[0.8125rem]">{t('settings.tourHint')}</p>
            <Button variant="secondary" className="w-fit" onClick={startTour}>
              <Sparkles className="size-3.5" aria-hidden />
              {t('settings.showTour')}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection title={t('settings.managers')}>
          {managers.data && managers.data.length > 0 ? (
            <AnimatedList as="ul" grouped={false} className="flex flex-col gap-2 py-3">
              {managers.data.map((manager) => (
                <div key={manager.manager} className="flex items-center gap-3">
                  <ManagerIcon manager={manager.manager} />
                  <span className="text-foreground text-[0.8125rem]">
                    {t(MANAGER_NAME_KEY[manager.manager])}
                  </span>
                  <code className="text-faint truncate font-mono text-[0.6875rem]">
                    {manager.path}
                  </code>
                </div>
              ))}
            </AnimatedList>
          ) : (
            <p className="text-muted py-3 text-[0.8125rem]">{t('settings.managersNone')}</p>
          )}
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
