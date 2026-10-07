import { Info } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Badge } from '@/shared/ui/Badge'

import {
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { usePackageManagers } from '../api/hooks'

export function SettingsAboutPage() {
  const { t } = useTranslation()
  const managers = usePackageManagers()

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

        <SettingsSection title={t('settings.managers')}>
          {managers.data && managers.data.length > 0 ? (
            <AnimatedList as="ul" grouped={false} className="flex flex-col gap-2 py-3">
              {managers.data.map((manager) => (
                <div key={manager.manager} className="flex items-center gap-2">
                  <Badge tone="outline">{manager.manager}</Badge>
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
