import type { ITheme } from '@xterm/xterm'
import { Check, RefreshCw, Terminal as TerminalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import type { TerminalTheme } from '@/shared/bindings/TerminalTheme'
import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

import { useTerminals } from '@/features/terminal/api/hooks'
import { BUILTIN_TERMINAL_ID } from '@/features/terminal/lib/terminal'
import { terminalTheme } from '@/features/terminal/lib/theme'
import { TERMINAL_THEME_ORDER, withAlpha } from '@/features/terminal/lib/themes'

import {
  SettingRow,
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

/** The ANSI colours shown as dots on a swatch — enough to judge a scheme at a glance. */
const SWATCH_DOTS = ['red', 'green', 'yellow', 'blue', 'magenta', 'cyan'] as const

/** The scheme's colours in miniature: its own background, its text colour and the ANSI dots. */
function SchemeSwatch({ theme }: { theme: ITheme }) {
  return (
    <span
      aria-hidden
      className="flex h-10 items-center gap-1.5 rounded-md px-2"
      style={{ background: theme.background }}
    >
      <span className="font-mono text-[0.875rem] leading-none" style={{ color: theme.foreground }}>
        ❯
      </span>
      {SWATCH_DOTS.map((dot) => (
        <span key={dot} className="size-2 rounded-full" style={{ background: theme[dot] }} />
      ))}
    </span>
  )
}

function SchemeCard({
  id,
  name,
  hint,
  selected,
  onSelect,
}: {
  id: TerminalTheme
  name: string
  hint?: string
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
      <SchemeSwatch theme={terminalTheme(id)} />
      <span className="flex min-w-0 items-center gap-1.5 px-0.5">
        <span className="truncate text-[0.8125rem]">{name}</span>
        {selected ? <Check className="text-accent-strong size-3.5 shrink-0" aria-hidden /> : null}
      </span>
      {hint ? (
        <span className="text-faint -mt-1.5 px-0.5 text-[0.75rem] leading-snug">{hint}</span>
      ) : null}
    </button>
  )
}

/**
 * A miniature terminal painted with the chosen scheme.
 *
 * It reads the very same `terminalTheme` the dock does, so what is on screen here is what the
 * terminal will look like — including the selection colour, which is easiest to judge on text.
 */
function SchemePreview({ id }: { id: TerminalTheme }) {
  const { t } = useTranslation()
  const theme = terminalTheme(id)
  const ink = theme.foreground ?? '#ffffff'
  const muted = withAlpha(ink, 0.6) ?? ink
  const divider = withAlpha(ink, 0.15) ?? ink

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ background: theme.background, borderColor: divider }}
    >
      <div
        className="flex items-center justify-between gap-3 px-3 py-1.5 text-[0.6875rem] tracking-wide uppercase"
        style={{ color: muted, borderBottom: `1px solid ${divider}` }}
      >
        <span>{t('settings.preview')}</span>
        <span className="truncate normal-case">{t(`settings.terminalThemes.${id}`)}</span>
      </div>
      <div
        className="flex flex-col gap-1 px-3 py-2.5 font-mono text-[0.8125rem] leading-relaxed"
        style={{ color: theme.foreground }}
      >
        <span>
          <span style={{ color: theme.cursor }}>❯ </span>
          {t('settings.terminalPreviewCommand')}
        </span>
        <span style={{ color: theme.green }}>✓ {t('settings.terminalPreviewReady')}</span>
        <span>
          <span
            className="rounded-[3px] px-0.5"
            style={{ background: theme.selectionBackground, color: theme.foreground }}
          >
            ! {t('settings.terminalPreviewPending')}
          </span>
        </span>
        <span
          aria-hidden
          className="mt-0.5 inline-block h-4 w-2 rounded-[2px]"
          style={{ background: theme.cursor }}
        />
      </div>
    </div>
  )
}

export function SettingsTerminalPage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()
  const terminals = useTerminals()

  const chosenTerminal = terminals.data?.options.find((option) => option.id === draft.terminal)
  const terminalMissing =
    draft.terminal !== BUILTIN_TERMINAL_ID && terminals.isSuccess && !chosenTerminal
  // The built-in terminal is always offered, whatever the backend reported; the installed ones
  // come after it. A terminal that is not installed any more keeps its place in the setting, so
  // the select has to be able to show it rather than silently losing the value.
  const terminalOptions = [
    { value: BUILTIN_TERMINAL_ID, label: t('settings.terminalBuiltin') },
    ...(terminals.data?.options ?? [])
      .filter((option) => option.id !== BUILTIN_TERMINAL_ID)
      .map((option) => ({ value: option.id, label: option.name })),
  ]
  if (!terminalOptions.some((option) => option.value === draft.terminal)) {
    terminalOptions.push({
      value: draft.terminal,
      label: t('settings.terminalUnknown', { terminal: draft.terminal }),
    })
  }
  const terminalHint = terminalMissing
    ? t('settings.terminalMissing', { terminal: draft.terminal })
    : chosenTerminal?.capability === 'opensDirectory'
      ? t('settings.terminalOpensDirectory', { terminal: chosenTerminal.name })
      : chosenTerminal && chosenTerminal.id !== BUILTIN_TERMINAL_ID
        ? t('settings.terminalRunsCommand', { terminal: chosenTerminal.name })
        : t('settings.terminalBuiltinHint')

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={TerminalIcon}
        title={t('settings.terminal')}
        hint={t('settings.terminalHint')}
      />

      <SettingsSections>
        <SettingsSection
          title={t('settings.terminalColors')}
          hint={t('settings.terminalColorsHint')}
        >
          <div
            role="radiogroup"
            aria-label={t('settings.terminalColors')}
            className="grid grid-cols-2 gap-2 pt-3 pb-1 sm:grid-cols-3 2xl:grid-cols-5"
          >
            {TERMINAL_THEME_ORDER.map((id) => (
              <SchemeCard
                key={id}
                id={id}
                name={t(`settings.terminalThemes.${id}`)}
                hint={id === 'auto' ? t('settings.terminalThemeAutoHint') : undefined}
                selected={draft.terminalTheme === id}
                onSelect={() => update({ terminalTheme: id })}
              />
            ))}
          </div>

          <SchemePreview id={draft.terminalTheme} />
        </SettingsSection>

        <SettingsSection title={t('settings.terminalRunIn')}>
          <SettingRow label={t('settings.terminalDefault')} hint={terminalHint}>
            <Select
              ariaLabel={t('settings.terminalDefault')}
              value={draft.terminal}
              onValueChange={(value) => update({ terminal: value })}
              options={terminalOptions}
              className="min-w-48"
            />
          </SettingRow>

          {chosenTerminal?.path ? (
            <code className="text-faint truncate pb-2 font-mono text-[0.75rem]">
              {chosenTerminal.path}
            </code>
          ) : null}

          <div className="flex items-center gap-2 pb-1">
            <Button
              variant="ghost"
              size="sm"
              className="px-0"
              disabled={terminals.isFetching}
              onClick={() => void terminals.refetch()}
            >
              <RefreshCw
                className={cn('size-3.5', terminals.isFetching && 'animate-spin')}
                aria-hidden
              />
              {t('settings.terminalRefresh')}
            </Button>
            {terminalMissing ? (
              <Badge tone="warning">{t('settings.terminalNotInstalled')}</Badge>
            ) : null}
          </div>
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
