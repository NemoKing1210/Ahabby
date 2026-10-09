import { ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'

import { AnimatedList } from '@/shared/ui/AnimatedList'
import { useTerminals } from '@/features/terminal/api/hooks'
import { BUILTIN_TERMINAL_ID } from '@/features/terminal/lib/terminal'

import { useSettingsDraft } from '../lib/draft'
import { SECTIONS } from '../lib/sections'
import { sectionSummary } from '../lib/summaries'

/**
 * The settings index: one row per area — what it is for, and what it currently says.
 *
 * It is the only way into an area (the shell has no rail of its own), so a row has to answer
 * "is this the one I want?" before it is opened: the description names the area, the line on the
 * right is its current value, read from the draft, so an unsaved edit is already described here.
 */
export function SettingsOverviewPage() {
  const { t } = useTranslation()
  const { draft } = useSettingsDraft()
  const terminals = useTerminals()

  const terminal = terminals.data?.options.find((option) => option.id === draft.terminal)
  const terminalName =
    draft.terminal === BUILTIN_TERMINAL_ID
      ? t('settings.terminalBuiltin')
      : (terminal?.name ?? t('settings.terminalUnknown', { terminal: draft.terminal }))

  return (
    <AnimatedList as="ul">
      {SECTIONS.map((section) => (
        <Link
          key={section.to}
          to={section.to}
          className="group border-border bg-surface hover:border-border-strong focus-visible:outline-ring ease-warm relative flex flex-wrap items-center gap-x-3.5 gap-y-2 border px-4 py-3.5 transition-[border-color,translate] duration-150 outline-none hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span
            aria-hidden
            className="bg-accent-soft text-accent-strong inline-flex size-10 shrink-0 items-center justify-center rounded-lg"
          >
            <section.icon className="size-[1.125rem]" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="group-hover:text-accent-strong font-serif text-[0.9375rem]">
              {t(section.labelKey)}
            </span>
            <span className="text-muted text-[0.8125rem]">{t(section.hintKey)}</span>
          </span>
          <span className="text-faint w-full text-[0.75rem] tabular-nums sm:ml-auto sm:w-auto sm:text-right">
            {sectionSummary(section.to, draft, t, { terminalName })}
          </span>
          <ChevronRight
            aria-hidden
            className="text-faint size-4 shrink-0 transition-transform duration-150 group-hover:translate-x-0.5"
          />
        </Link>
      ))}
    </AnimatedList>
  )
}
