import { AppWindow } from 'lucide-react'
import { useTranslation } from 'react-i18next'

import { SwitchField } from '@/shared/ui/Switch'

import {
  SettingsPageHeading,
  SettingsSection,
  SettingsSections,
} from '../components/SettingsSection'
import { useSettingsDraft } from '../lib/draft'

/**
 * How Ahabby starts, and what closing its window means.
 *
 * Everything on this page is applied by the backend, not by the webview: the login item is
 * registered *before* the document is written (a registration the OS refused comes back as an
 * error and the draft stays unsaved, so the file never claims something the machine does not do),
 * and the tray icon and the close button are read live by `desktop::tray` / `desktop::window`.
 *
 * The two switches that can hide the window depend on the tray icon: without one there is nothing
 * to hide it *to*, so they are offered but not armed — the same rule the backend enforces on
 * load and on save.
 */
export function SettingsWindowPage() {
  const { t } = useTranslation()
  const { draft, update } = useSettingsDraft()
  const tray = draft.trayIcon

  return (
    <div className="flex flex-col gap-5">
      <SettingsPageHeading
        icon={AppWindow}
        title={t('settings.windowAndTray')}
        hint={t('settings.windowHint')}
      />

      <SettingsSections>
        <SettingsSection title={t('settings.startup')}>
          <SwitchField
            id="launch-at-login"
            label={t('settings.launchAtLogin')}
            hint={t('settings.launchAtLoginHint')}
            checked={draft.launchAtLogin}
            onCheckedChange={(launchAtLogin) => update({ launchAtLogin })}
          />
        </SettingsSection>

        <SettingsSection title={t('settings.tray')} hint={t('settings.trayHint')}>
          <SwitchField
            id="tray-icon"
            label={t('settings.trayIcon')}
            hint={t('settings.trayIconHint')}
            checked={tray}
            onCheckedChange={(trayIcon) =>
              // Switching the icon off cannot leave a window with nothing to hide it to, so the
              // two that need the tray go with it — exactly what the backend would do anyway.
              update({
                trayIcon,
                closeToTray: trayIcon && draft.closeToTray,
                startMinimized: trayIcon && draft.startMinimized,
              })
            }
          />
          <SwitchField
            id="close-to-tray"
            label={t('settings.closeToTray')}
            hint={tray ? t('settings.closeToTrayHint') : t('settings.needsTray')}
            checked={tray && draft.closeToTray}
            disabled={!tray}
            onCheckedChange={(closeToTray) => update({ closeToTray })}
          />
          <SwitchField
            id="start-minimized"
            label={t('settings.startMinimized')}
            hint={tray ? t('settings.startMinimizedHint') : t('settings.needsTray')}
            checked={tray && draft.startMinimized}
            disabled={!tray}
            onCheckedChange={(startMinimized) => update({ startMinimized })}
          />
        </SettingsSection>
      </SettingsSections>
    </div>
  )
}
