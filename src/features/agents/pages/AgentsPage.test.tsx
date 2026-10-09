import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import type { Settings } from '@/shared/bindings/Settings'
import { renderWithProviders } from '@/test/render'

import { AgentsPage } from './AgentsPage'
import { ScanRefreshProvider } from '../api/scan'
import { emptySyncSettings } from '@/test/fixtures'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    listAgents: vi.fn(),
    cachedAgents: vi.fn(),
    rescan: vi.fn(),
    openUrl: vi.fn(),
    getSettings: vi.fn(),
    setAgentFavorite: vi.fn(),
    removeAgent: vi.fn(),
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

const REPORT: ScanReport = {
  agents: [
    agent({
      id: 'claude-code',
      name: 'Claude Code',
      update: { latest: '2.0.0', source: 'npm', checkedAtMs: 0 },
      // One agent routes through a proxy; the others declare none.
      facts: [
        {
          id: 'settings:env.HTTPS_PROXY',
          kind: 'proxy',
          key: 'env.HTTPS_PROXY',
          value: 'http://proxy.example.com:8080',
          masked: false,
          configId: 'settings',
          configLabel: 'User settings',
          configPath: 'C:/Users/u/.claude/settings.json',
        },
      ],
    }),
    agent({
      id: 'codex',
      name: 'Codex',
      warnings: ['settings.json is not valid JSON'],
      unverified: ['mcp.servers'],
    }),
    agent({ id: 'aider', name: 'Aider', status: 'notInstalled', canInstall: true }),
    agent({ id: 'warp', name: 'Warp', status: 'notInstalled', canInstall: false }),
  ],
  problems: [],
  scannedAtMs: 0,
  durationMs: 12,
  installed: 2,
  availableToInstall: 2,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
  projects: { folders: [], projects: [], scannedAtMs: 0, durationMs: 0 },
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
  favoriteAgents: [],
  projectFolders: [],
  launchAtLogin: false,
  trayIcon: true,
  closeToTray: true,
  startMinimized: false,
  sidebarCollapsed: false,
  lastRoute: null,
  tourCompleted: true,
  sync: emptySyncSettings,
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <ScanRefreshProvider>
        <AgentsPage />
      </ScanRefreshProvider>
    </QueryClientProvider>,
  )
}

describe('AgentsPage filters', () => {
  beforeEach(() => {
    vi.mocked(ipc.listAgents).mockResolvedValue(REPORT)
    // Nothing persisted yet, so the page falls back to a scan — as on a first launch.
    vi.mocked(ipc.cachedAgents).mockResolvedValue(null)
    vi.mocked(ipc.getSettings).mockResolvedValue(SETTINGS)
  })

  it('scopes the list to one install state and drops the other section', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    await user.click(within(container).getByRole('button', { name: 'Available 2' }))

    expect(within(container).queryByRole('heading', { name: /^Installed/ })).toBeNull()
    expect(within(container).queryByText('Claude Code')).toBeNull()
    expect(within(container).getByText('Aider')).toBeTruthy()
    expect(within(container).getByText('Warp')).toBeTruthy()
  })

  it('stacks facet chips and hides the combinations that cannot match', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    // No agent in the report has an MCP server, so that chip is not offered at all.
    expect(within(container).queryByRole('button', { name: /^With MCP/ })).toBeNull()

    await user.click(within(container).getByRole('button', { name: 'With warnings 1' }))

    expect(within(container).getByText('Codex')).toBeTruthy()
    // A row that leaves animates out first (see `AnimatedList`), so it is gone a moment later.
    await waitFor(() => expect(within(container).queryByText('Claude Code')).toBeNull())
    // Codex has no update, so that chip would only lead to an empty list — it is gone.
    await waitFor(() =>
      expect(within(container).queryByRole('button', { name: /^Update available/ })).toBeNull(),
    )
  })

  it('scopes the list to the agents whose config or env declares a proxy', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    await user.click(within(container).getByRole('button', { name: 'With proxy 1' }))

    expect(within(container).getByText('Claude Code')).toBeTruthy()
    // The other three declare none, and the section they sit in folds away with them.
    await waitFor(() => expect(within(container).queryByText('Codex')).toBeNull())
    expect(within(container).queryByRole('heading', { name: /^Available/ })).toBeNull()
  })

  it('counts every chip against the search box', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    await user.type(within(container).getByRole('textbox', { name: 'Search' }), 'aider')

    expect(within(container).getByRole('button', { name: 'Installed 0' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Available 1' })).toBeTruthy()
  })

  it('clears a dead-end combination in one click', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    // A warning only exists on an installed agent, so scoping to the available ones is empty.
    await user.click(within(container).getByRole('button', { name: 'With warnings 1' }))
    await user.click(within(container).getByRole('button', { name: 'Available 2' }))

    expect(within(container).getAllByText('No agent matches the current filters')).toHaveLength(1)

    const clear = within(container).getAllByRole('button', { name: 'Clear filters' })[0]
    expect(clear).toBeDefined()
    if (clear) await user.click(clear)

    expect(within(container).getByText('Claude Code')).toBeTruthy()
    expect(within(container).getByText('Warp')).toBeTruthy()
  })

  it('hands the filters to the next visit of the screen', async () => {
    const user = userEvent.setup()
    const first = renderPage()
    await within(first.container).findByText('Claude Code')

    await user.type(within(first.container).getByRole('textbox', { name: 'Search' }), 'aider')
    await user.click(within(first.container).getByRole('button', { name: 'Available 1' }))
    // Leaving the screen is what unmounts the page (the router does it on navigation).
    first.unmount()

    const { container } = renderPage()
    await within(container).findByText('Aider')

    expect(within(container).getByRole('textbox', { name: 'Search' })).toHaveValue('aider')
    expect(within(container).queryByText('Claude Code')).toBeNull()
  })

  it('removes an agent from its card menu after confirmation', async () => {
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    fireEvent.contextMenu(within(container).getByText('Claude Code'), { clientX: 30, clientY: 40 })
    const menu = within(await screen.findByRole('menu'))
    fireEvent.click(menu.getByRole('menuitem', { name: 'Remove' }))

    expect(
      await screen.findByRole('heading', { name: 'Remove Claude Code from Ahabby?' }),
    ).toBeInTheDocument()
  })

  it('pins a favourited agent to the top of its section', async () => {
    vi.mocked(ipc.getSettings).mockResolvedValue({ ...SETTINGS, favoriteAgents: ['warp'] })
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    const available = within(container)
      .getByRole('heading', { name: /^Available/ })
      .closest('section')
    expect(available).not.toBeNull()
    const names = within(available as HTMLElement)
      .getAllByText(/^(Aider|Warp)$/)
      .map((node) => node.textContent)
    expect(names).toEqual(['Warp', 'Aider'])
  })

  it('pins an agent from the card star', async () => {
    vi.mocked(ipc.setAgentFavorite).mockResolvedValue({
      ...SETTINGS,
      favoriteAgents: ['claude-code'],
    })
    const { container } = renderPage()
    await within(container).findByText('Claude Code')

    // `fireEvent`: the list animates its cards in, so the button is briefly pointer-events:none.
    const star = within(container).getAllByRole('button', { name: 'Add to favorites' })[0]
    expect(star).toBeDefined()
    if (star) fireEvent.click(star)

    // `mutate` runs the mutation function asynchronously.
    await waitFor(() => expect(ipc.setAgentFavorite).toHaveBeenCalledWith('claude-code', true))
  })
})
