import type { LucideIcon } from 'lucide-react'
import {
  AppWindow,
  CloudCog,
  EyeOff,
  Globe,
  Info,
  Palette,
  Search,
  ShieldCheck,
  Terminal,
} from 'lucide-react'

/**
 * One area of Settings: where it lives, what it is called and the line the index shows under
 * the name. The order of [`SECTIONS`] is the order of the index, so the settings screen has one
 * table of contents rather than a copy in the shell and another in the overview.
 */
export interface SettingsArea {
  /** Route of the area under `/settings`, and the key `sectionSummary` switches on. */
  to: string
  /** i18n key of the name, shared with the area's own heading. */
  labelKey: string
  /** i18n key of the one-line description shown on the index. */
  hintKey: string
  icon: LucideIcon
}

export const SECTIONS = [
  {
    to: 'appearance',
    labelKey: 'settings.appearance',
    hintKey: 'settings.sections.appearance.hint',
    icon: Palette,
  },
  {
    to: 'window',
    labelKey: 'settings.windowAndTray',
    hintKey: 'settings.windowHint',
    icon: AppWindow,
  },
  {
    to: 'terminal',
    labelKey: 'settings.terminal',
    hintKey: 'settings.terminalHint',
    icon: Terminal,
  },
  {
    to: 'search',
    labelKey: 'settings.searchAndCatalog',
    hintKey: 'settings.searchHint',
    icon: Search,
  },
  { to: 'network', labelKey: 'settings.network', hintKey: 'settings.networkHint', icon: Globe },
  { to: 'sync', labelKey: 'settings.sync', hintKey: 'settings.syncHint', icon: CloudCog },
  {
    to: 'safety',
    labelKey: 'settings.safety',
    hintKey: 'settings.backupDirHint',
    icon: ShieldCheck,
  },
  {
    to: 'hidden',
    labelKey: 'settings.hiddenAgents',
    hintKey: 'settings.hiddenAgentsHint',
    icon: EyeOff,
  },
  { to: 'about', labelKey: 'settings.about', hintKey: 'settings.sections.about.hint', icon: Info },
] as const satisfies readonly SettingsArea[]

/** The route name of an area — what `sectionSummary` and the index rows are keyed by. */
export type SettingsAreaId = (typeof SECTIONS)[number]['to']
