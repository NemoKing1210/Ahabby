import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, Plus, Save, Trash2, Undo2 } from 'lucide-react'

import { appearanceApplier, APPEARANCE_DEFAULTS } from '@/app/appearance'
import { themeApplier } from '@/app/theme'
import { ipc } from '@/shared/api/ipc'
import type { FontFamily } from '@/shared/bindings/FontFamily'
import type { MonoFont } from '@/shared/bindings/MonoFont'
import type { Settings } from '@/shared/bindings/Settings'
import { initI18n, LANGUAGES, type Language } from '@/shared/i18n'
import { ACCENT_PRESETS, DEFAULT_ACCENT_HEX, normalizeHex, presetHex } from '@/shared/lib/accent'
import { cn } from '@/shared/lib/cn'
import { AgentIcon } from '@/shared/ui/AgentIcon'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Card } from '@/shared/ui/Card'
import { Input } from '@/shared/ui/Input'
import { PageHeader } from '@/shared/ui/PageHeader'
import { PathRow } from '@/shared/ui/PathRow'
import { SkeletonList } from '@/shared/ui/Primitives'
import { Select } from '@/shared/ui/Select'
import { SwitchField } from '@/shared/ui/Switch'
import { toast, toastAppError } from '@/shared/ui/Toast'

import { useRestoreAgent } from '@/features/agents/api/queries'

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
      {hint ? <p className="text-muted text-[0.8125rem]">{hint}</p> : null}
      <div className="mt-2 flex flex-col">{children}</div>
    </Card>
  )
}

/** A labelled setting with its control on the right; every appearance row uses it. */
function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-sm">{label}</span>
        {hint ? <p className="text-muted max-w-prose text-[0.8125rem]">{hint}</p> : null}
      </div>
      {children}
    </div>
  )
}

/** Both size knobs offer the same steps: they are different axes, not different scales. */
const SCALE_STEPS = [90, 100, 110, 125] as const
const SCALE_LABEL_KEY: Record<(typeof SCALE_STEPS)[number], string> = {
  90: 'settings.scaleCompact',
  100: 'settings.scaleDefault',
  110: 'settings.scaleComfortable',
  125: 'settings.scaleLarge',
}

const FONT_FAMILIES: readonly FontFamily[] = ['inter', 'system', 'serif']
const MONO_FONTS: readonly MonoFont[] = ['jetbrains', 'system']

/** The step list both size knobs share; a hand-edited value outside it still shows up. */
function ScaleSelect({
  value,
  ariaLabel,
  onChange,
}: {
  value: number
  ariaLabel: string
  onChange: (value: number) => void
}) {
  const { t } = useTranslation()
  const options = SCALE_STEPS.map((step) => ({
    value: String(step),
    label: t(SCALE_LABEL_KEY[step]),
  }))
  if (!(SCALE_STEPS as readonly number[]).includes(value)) {
    options.push({ value: String(value), label: `${value}%` })
  }

  return (
    <Select
      ariaLabel={ariaLabel}
      value={String(value)}
      onValueChange={(next) => onChange(Number(next))}
      options={options}
      className="min-w-40"
    />
  )
}

/**
 * Applies the appearance draft to the real interface for as long as the page is open and puts
 * the saved values back when it closes, so a choice can be judged in place and an edit nobody
 * commits leaves nothing behind. Renders nothing: the whole thing is CSS custom properties on
 * the root element (`globals.css`).
 */
