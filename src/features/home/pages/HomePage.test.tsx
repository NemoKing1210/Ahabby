import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { HubSource } from '@/shared/bindings/HubSource'
import type { HubSourceCatalog } from '@/shared/bindings/HubSourceCatalog'
import type { Library } from '@/shared/bindings/Library'
import type { Project } from '@/shared/bindings/Project'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import { renderWithProviders } from '@/test/render'

import { ScanRefreshProvider } from '@/features/agents/api/scan'

import { HomePage } from './HomePage'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    listAgents: vi.fn(),
    cachedAgents: vi.fn(),
    rescan: vi.fn(),
    getSettings: vi.fn(),
    listLibrary: vi.fn(),
    listHubSources: vi.fn(),
  },
}))

function agent(overrides: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
  return {
    description: 'A coding agent',
    tagline: null,
    icon: null,
    category: 'cli',
    website: null,
    docs: null,
    features: [],
    popular: true,
    status: 'installed',
    binaryPath: null,
    foundIn: null,
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
    extensions: [],
    extensionsSupported: false,
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' },
    removal: 'manifest',
    warnings: [],
    scanMs: 4,
    ...overrides,
  }
}

/** One project the user added a folder for: enough for the home page's counts. */
const PROJECT: Project = {
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

/** One collection the hub reads, with only the fields the home page's count depends on. */
function source(overrides: Partial<HubSource> & Pick<HubSource, 'id' | 'name'>): HubSource {
  return {
    kind: 'githubSkills',
    description: null,
    provides: ['skill'],
    homepage: null,
    docs: null,
    license: null,
    vendor: null,
    url: null,
    repository: 'owner/repo',
    gitRef: null,
    path: null,
    exclude: [],
    tags: [],
    tagRules: [],
    builtin: true,
    sourceFile: null,
    ...overrides,
  }
}

const HUB_SOURCES: HubSourceCatalog = {
  sources: [
    source({ id: 'example-skills', name: 'Example Skills' }),
    source({ id: 'mcp-registry', name: 'MCP Registry', kind: 'mcpRegistry', provides: ['mcp'] }),
  ],
  problems: [],
  userDir: '/home/me/.config/ahabby/hub',
}

const REPORT: ScanReport = {
  agents: [
    agent({
      id: 'claude-code',
      name: 'Claude Code',
      version: { raw: '2.0.0', major: 2, minor: 0, patch: 0, comparable: true },
      update: { latest: '2.1.0', source: 'npm', checkedAtMs: 0 },
    }),
    agent({
      id: 'codex',
      name: 'Codex',
      version: { raw: '0.9.1', major: 0, minor: 9, patch: 1, comparable: true },
    }),
    agent({ id: 'aider', name: 'Aider', status: 'notInstalled', canInstall: true }),
  ],
  problems: [],
  scannedAtMs: Date.now(),
  durationMs: 12,
  installed: 2,
  availableToInstall: 1,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
  projects: {
    folders: [
      {
        folder: { id: 'folder:one', path: '/home/me/code', addedAtMs: 0 },
        resolved: '/home/me/code',
        exists: true,
        problem: null,
      },
    ],
    projects: [PROJECT],
    scannedAtMs: 0,
    durationMs: 0,
  },
}

const LIBRARY: Library = {
  skills: [],
  mcpServers: [],
  other: [],
  stats: { agents: 3, installedAgents: 2, skills: 7, mcpServers: 2, other: 3 },
  scannedAtMs: Date.now(),
  problems: [],
}

const SETTINGS: Settings = {
  language: 'en',
  theme: 'system',
  accent: 'clay',
  accentCustom: null,
  interfaceScale: 100,
  textScale: 100,
  fontFamily: 'inter',
  monoFont: 'jetbrains',
  extraScanPaths: [],
  networkVersionChecks: true,
  backupDir: null,
  versionCacheMinutes: 60,
  proxyMode: 'none',
  proxyUrl: null,
  terminal: 'builtin',
  terminalTheme: 'auto',
  hiddenAgents: [],
  favoriteAgents: ['codex'],
  projectFolders: [],
  launchAtLogin: false,
  trayIcon: true,
  closeToTray: true,
  startMinimized: false,
  sidebarCollapsed: false,
  lastRoute: null,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <ScanRefreshProvider>
        <HomePage />
      </ScanRefreshProvider>
    </QueryClientProvider>,
  )
}

