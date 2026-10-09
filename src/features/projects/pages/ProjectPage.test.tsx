import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { ConfigFile } from '@/shared/bindings/ConfigFile'
import type { ConfigSnapshot } from '@/shared/bindings/ConfigSnapshot'
import type { Project } from '@/shared/bindings/Project'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { renderWithProviders } from '@/test/render'

import { ProjectPage } from './ProjectPage'

/**
 * The project's Files tab is the config list of the project surface: one card per addressable
 * file, each offering the file's content (read-only) as well as an edit of it.
 *
 * CodeMirror is replaced by a textarea — what this file is about is which document the tab
 * hands to the editor, not how the editor draws it.
 */
vi.mock('@/shared/ui/CodeViewer', () => ({
  CodeViewer: ({
    value,
    editable,
    onChange,
    ariaLabel,
  }: {
    value: string
    editable?: boolean
    onChange?: (value: string) => void
    ariaLabel?: string
  }) => (
    <textarea
      aria-label={ariaLabel}
      readOnly={!editable}
      value={value}
      onChange={(event) => onChange?.(event.target.value)}
    />
  ),
}))

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    cachedAgents: vi.fn(),
    readConfig: vi.fn(),
    listBackups: vi.fn(),
    revealPath: vi.fn(),
  },
}))

const PROJECT_ID = 'project:a'
const MCP_PATH = '/home/me/code/alpha/.mcp.json'
const MCP_CONTENT = '{\n  "mcpServers": {}\n}\n'

function mcpConfig(overrides: Partial<ConfigFile> = {}): ConfigFile {
  return {
    id: 'mcp-json',
    label: '.mcp.json',
    description: 'Project-scoped MCP servers, shared with the team.',
    path: MCP_PATH,
    format: 'json',
    scope: { kind: 'project', root: '/home/me/code/alpha' },
    agent: { id: PROJECT_ID, name: 'alpha', icon: null },
    exists: true,
    sizeBytes: MCP_CONTENT.length,
    modifiedMs: 1_700_000_000_000,
    editable: true,
    ...overrides,
  }
}

function snapshot(overrides: Partial<ConfigSnapshot> = {}): ConfigSnapshot {
  return {
    path: MCP_PATH,
    format: 'json',
    content: MCP_CONTENT,
    sha256: 'sha-of-mcp',
    sizeBytes: MCP_CONTENT.length,
    modifiedMs: 1_700_000_000_000,
    exists: true,
    truncated: false,
    editable: true,
    ...overrides,
  }
}

function project(configs: ConfigFile[]): Project {
  return {
    id: PROJECT_ID,
    name: 'alpha',
    root: '/home/me/code/alpha',
    folderId: 'folder:one',
    skills: [],
    mcpServers: [],
    other: [],
    configs,
    modifiedMs: null,
    warnings: [],
    scanMs: 1,
  }
}

function report(projects: Project[]): ScanReport {
  return {
    agents: [],
    problems: [],
    scannedAtMs: 0,
    durationMs: 0,
    installed: 0,
    availableToInstall: 0,
    os: 'windows',
    shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
    projects: { folders: [], projects, scannedAtMs: 0, durationMs: 0 },
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <Routes>
        <Route path="/projects/:projectId" element={<ProjectPage />} />
      </Routes>
    </QueryClientProvider>,
    { route: `/projects/${PROJECT_ID}` },
  )
}

/** The Files tab, once its list has landed. */
async function openFilesTab(container: HTMLElement) {
  const user = userEvent.setup()
  await user.click(await within(container).findByRole('tab', { name: /^Files/ }))
  return user
}

afterEach(() => {
  cleanup()
})

describe('ProjectPage', () => {
  beforeEach(() => {
    vi.mocked(ipc.readConfig).mockResolvedValue(snapshot())
    vi.mocked(ipc.listBackups).mockResolvedValue([])
  })

  it('reads a project file in the Files tab without opening it for editing', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(report([project([mcpConfig()])]))
    const { container } = renderPage()
    const user = await openFilesTab(container)

    // The card describes the file the way the agent pages describe a config: label, format,
    // description and the path, with the two actions side by side.
    const card = await within(container).findByText('.mcp.json')
    expect(card).toBeTruthy()
    expect(
      within(container).getByText('Project-scoped MCP servers, shared with the team.'),
    ).toBeTruthy()

    await user.click(within(container).getByRole('button', { name: 'View' }))

    // Reading goes through the project's own id — the backend re-roots it — and lands in a
    // read-only editor: the text is there, the Save button is not offered.
    await waitFor(() => {
      expect(ipc.readConfig).toHaveBeenCalledWith(PROJECT_ID, MCP_PATH)
    })
    const editor = await screen.findByRole('textbox', { name: '.mcp.json' })
    expect((editor as HTMLTextAreaElement).readOnly).toBe(true)
    expect((editor as HTMLTextAreaElement).value).toBe(MCP_CONTENT)
    expect(screen.getByRole('button', { name: /Save/ })).toBeDisabled()
  })

  it('edits a project file from the same card', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(report([project([mcpConfig()])]))
    const { container } = renderPage()
    const user = await openFilesTab(container)

    await user.click(within(container).getByRole('button', { name: 'Edit' }))

    const editor = await screen.findByRole('textbox', { name: '.mcp.json' })
    expect((editor as HTMLTextAreaElement).readOnly).toBe(false)
  })

  it('offers Create for a declared file that is not on disk yet', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(
      report([project([mcpConfig({ exists: false, sizeBytes: null, modifiedMs: null })])]),
    )
    const { container } = renderPage()
    await openFilesTab(container)

    expect(within(container).getByRole('button', { name: /Create/ })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'View' })).toBeDisabled()
  })

  it('says a project declares no files in the project’s own words', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(report([project([])]))
    const { container } = renderPage()
    await openFilesTab(container)

    expect(
      within(container).getByText('Ahabby found no addressable files in this project.'),
    ).toBeTruthy()
  })
})
