import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { HubEntry } from '@/shared/bindings/HubEntry'
import type { HubEntryDetail } from '@/shared/bindings/HubEntryDetail'
import type { HubPage as HubPageResult } from '@/shared/bindings/HubPage'
import type { HubSource } from '@/shared/bindings/HubSource'
import type { HubSourceReport } from '@/shared/bindings/HubSourceReport'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { renderWithProviders } from '@/test/render'

import { HubPage } from './HubPage'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    listHubSources: vi.fn(),
    searchHub: vi.fn(),
    getHubEntry: vi.fn(),
    installHubResource: vi.fn(),
    cachedAgents: vi.fn(),
    openUrl: vi.fn(),
  },
}))

const SKILLS_SOURCE: HubSource = {
  id: 'example-skills',
  name: 'Example Skills',
  kind: 'githubSkills',
  description: 'A collection of skills.',
  provides: ['skill'],
  homepage: 'https://github.com/owner/repo',
  docs: null,
  license: 'MIT',
  vendor: 'Owner',
  url: null,
  repository: 'owner/repo',
  gitRef: null,
  path: null,
  exclude: [],
  builtin: true,
  sourceFile: null,
}

const REGISTRY_SOURCE: HubSource = {
  ...SKILLS_SOURCE,
  id: 'mcp-registry',
  name: 'MCP Registry',
  kind: 'mcpRegistry',
  provides: ['mcp'],
  repository: null,
  url: 'https://registry.example.com',
}

function entry(overrides: Partial<HubEntry> = {}): HubEntry {
  return {
    id: 'example-skills/skills/pdf',
    sourceId: 'example-skills',
    sourceName: 'Example Skills',
    kind: 'skill',
    name: 'pdf',
    title: null,
    description: 'Read and fill PDF forms.',
    version: null,
    vendor: 'Owner',
    homepage: null,
    repository: 'https://github.com/owner/repo',
    license: 'MIT',
    tags: [],
    fileCount: 2,
    sizeBytes: 2048,
    installable: true,
    installProblem: null,
    inputCount: 0,
    hasScripts: true,
    ...overrides,
  }
}

function report(overrides: Partial<HubSourceReport> = {}): HubSourceReport {
  return {
    id: 'example-skills',
    name: 'Example Skills',
    kind: 'githubSkills',
    provides: ['skill'],
    description: 'A collection of skills.',
    homepage: 'https://github.com/owner/repo',
    builtin: true,
    count: 1,
    total: 1,
    nextCursor: null,
    durationMs: 12,
    fromCache: false,
    error: null,
    problems: [],
    ...overrides,
  }
}

function page(overrides: Partial<HubPageResult> = {}): HubPageResult {
  return { entries: [entry()], report: report(), fetchedAtMs: 0, ...overrides }
}

/** A scan report with one installed agent and one project: both are install targets. */
function scanReport(): ScanReport {
  return {
    agents: [
      {
        id: 'demo',
        name: 'Demo Agent',
        description: 'Fixture agent',
        tagline: null,
        icon: null,
        category: null,
        website: null,
        docs: null,
        vendor: null,
        features: [],
        github: null,
        popular: false,
        status: 'installed',
        binaryPath: '/bin/demo',
        foundIn: 'path',
        version: null,
        installedVia: null,
        installOptions: [],
        canInstall: false,
        installDocsUrl: null,
        canUpdate: false,
        canUninstall: false,
        configs: [],
        facts: [],
        skills: [],
        mcpServers: [],
        other: [],
        update: null,
        unverified: [],
        notes: null,
        manifestSource: { kind: 'builtin' },
        removal: 'hidden',
        warnings: [],
        scanMs: 1,
      },
    ],
    problems: [],
    scannedAtMs: 0,
    durationMs: 0,
    installed: 1,
    availableToInstall: 0,
    os: 'windows',
    shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
    projects: {
      folders: [],
      projects: [
        {
          id: 'project:abc',
          name: 'app',
          root: '/home/me/app',
          folderId: 'folder:one',
          skills: [],
          mcpServers: [],
          other: [],
          configs: [],
          modifiedMs: null,
          warnings: [],
          scanMs: 1,
        },
      ],
      scannedAtMs: 0,
      durationMs: 0,
    },
  }
}

