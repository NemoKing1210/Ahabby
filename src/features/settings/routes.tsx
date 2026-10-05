import { Navigate, type RouteObject } from 'react-router-dom'

import { SettingsLayout } from './pages/SettingsLayout'
import { SettingsAboutPage } from './pages/SettingsAboutPage'
import { SettingsAppearancePage } from './pages/SettingsAppearancePage'
import { SettingsHiddenPage } from './pages/SettingsHiddenPage'
import { SettingsNetworkPage } from './pages/SettingsNetworkPage'
import { SettingsSafetyPage } from './pages/SettingsSafetyPage'
import { SettingsSearchPage } from './pages/SettingsSearchPage'
import { SettingsTerminalPage } from './pages/SettingsTerminalPage'

/**
 * Settings is one layout with a subpage per area, exported as a route object so the app router
 * and the tests mount exactly the same tree. The bare `/settings` opens the first area.
 */
export const settingsRoutes: RouteObject[] = [
  {
    path: '/settings',
    element: <SettingsLayout />,
    children: [
      { index: true, element: <Navigate to="/settings/appearance" replace /> },
      { path: 'appearance', element: <SettingsAppearancePage /> },
      { path: 'terminal', element: <SettingsTerminalPage /> },
      { path: 'search', element: <SettingsSearchPage /> },
      { path: 'network', element: <SettingsNetworkPage /> },
      { path: 'safety', element: <SettingsSafetyPage /> },
      { path: 'hidden', element: <SettingsHiddenPage /> },
      { path: 'about', element: <SettingsAboutPage /> },
      { path: '*', element: <Navigate to="/settings/appearance" replace /> },
    ],
  },
]
