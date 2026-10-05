import { Globe } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { Settings } from '@/shared/bindings/Settings'
import { Input } from '@/shared/ui/Input'
import { Select } from '@/shared/ui/Select'
import { SwitchField } from '@/shared/ui/Switch'

import {
  SettingRow,
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

export function SettingsNetworkPage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={Globe}
        title={t('settings.network')}
        hint={t('settings.networkHint')}
      />

      <SettingsSections>
        <SettingsSection title={t('settings.updates')}>
          <SwitchField
            id="network-checks"
            label={t('settings.networkChecks')}
            hint={t('settings.networkChecksHint')}
            checked={draft.networkVersionChecks}
            onCheckedChange={(checked) => update({ networkVersionChecks: checked })}
          />
          <SettingRow label={t('settings.cacheMinutes')}>
            <Input
              className="w-24"
              type="number"
              min={1}
              max={1440}
              value={draft.versionCacheMinutes}
              aria-label={t('settings.cacheMinutes')}
              onChange={(event) =>
                update({ versionCacheMinutes: Math.max(1, Number(event.target.value) || 1) })
              }
            />
          </SettingRow>
        </SettingsSection>

        <SettingsSection title={t('settings.proxy')} hint={t('settings.proxyHint')}>
          <SettingRow label={t('settings.proxyMode')}>
            <Select
              ariaLabel={t('settings.proxy')}
              value={draft.proxyMode}
              onValueChange={(value) => update({ proxyMode: value as Settings['proxyMode'] })}
              options={[
                { value: 'none', label: t('settings.proxyNone') },
                { value: 'system', label: t('settings.proxySystem') },
                { value: 'manual', label: t('settings.proxyManual') },
              ]}
              className="min-w-40"
            />
          </SettingRow>

          {draft.proxyMode === 'manual' ? (
            <div className="flex flex-col gap-1 py-3">
              <span className="text-sm">{t('settings.proxyUrl')}</span>
              <Input
                value={draft.proxyUrl ?? ''}
                placeholder={t('settings.proxyUrlPlaceholder')}
                aria-label={t('settings.proxyUrl')}
                onChange={(event) =>
                  update({ proxyUrl: event.target.value.length > 0 ? event.target.value : null })
                }
              />
              <p className="text-faint text-[0.75rem]">{t('settings.proxyUrlHint')}</p>
            </div>
          ) : (
            <p className="text-faint py-3 text-[0.75rem]">
              {draft.proxyMode === 'none'
                ? t('settings.proxyNoneHint')
                : t('settings.proxySystemHint')}
            </p>
          )}
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