function skillDetail(): HubEntryDetail {
  return {
    entry: entry(),
    files: [
      { path: 'SKILL.md', sizeBytes: 1200, kind: 'text' },
      { path: 'scripts/fill.py', sizeBytes: 848, kind: 'script' },
    ],
    preview: {
      path: 'SKILL.md',
      content: '# PDF toolkit\n\nFill the form in one pass.',
      frontmatter: [{ key: 'name', value: 'pdf' }],
      truncated: false,
    },
    transport: null,
    inputs: [],
    sourceUrl: 'https://github.com/owner/repo/skills/pdf',
  }
}

function serverDetail(): HubEntryDetail {
  return {
    entry: entry({
      id: 'mcp-registry/com.example/files',
      sourceId: 'mcp-registry',
      sourceName: 'MCP Registry',
      kind: 'mcp',
      name: 'com.example/files',
      description: 'Reads files',
      fileCount: null,
      sizeBytes: null,
      hasScripts: false,
      inputCount: 1,
    }),
    files: [],
    preview: null,
    transport: { type: 'stdio', command: 'npx', args: ['-y', '@example/files-mcp'] },
    inputs: [
      { key: 'ROOT', description: 'Root to serve', required: true, secret: false, default: null },
    ],
    sourceUrl: 'https://example.com/files',
  }
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <HubPage />
    </QueryClientProvider>,
  )
}

