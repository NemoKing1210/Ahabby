import type { TFunction } from 'i18next'

import type { ProxyMode } from '@/shared/bindings/ProxyMode'
import type { Settings } from '@/shared/bindings/Settings'
import type { Theme } from '@/shared/bindings/Theme'

import type { SettingsAreaId } from './sections'

const THEME_KEY: Record<Theme, string> = {
  system: 'settings.themeSystem',
  light: 'settings.themeLight',
  dark: 'settings.themeDark',
}

const PROXY_KEY: Record<ProxyMode, string> = {
  none: 'settings.proxyNone',
  system: 'settings.proxySystem',
  manual: 'settings.proxyManual',
}

/** What the index needs about the machine that the settings document does not hold. */
export interface SummaryContext {
  /** How the terminal the run buttons use is named here (built-in, or the terminal's own name). */
  terminalName: string
}

/**
 * The current value of one area, as the index prints it under the description.
 *
 * It reads the *draft*, not the saved document, so an unsaved edit is described on the index
 * exactly as it is previewed inside the area — the two cannot disagree.
 */
export function sectionSummary(
  to: SettingsAreaId,
  settings: Settings,
  t: TFunction,
  { terminalName }: SummaryContext,
): string {
  const state = (on: boolean) => t(on ? 'settings.state.on' : 'settings.state.off')

  switch (to) {
    case 'appearance':
      return t('settings.sections.appearance.summary', {
        accent:
          settings.accent === 'custom'
            ? (settings.accentCustom ?? t('settings.accents.custom'))
            : t(`settings.accents.${settings.accent}`),
        theme: t(THEME_KEY[settings.theme]),
      })
    case 'window':
      return t('settings.sections.window.summary', {
        tray: state(settings.trayIcon),
        login: state(settings.launchAtLogin),
      })
    case 'terminal':
      return t('settings.sections.terminal.summary', {
        terminal: terminalName,
        scheme: t(`settings.terminalThemes.${settings.terminalTheme}`),
      })
    case 'search':
      return settings.extraScanPaths.length === 0
        ? t('settings.sections.search.summaryNone')
        : t('settings.sections.search.summary', { count: settings.extraScanPaths.length })
    case 'network':
      return t('settings.sections.network.summary', {
        checks: state(settings.networkVersionChecks),
        proxy: t(PROXY_KEY[settings.proxyMode]),
      })
    case 'sync':
      return settings.sync.enabled
        ? t('settings.sections.sync.summary', { minutes: settings.sync.autoIntervalMinutes })
        : t('settings.sections.sync.summaryOff')
    case 'safety':
      return settings.backupDir
        ? t('settings.sections.safety.summary', { dir: settings.backupDir })
        : t('settings.sections.safety.summaryDefault')
    case 'hidden':
      return settings.hiddenAgents.length === 0
        ? t('settings.sections.hidden.summaryNone')
        : t('settings.sections.hidden.summary', { count: settings.hiddenAgents.length })
    case 'about':
      return t('settings.aboutVersion', { version: __APP_VERSION__ })
  }
}
