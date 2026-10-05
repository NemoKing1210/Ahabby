import { RefreshCw, Terminal as TerminalIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { cn } from '@/shared/lib/cn'
import { Badge } from '@/shared/ui/Badge'
import { Button } from '@/shared/ui/Button'
import { Select } from '@/shared/ui/Select'

import { BUILTIN_TERMINAL_ID } from '@/features/terminal/lib/terminal'
import { useTerminals } from '@/features/terminal/api/hooks'

import { SettingRow, SettingsPageHeading, SettingsSection } from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

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

      <SettingsSection>
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
    </div>
  )
}
