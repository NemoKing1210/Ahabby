import { Navigate, type RouteObject } from 'react-router-dom'

import { SettingsLayout } from './pages/SettingsLayout'
import { SettingsAboutPage } from './pages/SettingsAboutPage'
import { SettingsAppearancePage } from './pages/SettingsAppearancePage'
import { SettingsHiddenPage } from './pages/SettingsHiddenPage'
import { SettingsNetworkPage } from './pages/SettingsNetworkPage'
import { SettingsOverviewPage } from './pages/SettingsOverviewPage'
import { SettingsSafetyPage } from './pages/SettingsSafetyPage'
import { SettingsSearchPage } from './pages/SettingsSearchPage'
import { SettingsSyncPage } from './pages/SettingsSyncPage'
import { SettingsTerminalPage } from './pages/SettingsTerminalPage'
import { SettingsWindowPage } from './pages/SettingsWindowPage'

/**
 * Settings is one layout with a subpage per area, exported as a route object so the app router
 * and the tests mount exactly the same tree. The bare `/settings` is the index of the areas —
 * the only way into one — and anything unknown under it falls back there.
 */
export const settingsRoutes: RouteObject[] = [
  {
    path: '/settings',
    element: <SettingsLayout />,
    children: [
      { index: true, element: <SettingsOverviewPage /> },
      { path: 'appearance', element: <SettingsAppearancePage /> },
      { path: 'window', element: <SettingsWindowPage /> },
      { path: 'terminal', element: <SettingsTerminalPage /> },
      { path: 'search', element: <SettingsSearchPage /> },
      { path: 'network', element: <SettingsNetworkPage /> },
      { path: 'sync', element: <SettingsSyncPage /> },
      { path: 'safety', element: <SettingsSafetyPage /> },
      { path: 'hidden', element: <SettingsHiddenPage /> },
      { path: 'about', element: <SettingsAboutPage /> },
      { path: '*', element: <Navigate to="/settings" replace /> },
    ],
  },
]