/** Every link on the page, in document order. */
function links(container: HTMLElement): HTMLAnchorElement[] {
  return within(container).getAllByRole('link')
}

/** One summary tile, found by its label. */
function tile(container: HTMLElement, label: string): HTMLAnchorElement {
  const found = links(container).find((link) => link.textContent?.includes(label))
  if (!found) throw new Error(`no tile labelled ${label}`)
  return found
}

describe('HomePage', () => {
  beforeEach(() => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue(REPORT)
    vi.mocked(ipc.listAgents).mockResolvedValue(REPORT)
    vi.mocked(ipc.rescan).mockResolvedValue(REPORT)
    vi.mocked(ipc.listLibrary).mockResolvedValue(LIBRARY)
    vi.mocked(ipc.listHubSources).mockResolvedValue(HUB_SOURCES)
    vi.mocked(ipc.getSettings).mockResolvedValue(SETTINGS)
  })

  it('summarises the scan and sends each number to the screen that explains it', async () => {
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    const agents = tile(container, 'Agents installed')
    expect(agents.getAttribute('href')).toBe('/agents')
    expect(agents.textContent).toContain('2')
    expect(agents.textContent).toContain('1 more to install')

    expect(tile(container, 'Skills').textContent).toContain('7')
    expect(tile(container, 'MCP servers').textContent).toContain('2')
    const other = tile(container, 'Other resources')
    expect(other.textContent).toContain('3')
    expect(other.getAttribute('href')).toBe('/library')

    const projects = tile(container, 'Projects')
    expect(projects.getAttribute('href')).toBe('/projects')
    expect(projects.textContent).toContain('1 folder added')

    const hub = tile(container, 'Hub')
    expect(hub.getAttribute('href')).toBe('/hub')
    expect(hub.textContent).toContain('2')
  })

  it('offers a row for every screen, the newest sections included', async () => {
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    // Found by the hint under the label, which is what keeps the row distinct from the tiles.
    const row = (hint: string) => {
      const found = links(container).find((link) => link.textContent?.includes(hint))
      if (!found) throw new Error(`no row hinting ${hint}`)
      return found
    }

    expect(row('Your own folders').getAttribute('href')).toBe('/projects')
    expect(row('installed into an agent, a project').getAttribute('href')).toBe('/hub')
    expect(row('Versions, configs, skills and MCP servers').getAttribute('href')).toBe('/agents')
    expect(row('Everything installed across your agents').getAttribute('href')).toBe('/library')
    expect(row('Language, theme, scan paths').getAttribute('href')).toBe('/settings')
  })

  it('lists the installed agents only, favourites first, and flags the one with an update', async () => {
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    const roster = links(container).filter((link) =>
      link.getAttribute('href')?.startsWith('/agents/'),
    )
    expect(roster.map((link) => link.getAttribute('href'))).toEqual([
      '/agents/codex',
      '/agents/claude-code',
    ])
    expect(roster[0]?.textContent).toContain('0.9.1')
    expect(within(roster[1] as HTMLElement).getByText('Update available')).toBeTruthy()
  })

  it('invites a first install when nothing is on the machine', async () => {
    vi.mocked(ipc.cachedAgents).mockResolvedValue({
      ...REPORT,
      agents: [agent({ id: 'aider', name: 'Aider', status: 'notInstalled', canInstall: true })],
      installed: 0,
      projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
    })

    const { container } = renderPage()
    await within(container).findByText('No agents installed yet')

    expect(
      within(container).getByRole('link', { name: 'Browse agents' }).getAttribute('href'),
    ).toBe('/agents')

    // With no folder added, the Projects summary invites one instead of counting zero.
    expect(tile(container, 'Projects').textContent).toContain('Add a folder to work in')
  })
})
