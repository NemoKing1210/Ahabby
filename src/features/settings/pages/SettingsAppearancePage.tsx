import { Palette, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { APPEARANCE_DEFAULTS } from '@/app/appearance'
import type { FontFamily } from '@/shared/bindings/FontFamily'
import type { MonoFont } from '@/shared/bindings/MonoFont'
import type { Settings } from '@/shared/bindings/Settings'
import { LANGUAGES, type Language } from '@/shared/i18n'
import { ACCENT_PRESETS, DEFAULT_ACCENT_HEX, normalizeHex, presetHex } from '@/shared/lib/accent'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Input } from '@/shared/ui/Input'
import { LanguageFlag } from '@/shared/ui/LanguageFlag'
import { Select } from '@/shared/ui/Select'

import {
  SettingRow,
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

const LANGUAGE_LABEL: Record<Language, string> = {
  en: 'English',
  ru: 'Русский',
  zh: '中文',
  es: 'Español',
  de: 'Deutsch',
  ja: '日本語',
  fr: 'Français',
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

export function SettingsAppearancePage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={Palette}
        title={t('settings.appearance')}
        hint={t('settings.appearanceHint')}
      />

      <SettingsSections>
        <SettingsSection title={t('settings.general')}>
          <SettingRow label={t('settings.language')} hint={t('settings.languageHint')}>
            <Select
              ariaLabel={t('settings.language')}
              value={draft.language}
              onValueChange={(value) => update({ language: value as Language })}
              options={LANGUAGES.map((language) => ({
                value: language,
                label: LANGUAGE_LABEL[language],
                icon: <LanguageFlag language={language} />,
              }))}
              className="min-w-40"
            />
          </SettingRow>

          <SettingRow label={t('settings.theme')}>
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
          </SettingRow>
        </SettingsSection>

        <SettingsSection title={t('settings.accent')} hint={t('settings.accentHint')}>
          <div className="flex flex-col gap-3 py-3">
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
        </SettingsSection>

        <SettingsSection title={t('settings.type')} hint={t('settings.typeHint')}>
          <SettingRow label={t('settings.interfaceScale')} hint={t('settings.interfaceScaleHint')}>
            <ScaleSelect
              ariaLabel={t('settings.interfaceScale')}
              value={draft.interfaceScale}
              onChange={(value) => update({ interfaceScale: value })}
            />
          </SettingRow>

          <SettingRow label={t('settings.textScale')} hint={t('settings.textScaleHint')}>
            <ScaleSelect
              ariaLabel={t('settings.textScale')}
              value={draft.textScale}
              onChange={(value) => update({ textScale: value })}
            />
          </SettingRow>

          <SettingRow label={t('settings.fontFamily')} hint={t('settings.fontFamilyHint')}>
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
          </SettingRow>

          <SettingRow label={t('settings.codeFont')} hint={t('settings.codeFontHint')}>
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
          </SettingRow>

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
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
