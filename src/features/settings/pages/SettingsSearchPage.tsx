import { Plus, Search, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { AnimatedList } from '@/shared/ui/AnimatedList'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { PathRow } from '@/shared/ui/PathRow'

import {
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'
import { useUserCatalogDir } from '../api/hooks'

export function SettingsSearchPage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()
  const catalogDir = useUserCatalogDir()

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={Search}
        title={t('settings.searchAndCatalog')}
        hint={t('settings.searchHint')}
      />

      <SettingsSections>
        <SettingsSection title={t('settings.scanning')} hint={t('settings.scanPathsHint')}>
          <div className="flex flex-col gap-2 py-3">
            <span className="text-sm">{t('settings.scanPaths')}</span>
            {draft.extraScanPaths.length === 0 ? (
              <p className="text-muted text-[0.8125rem]">{t('settings.scanPathsNone')}</p>
            ) : null}
            <AnimatedList grouped={false} className="flex flex-col gap-2">
              {draft.extraScanPaths.map((path, index) => (
                <div key={`${index}-${path}`} className="flex items-center gap-2">
                  <Input
                    value={path}
                    placeholder={t('settings.pathPlaceholder')}
                    aria-label={t('settings.scanPaths')}
                    onChange={(event) => {
                      const next = [...draft.extraScanPaths]
                      next[index] = event.target.value
                      update({ extraScanPaths: next })
                    }}
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t('settings.removePath')}
                    onClick={() =>
                      update({ extraScanPaths: draft.extraScanPaths.filter((_, i) => i !== index) })
                    }
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              ))}
            </AnimatedList>
            <Button
              variant="secondary"
              size="sm"
              className="self-start"
              onClick={() => update({ extraScanPaths: [...draft.extraScanPaths, ''] })}
            >
              <Plus className="size-3.5" aria-hidden />
              {t('settings.addPath')}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection title={t('settings.catalog')} hint={t('settings.catalogDirHint')}>
          {catalogDir.data ? <PathRow path={catalogDir.data} className="py-3" /> : null}
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
