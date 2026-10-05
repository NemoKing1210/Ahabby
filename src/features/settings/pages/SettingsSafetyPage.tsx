import { ShieldCheck } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { Input } from '@/shared/ui/Input'

import { SettingsPageHeading, SettingsSection } from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'
import { useBackupRoot } from '../api/hooks'

export function SettingsSafetyPage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()
  const backupRoot = useBackupRoot()

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={ShieldCheck}
        title={t('settings.safety')}
        hint={t('settings.backupDirHint')}
      />

      <SettingsSection>
        <div className="flex flex-col gap-2 py-3">
          <span className="text-sm">{t('settings.backupDir')}</span>
          <Input
            value={draft.backupDir ?? ''}
            placeholder={backupRoot.data ?? ''}
            aria-label={t('settings.backupDir')}
            onChange={(event) =>
              update({ backupDir: event.target.value.length > 0 ? event.target.value : null })
            }
          />
          {backupRoot.data ? (
            <p className="text-faint text-[0.75rem]">
              {t('settings.backupDirDefault', { path: backupRoot.data })}
            </p>
          ) : null}
        </div>
      </SettingsSection>
    </div>
  )
}
