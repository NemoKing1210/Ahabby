import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Project } from '@/shared/bindings/Project'
import type { ProjectFolderStatus } from '@/shared/bindings/ProjectFolderStatus'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Skill } from '@/shared/bindings/Skill'
import { renderWithProviders } from '@/test/render'

import { ProjectsPage } from './ProjectsPage'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { cachedAgents: vi.fn(), addProjectFolder: vi.fn() },
}))

vi.mock('@/features/agents/api/scan', () => ({
  useScanRefresh: () => ({
    isScanning: false,
    scanning: new Set<string>(),
    landed: new Set<string>(),
    progress: { done: 0, total: 0 },
    rescan: vi.fn(),
  }),
}))

const FOLDER: ProjectFolderStatus = {
  folder: { id: 'folder:one', path: '/home/me/code', addedAtMs: 0 },
  resolved: '/home/me/code',
  exists: true,
  problem: null,
}

/** A project-local skill: enough for the card's resource badge. */
function skill(ownerId: string, ownerName: string, name: string): Skill {
  return {
    id: `${ownerId}:${name}`,
    name,
    description: null,
    path: `/home/me/code/${ownerName}/skills/${name}`,
    entryPath: `/home/me/code/${ownerName}/skills/${name}/SKILL.md`,
    scope: { kind: 'project', root: '/home/me/code' },
    agents: [{ id: ownerId, name: ownerName, icon: null }],
    frontmatter: [],
    content: '# body',
    sizeBytes: 10,
    enabled: true,
    removable: true,
    unverified: false,
  }
}

function project(
  id: string,
  name: string,
  skills: Skill[],
  overrides: Partial<Project> = {},
): Project {
  return {
    id,
    name,
    root: `/home/me/code/${name}`,
    folderId: FOLDER.folder.id,
    skills,
    mcpServers: [],
    other: [],
    configs: [],
    modifiedMs: null,
    warnings: [],
    scanMs: 1,
    ...overrides,
  }
}

function report(projects: Project[] = [], folders: ProjectFolderStatus[] = []): ScanReport {
  return {
    agents: [],
    problems: [],
    scannedAtMs: 0,
    durationMs: 0,
    installed: 0,
    availableToInstall: 0,
    os: 'windows',
    shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
    projects: { folders, projects, scannedAtMs: 0, durationMs: 0 },
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <ProjectsPage />
    </QueryClientProvider>,
  )
}

describe('ProjectsPage', () => {
  beforeEach(() => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(report())
  })

  afterEach(() => {
    cleanup()
  })

  it('renders each added folder with its projects and their resource badges', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(
      report(
        [
          project('project:a', 'alpha', [skill('project:a', 'alpha', 'lint')]),
          project('project:b', 'beta', [
            skill('project:b', 'beta', 'review'),
            skill('project:b', 'beta', 'test'),
          ]),
        ],
        [FOLDER],
      ),
    )

    const { container } = renderPage()

    // The folder is named after its last path segment.
    expect(await within(container).findByText('code')).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'alpha' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'beta' })).toBeTruthy()

    // One badge per non-empty resource count on each card.
    expect(within(container).getByText('1 skill')).toBeTruthy()
    expect(within(container).getByText('2 skills')).toBeTruthy()
    // The folder shows how many projects it holds.
    expect(within(container).getAllByText('2 projects').length).toBeGreaterThan(0)
  })

  it('shows the empty state until a folder is added', async () => {
    const { container } = renderPage()

    expect(await within(container).findByText('No project folders yet')).toBeTruthy()
    expect(within(container).queryByText('code')).toBeNull()
  })

  it('adds the typed path through the add-folder dialog', async () => {
    const user = userEvent.setup()
    const mutation = {
      data: { id: 'folder:two', path: '/tmp/picked', addedAtMs: 0 },
      report: {
        agents: [],
        problems: [],
        scannedAtMs: 0,
        durationMs: 0,
        installed: 0,
        availableToInstall: 0,
        os: 'windows',
        shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
        projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
      },
    }
    vi.mocked(ipc.addProjectFolder).mockResolvedValue(mutation as never)

    const { container } = renderPage()
    await within(container).findByText('No project folders yet')

    const addButtons = within(container).getAllByRole('button', { name: 'Add folder' })
    const open = addButtons[0]
    expect(open).toBeDefined()
    if (open) await user.click(open)

    // Radix renders the dialog in a portal on `document.body`, outside `container`.
    const dialog = within(screen.getByRole('dialog'))
    await user.type(dialog.getByRole('textbox', { name: 'Folder path' }), '/tmp/picked')
    await user.click(dialog.getByRole('button', { name: 'Add folder' }))

    expect(ipc.addProjectFolder).toHaveBeenCalledWith('/tmp/picked')
  })

  it('offers reveal and removal on the folder card menu', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(
      report([project('project:a', 'alpha', [])], [FOLDER]),
    )

    const { container } = renderPage()
    await within(container).findByText('code')

    fireEvent.contextMenu(within(container).getByText('code'), { clientX: 40, clientY: 60 })
    const menu = within(await screen.findByRole('menu'))
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()

    fireEvent.click(menu.getByRole('menuitem', { name: 'Remove' }))

    expect(screen.getByRole('dialog')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Remove /home/me/code?' })).toBeTruthy()
  })
})
