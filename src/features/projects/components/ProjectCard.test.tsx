import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'
import { Route, Routes } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Project } from '@/shared/bindings/Project'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { renderWithProviders } from '@/test/render'

import { ProjectCard } from './ProjectCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    cachedAgents: vi.fn(),
    getSettings: vi.fn(),
    revealPath: vi.fn().mockResolvedValue(undefined),
  },
}))

const EMPTY_REPORT: ScanReport = {
  agents: [],
  problems: [],
  scannedAtMs: 0,
  durationMs: 0,
  installed: 0,
  availableToInstall: 0,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
  projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
}

function project(): Project {
  return {
    id: 'project:alpha',
    name: 'alpha',
    root: '/home/me/code/alpha',
    folderId: 'folder:one',
    skills: [],
    mcpServers: [],
    other: [],
    configs: [],
    modifiedMs: null,
    warnings: [],
    scanMs: 1,
  }
}

function renderCard(ui: React.ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(<QueryClientProvider client={client}>{ui}</QueryClientProvider>)
}

/** Right click the card's title — a hit area outside its own buttons. */
async function openMenu(container: HTMLElement) {
  fireEvent.contextMenu(within(container).getByText('alpha'), { clientX: 40, clientY: 60 })
  return within(await screen.findByRole('menu'))
}

describe('ProjectCard context menu', () => {
  it('offers the project actions', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(EMPTY_REPORT)
    const view = renderCard(<ProjectCard project={project()} />)

    expect(screen.queryByRole('menu')).toBeNull()

    const menu = await openMenu(view.container)
    expect(menu.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Run agent here' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()

    view.unmount()
  })

  it('opens the project page', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(EMPTY_REPORT)
    const view = renderCard(
      <Routes>
        <Route path="/" element={<ProjectCard project={project()} />} />
        <Route path="/projects/:projectId" element={<h1>Project details</h1>} />
      </Routes>,
    )

    fireEvent.click((await openMenu(view.container)).getByRole('menuitem', { name: 'Open' }))

    expect(await screen.findByRole('heading', { name: 'Project details' })).toBeInTheDocument()
    view.unmount()
  })

  it('runs an agent in the project root through the picker', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(EMPTY_REPORT)
    const view = renderCard(<ProjectCard project={project()} />)

    fireEvent.click(
      (await openMenu(view.container)).getByRole('menuitem', { name: 'Run agent here' }),
    )

    expect(await screen.findByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Run an agent in this project' })).toBeTruthy()
    view.unmount()
  })
})