describe('HubPage', () => {
  beforeEach(() => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(scanReport())
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE, REGISTRY_SOURCE],
      problems: [],
      userDir: '/home/me/.config/ahabby/hub',
    })
    vi.mocked(ipc.searchHub).mockImplementation((sourceId) =>
      Promise.resolve(
        sourceId === SKILLS_SOURCE.id
          ? page()
          : page({
              entries: [
                entry({
                  id: 'mcp-registry/com.example/files',
                  sourceId: 'mcp-registry',
                  sourceName: 'MCP Registry',
                  kind: 'mcp',
                  name: 'com.example/files',
                  description: 'Reads files',
                  hasScripts: false,
                }),
              ],
              report: report({ id: 'mcp-registry', name: 'MCP Registry', kind: 'mcpRegistry' }),
            }),
      ),
    )
    vi.mocked(ipc.getHubEntry).mockResolvedValue(skillDetail())
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('renders one section per source and installs nothing on its own', async () => {
    const { container } = renderPage()

    expect(await within(container).findByText('Example Skills')).toBeTruthy()
    expect(within(container).getByText('MCP Registry')).toBeTruthy()
    expect(within(container).getByText('Read and fill PDF forms.')).toBeTruthy()
    expect(within(container).getByText('Runs scripts')).toBeTruthy()
    expect(ipc.installHubResource).not.toHaveBeenCalled()
    // The folder the user's own sources go in is shown, so a collection can be added by hand.
    expect(within(container).getByText('/home/me/.config/ahabby/hub')).toBeTruthy()
  })

  it('asks only the sources that offer the chosen kind', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('MCP Registry')

    vi.mocked(ipc.searchHub).mockClear()
    await user.click(screen.getByRole('button', { name: 'Skills' }))

    // The MCP registry is not read at all for a skills-only view — that is a tarball and a
    // request nobody asked for.
    expect(within(container).queryByText('MCP Registry')).toBeNull()
    const asked = vi.mocked(ipc.searchHub).mock.calls.map(([sourceId]) => sourceId)
    expect(asked).toContain(SKILLS_SOURCE.id)
    expect(asked).not.toContain(REGISTRY_SOURCE.id)
  })

  it('reviews a skill and confirms the install for the chosen owner', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
      userDir: '/home/me/.config/ahabby/hub',
    })
    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    await user.click(within(container).getByRole('button', { name: 'Install' }))

    // The review step: every file, and the warning about what an agent may run.
    expect(await screen.findByText('What will be written')).toBeTruthy()
    expect(screen.getByText('scripts/fill.py')).toBeTruthy()
    expect(screen.getByText(/scripts the agent may run/)).toBeTruthy()
    // The owner picker offers the shared surface, the installed agent and the project.
    expect(screen.getByText('Shared')).toBeTruthy()

    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }))

    expect(ipc.installHubResource).toHaveBeenCalledWith({
      ownerId: 'shared',
      entryId: 'example-skills/skills/pdf',
      name: null,
      transport: null,
      confirm: true,
    })
  })

  it('refuses to install a server while a required value is missing', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.getHubEntry).mockResolvedValue(serverDetail())
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [REGISTRY_SOURCE],
      problems: [],
      userDir: '/home/me/.config/ahabby/hub',
    })
    const { container } = renderPage()
    await within(container).findByText('MCP Registry')

    await user.click(within(container).getByRole('button', { name: 'Install' }))

    // The recipe is pre-filled from what the publisher declared.
    expect(await screen.findByLabelText('Command')).toHaveValue('npx')
    expect(screen.getByLabelText('Arguments')).toHaveValue('-y\n@example/files-mcp')
    expect(screen.getByText(/Required: ROOT/)).toBeTruthy()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))
    expect(ipc.installHubResource).not.toHaveBeenCalled()

    await user.type(within(dialog).getByLabelText('Value'), '/srv')
    await user.click(within(dialog).getByRole('button', { name: 'Install' }))

    expect(ipc.installHubResource).toHaveBeenCalledWith({
      ownerId: 'shared',
      entryId: 'mcp-registry/com.example/files',
      name: null,
      transport: {
        type: 'stdio',
        command: 'npx',
        args: ['-y', '@example/files-mcp'],
        env: [{ key: 'ROOT', value: '/srv' }],
      },
      confirm: true,
    })
  })

  it('opens a read-only preview from the card, and installs from it', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
      userDir: '/home/me/.config/ahabby/hub',
    })
    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    // The body of the card is the preview: what the payload *is*, with no form and no write.
    await user.click(within(container).getByRole('button', { name: 'pdf' }))

    expect(await screen.findByText('Instructions')).toBeTruthy()
    expect(screen.getByText('Fill the form in one pass.')).toBeTruthy()
    expect(screen.getByText('name')).toBeTruthy()
    expect(screen.getByText('scripts/fill.py')).toBeTruthy()
    expect(ipc.installHubResource).not.toHaveBeenCalled()
    expect(ipc.getHubEntry).toHaveBeenCalledWith('example-skills/skills/pdf', false)

    // …and the install dialog is one step on from there, not a separate journey.
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Install' }))
    expect(await screen.findByText('What will be written')).toBeTruthy()
  })

  it('offers the card actions from the context menu, including re-reading the collection', async () => {
    const user = userEvent.setup()
    vi.mocked(ipc.listHubSources).mockResolvedValue({
      sources: [SKILLS_SOURCE],
      problems: [],
      userDir: '/home/me/.config/ahabby/hub',
    })
    const { container } = renderPage()
    await within(container).findByText('Example Skills')

    fireEvent.contextMenu(within(container).getByRole('button', { name: 'pdf' }))

    expect(await screen.findByRole('menuitem', { name: 'View' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Install' })).toBeTruthy()
    expect(screen.getByRole('menuitem', { name: 'Copy entry id' })).toBeTruthy()

    // Re-reading asks the backend to ignore its cached answer for that entry.
    vi.mocked(ipc.getHubEntry).mockClear()
    await user.click(screen.getByRole('menuitem', { name: 'Re-read from the collection' }))
    expect(ipc.getHubEntry).toHaveBeenCalledWith('example-skills/skills/pdf', true)

    fireEvent.contextMenu(within(container).getByRole('button', { name: 'pdf' }))
    await user.click(await screen.findByRole('menuitem', { name: 'View' }))
    expect(await screen.findByText('Instructions')).toBeTruthy()
  })
})
