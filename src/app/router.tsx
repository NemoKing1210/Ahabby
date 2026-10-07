import { Navigate, RouterProvider, createHashRouter } from 'react-router-dom'

import { AgentPage } from '@/features/agents/pages/AgentPage'
import { AgentsPage } from '@/features/agents/pages/AgentsPage'
import { HomePage } from '@/features/home/pages/HomePage'
import { HubPage } from '@/features/hub/pages/HubPage'
import { LibraryPage } from '@/features/library/pages/LibraryPage'
import { ProjectPage } from '@/features/projects/pages/ProjectPage'
import { ProjectsPage } from '@/features/projects/pages/ProjectsPage'
import { settingsRoutes } from '@/features/settings/routes'

import { AppShell } from './layouts/AppShell'

/**
 * Hash routing: the packaged app is served from a custom protocol where a server side SPA
 * fallback does not exist, and hash URLs are the one form that always resolves.
 *
 * `/` is the front door — what the program is, what the last scan found and where to go next —
 * and every other screen hangs off it as its own path, so a bookmark or a deep link always names
 * a screen instead of landing on the summary.
 *
 * There is no route for the terminal: it is a dock of the shell (`AppShell`), so several agents
 * can run in tabs under every screen instead of behind one.
 */
const router = createHashRouter([
  {
    path: '/',
    element: <AppShell />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'agents', element: <AgentsPage /> },
      { path: 'agents/:agentId', element: <AgentPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'hub', element: <HubPage /> },
      { path: 'projects', element: <ProjectsPage /> },
      { path: 'projects/:projectId', element: <ProjectPage /> },
      ...settingsRoutes,
      { path: '*', element: <Navigate to="/" replace /> },
    ],
  },
])

export function AppRouter() {
  return <RouterProvider router={router} />
}
