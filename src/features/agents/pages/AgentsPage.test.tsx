import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { renderWithProviders } from '@/test/render'

import { AgentsPage } from './AgentsPage'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { listAgents: vi.fn(), rescan: vi.fn(), openUrl: vi.fn() },
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
    configs: [],
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
      update: { latest: '2.0.0', source: 'npm', checkedAtMs: 0 },
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
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <AgentsPage />
    </QueryClientProvider>,
  )
}

describe('AgentsPage filters', () => {
  beforeEach(() => {
    vi.mocked(ipc.listAgents).mockResolvedValue(REPORT)
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
    expect(within(container).queryByText('Claude Code')).toBeNull()
    // Codex has no update, so that chip would only lead to an empty list — it is gone.
    expect(within(container).queryByRole('button', { name: /^Update available/ })).toBeNull()
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
})
