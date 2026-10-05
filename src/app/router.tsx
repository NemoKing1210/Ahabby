import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom'

import { AgentPage } from '@/features/agents/pages/AgentPage'
import { AgentsPage } from '@/features/agents/pages/AgentsPage'
import { LibraryPage } from '@/features/library/pages/LibraryPage'
import { SettingsPage } from '@/features/settings/pages/SettingsPage'

import { AppShell } from './layouts/AppShell'

/**
 * Hash routing: the packaged app is served from a custom protocol where a server side SPA
 * fallback does not exist, and hash URLs are the one form that always resolves.
 *
 * There is no route for the terminal: it is a dock of the shell (`AppShell`), so several agents
 * can run in tabs under every screen instead of behind one.
 */
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <AgentsPage /> },
      { path: 'agents/:agentId', element: <AgentPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