function LiveAppearance({ draft, saved }: { draft: Settings; saved: Settings }) {
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

function AccentSwatch({
  label,
  selected,
  onSelect,
  background,
}: {
  label: string
  selected: boolean
  onSelect: () => void
  background?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={selected}
      onClick={onSelect}
      className={cn(
        'border-border-strong ease-warm size-6 shrink-0 rounded-full border transition-[scale,outline-color] duration-150 hover:scale-110',
        selected && 'outline-accent outline-2 outline-offset-2',
      )}
      style={background ? { background } : undefined}
    />
  )
}

/** Shows the current draft in a small sample, right where it is being chosen. */
function AppearancePreview() {
  const { t } = useTranslation()

  return (
    <div className="border-border bg-surface-2 mt-3 rounded-lg border p-4">
      <div className="flex flex-col gap-2">
        <span className="text-faint text-[0.6875rem] tracking-wide uppercase">
          {t('settings.preview')}
        </span>
        <p className="font-serif text-lg">{t('settings.previewTitle')}</p>
        <p className="text-muted text-[0.8125rem]">{t('settings.previewBody')}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" size="sm">
            {t('settings.previewButton')}
          </Button>
          <Badge tone="accent">{t('settings.previewBadge')}</Badge>
          <code className="bg-surface text-muted rounded-md px-2 py-1 font-mono text-[0.75rem]">
            ahabby --scan
          </code>
        </div>
      </div>
    </div>
  )
}

export function SettingsPage() {
  const { t } = useTranslation()
  const { data: settings, isLoading } = useSettings()
  const save = useSaveSettings()
  const managers = usePackageManagers()
  const catalogDir = useUserCatalogDir()
  const backupRoot = useBackupRoot()
  const restore = useRestoreAgent()

  const [override, setOverride] = useState<Partial<Settings> | null>(null)

  if (isLoading || !settings) return <SkeletonList rows={4} />

  const draft: Settings = { ...settings, ...override }
  const update = (patch: Partial<Settings>) => setOverride({ ...override, ...patch })
  const dirty = override !== null

  return (
    <div className="flex flex-col gap-6">
      <PageHeader className="flex flex-wrap items-end justify-between gap-4">
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
      </PageHeader>

      <LiveAppearance draft={draft} saved={settings} />

      <Section title={t('settings.appearance')} hint={t('settings.appearanceHint')}>
        <Row label={t('settings.language')} hint={t('settings.languageHint')}>
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
        </Row>

        <Row label={t('settings.theme')}>
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
        </Row>

        <div className="flex flex-col gap-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-col gap-0.5">
              <span className="text-sm">{t('settings.accent')}</span>
              <p className="text-muted max-w-prose text-[0.8125rem]">{t('settings.accentHint')}</p>
            </div>
            <div
              role="group"
              aria-label={t('settings.accent')}
              className="flex flex-wrap items-center gap-2"
            >
              {ACCENT_PRESETS.map((preset) => (
                <AccentSwatch
                  key={preset.id}
                  label={t(`settings.accents.${preset.id}`)}
                  selected={draft.accent === preset.id}
                  background={preset.hex}
                  onSelect={() => update({ accent: preset.id })}
                />
              ))}
              <AccentSwatch
                label={t('settings.accents.custom')}
                selected={draft.accent === 'custom'}
                background="conic-gradient(from 0deg, #e05a5a, #e0994e, #7fa05f, #4aa79b, #5b9bd5, #a682d9, #d97a94, #e05a5a)"
                onSelect={() =>
                  update({
                    accent: 'custom',
                    accentCustom:
                      normalizeHex(draft.accentCustom ?? '') ??
                      presetHex(draft.accent) ??
                      DEFAULT_ACCENT_HEX,
                  })
                }
              />
            </div>
          </div>

          {draft.accent === 'custom' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="color"
                aria-label={t('settings.accentCustomPicker')}
                value={normalizeHex(draft.accentCustom ?? '') ?? DEFAULT_ACCENT_HEX}
                onChange={(event) => update({ accentCustom: event.target.value })}
                className="border-border bg-surface h-9 w-12 cursor-pointer rounded-lg border p-1"
              />
              <Input
                className="w-32 font-mono"
                value={draft.accentCustom ?? ''}
                placeholder={DEFAULT_ACCENT_HEX}
                aria-label={t('settings.accentCustom')}
                onChange={(event) => update({ accentCustom: event.target.value })}
              />
              {normalizeHex(draft.accentCustom ?? '') ? null : (
                <span className="text-danger-fg text-[0.75rem]">
                  {t('settings.accentCustomInvalid')}
                </span>
              )}
            </div>
          ) : null}
        </div>

        <Row label={t('settings.interfaceScale')} hint={t('settings.interfaceScaleHint')}>
          <ScaleSelect
            ariaLabel={t('settings.interfaceScale')}
            value={draft.interfaceScale}
            onChange={(value) => update({ interfaceScale: value })}
          />
        </Row>

        <Row label={t('settings.textScale')} hint={t('settings.textScaleHint')}>
          <ScaleSelect
            ariaLabel={t('settings.textScale')}
            value={draft.textScale}
            onChange={(value) => update({ textScale: value })}
          />
        </Row>

        <Row label={t('settings.fontFamily')} hint={t('settings.fontFamilyHint')}>
          <Select
            ariaLabel={t('settings.fontFamily')}
            value={draft.fontFamily}
            onValueChange={(value) => update({ fontFamily: value as FontFamily })}
            options={FONT_FAMILIES.map((family) => ({
              value: family,
              label: t(`settings.fonts.${family}`),
            }))}
            className="min-w-40"
          />
        </Row>

        <Row label={t('settings.codeFont')} hint={t('settings.codeFontHint')}>
          <Select
            ariaLabel={t('settings.codeFont')}
            value={draft.monoFont}
            onValueChange={(value) => update({ monoFont: value as MonoFont })}
            options={MONO_FONTS.map((mono) => ({
              value: mono,
              label: t(`settings.monos.${mono}`),
            }))}
            className="min-w-40"
          />
        </Row>

        <Button
          variant="ghost"
          size="sm"
          className="mt-1 self-start px-0"
          onClick={() => update({ ...APPEARANCE_DEFAULTS })}
        >
          <Undo2 className="size-3.5" aria-hidden />
          {t('settings.resetAppearance')}
        </Button>

        <AppearancePreview />
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
            <span className="text-muted text-[0.8125rem]">{t('settings.proxyHint')}</span>
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
            <p className="text-faint text-[0.75rem]">{t('settings.proxyUrlHint')}</p>
          </div>
        ) : (
          <p className="text-faint py-3 text-[0.75rem]">
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
            <p className="text-faint text-[0.75rem]">
              {t('settings.backupDirDefault', { path: backupRoot.data })}
            </p>
          ) : null}
        </div>
      </Section>

      <Section title={t('settings.catalog')} hint={t('settings.catalogDirHint')}>
        {catalogDir.data ? <PathRow path={catalogDir.data} className="py-3" /> : null}
      </Section>

      <Section title={t('settings.hiddenAgents')} hint={t('settings.hiddenAgentsHint')}>
        {settings.hiddenAgents.length === 0 ? (
          <p className="text-muted py-3 text-[0.8125rem]">{t('settings.hiddenAgentsNone')}</p>
        ) : (
          <ul className="flex flex-col gap-2 py-3">
            {settings.hiddenAgents.map((hidden) => (
              <li key={hidden.id} className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <AgentIcon name={hidden.name} icon={hidden.icon} size="sm" />
                  <span className="truncate text-sm">{hidden.name}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={restore.isPending}
                  onClick={() =>
                    restore.mutate(hidden.id, {
                      onSuccess: () =>
                        toast.success(t('settings.agentRestored', { name: hidden.name })),
                      onError: (error) => toastAppError(error),
                    })
                  }
                >
                  <Undo2 className="size-3.5" aria-hidden />
                  {t('settings.restoreAgent')}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title={t('settings.about')}>
        {managers.data && managers.data.length > 0 ? (
          <ul className="flex flex-col gap-2 py-3">
            {managers.data.map((manager) => (
              <li key={manager.manager} className="flex items-center gap-2">
                <Badge tone="outline">{manager.manager}</Badge>
                <code className="text-faint truncate font-mono text-[0.6875rem]">
                  {manager.path}
                </code>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted py-3 text-[0.8125rem]">{t('settings.managersNone')}</p>
        )}
      </Section>

      <Section title={t('settings.about')}>
        <div className="flex flex-col gap-2 py-3">
          <span className="text-sm">
            {t('settings.aboutVersion', { version: __APP_VERSION__ })}
          </span>
          <p className="text-muted max-w-prose text-[0.8125rem]">{t('settings.aboutText')}</p>
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
