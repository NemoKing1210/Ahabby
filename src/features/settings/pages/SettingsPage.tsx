import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus, Save, Trash2 } from 'lucide-react'

import { ipc } from '@/shared/api/ipc'
import type { Settings } from '@/shared/bindings/Settings'
import { LANGUAGES, type Language } from '@/shared/i18n'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { PathRow } from '@/shared/ui/PathRow'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Select } from '@/shared/ui/Select'
import { SwitchField } from '@/shared/ui/Switch'
import { toast, toastAppError } from '@/shared/ui/Toast'

import {
  useBackupRoot,
  usePackageManagers,
  useSaveSettings,
  useSettings,
  useUserCatalogDir,
} from '../api/hooks'

const LANGUAGE_LABEL: Record<Language, string> = { en: 'English', ru: 'Русский' }

function Section({
  title,
  hint,
  children,
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <Card className="flex flex-col gap-1 p-5">
      <h2 className="text-lg">{title}</h2>
      {hint ? <p className="text-muted text-[13px]">{hint}</p> : null}
      <div className="mt-2 flex flex-col">{children}</div>
    </Card>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useSettings()
  const save = useSaveSettings()
  const managers = usePackageManagers()
  const catalogDir = useUserCatalogDir()
  const backupRoot = useBackupRoot()

  const [override, setOverride] = useState<Partial<Settings> | null>(null)

  if (isLoading || !settings) return <SkeletonList rows={4} />

  const draft: Settings = { ...settings, ...override }
  const update = (patch: Partial<Settings>) => setOverride({ ...override, ...patch })
  const dirty = override !== null

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl">{t('settings.title')}</h1>
        <Button
          variant="primary"
          disabled={!dirty || save.isPending}
          onClick={() =>
            save.mutate(draft, {
              onSuccess: () => {
                setOverride(null)
                toast.success(t('settings.saved'))
              },
              onError: (error) => toastAppError(error),
            })
          }
        >
          <Save className="size-3.5" aria-hidden />
          {save.isPending ? t('common.saving') : t('common.save')}
        </Button>
      </header>

      <Section title={t('settings.appearance')}>
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{t('settings.language')}</span>
            <span className="text-muted text-[13px]">{t('settings.languageHint')}</span>
          </div>
          <Select
            ariaLabel={t('settings.language')}
            value={draft.language}
            onValueChange={(value) => update({ language: value as Language })}
            options={LANGUAGES.map((language) => ({
              value: language,
              label: LANGUAGE_LABEL[language],
            }))}
            className="min-w-40"
          />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <span className="text-sm">{t('settings.theme')}</span>
          <Select
            ariaLabel={t('settings.theme')}
            value={draft.theme}
            onValueChange={(value) => update({ theme: value as Settings['theme'] })}
            options={[
              { value: 'system', label: t('settings.themeSystem') },
              { value: 'light', label: t('settings.themeLight') },
              { value: 'dark', label: t('settings.themeDark') },
            ]}
            className="min-w-40"
          />
        </div>
      </Section>

      <Section title={t('settings.scanning')} hint={t('settings.scanPathsHint')}>
        <div className="flex flex-col gap-2 py-3">
          <span className="text-sm">{t('settings.scanPaths')}</span>
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
      </Section>

      <Section title={t('settings.network')} hint={t('settings.networkChecksHint')}>
        <SwitchField
          id="network-checks"
          label={t('settings.networkChecks')}
          checked={draft.networkVersionChecks}
          onCheckedChange={(checked) => update({ networkVersionChecks: checked })}
        />
        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <span className="text-sm">{t('settings.cacheMinutes')}</span>
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
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 py-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">{t('settings.proxy')}</span>
            <span className="text-muted text-[13px]">{t('settings.proxyHint')}</span>
          </div>
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
        </div>

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
            <p className="text-faint text-[12px]">{t('settings.proxyUrlHint')}</p>
          </div>
        ) : (
          <p className="text-faint py-3 text-[12px]">
            {draft.proxyMode === 'none'
              ? t('settings.proxyNoneHint')
              : t('settings.proxySystemHint')}
          </p>
        )}
      </Section>

      <Section title={t('settings.safety')} hint={t('settings.backupDirHint')}>
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
            <p className="text-faint text-[12px]">
              {t('settings.backupDirDefault', { path: backupRoot.data })}
            </p>
          ) : null}
        </div>
      </Section>

      <Section title={t('settings.catalog')} hint={t('settings.catalogDirHint')}>
        {catalogDir.data ? <PathRow path={catalogDir.data} className="py-3" /> : null}
      </Section>

      <Section title={t('settings.managers')}>
        {managers.data && managers.data.length > 0 ? (
          <ul className="flex flex-col gap-2 py-3">
            {managers.data.map((manager) => (
              <li key={manager.manager} className="flex items-center gap-2">
                <Badge tone="outline">{manager.manager}</Badge>
                <code className="text-faint truncate font-mono text-[11px]">{manager.path}</code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted py-3 text-[13px]">{t('settings.managersNone')}</p>
        )}
      </Section>

      <Section title={t('settings.about')}>
        <div className="flex flex-col gap-2 py-3">
          <span className="text-sm">
            {t('settings.aboutVersion', { version: __APP_VERSION__ })}
          </span>
          <p className="text-muted max-w-prose text-[13px]">{t('settings.aboutText')}</p>
          <Button
            variant="ghost"
            size="sm"
            className="self-start px-0"
            disabled={!catalogDir.data}
            onClick={() => void ipc.revealPath(catalogDir.data ?? '').catch(toastAppError)}
          >
            <FolderOpen className="size-3.5" aria-hidden />
            {t('common.reveal')}
          </Button>
        </div>
      </Section>
    </div>
  )
}
