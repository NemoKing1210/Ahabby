import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { Library } from '@/shared/bindings/Library'
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
  hiddenAgents: [],
  favoriteAgents: ['codex'],
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
    })

    const { container } = renderPage()
    await within(container).findByText('No agents installed yet')

    expect(
      within(container).getByRole('link', { name: 'Browse agents' }).getAttribute('href'),
    ).toBe('/agents')
  })
})
