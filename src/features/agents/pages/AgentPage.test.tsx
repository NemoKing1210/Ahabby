import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Route, Routes } from 'react-router-dom'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { renderWithProviders } from '@/test/render'
import { emptyScanReport, testSettings } from '@/test/fixtures'

import { useTerminalStore } from '@/features/terminal/store'

import { AgentPage } from './AgentPage'

/**
 * The page joins six tabs, two dialogs and the whole cloud surface, so the heavy children are
 * replaced by a line saying what they were handed: what this page *is* is the decision of which
 * child gets which props — an owner only when the agent can hold a new resource, a dialog only
 * for the action that asked for it. Each child has its own test for what it does with them.
 * `OverviewTab` stays real: it is the default tab, so the page is also where it gets exercised.
 */
vi.mock('@/features/configs/components/ConfigsTab', () => ({
  ConfigsTab: ({ configs }: { configs: unknown[] }) => <p>tab configs:{configs.length}</p>,
}))

vi.mock('@/features/skills/components/SkillsTab', () => ({
  SkillsTab: ({ owner }: { owner: unknown }) => <p>tab skills owner:{String(Boolean(owner))}</p>,
}))

vi.mock('@/features/mcp/components/McpTab', () => ({
  McpTab: ({ owner }: { owner: unknown }) => <p>tab mcp owner:{String(Boolean(owner))}</p>,
}))

vi.mock('@/features/extensions/components/ExtensionsTab', () => ({
  ExtensionsTab: ({ supported }: { supported: boolean }) => (
    <p>tab extensions:{String(supported)}</p>
  ),
}))

vi.mock('@/features/agents/components/OtherTab', () => ({
  OtherTab: ({ resources }: { resources: unknown[] }) => <p>tab other:{resources.length}</p>,
}))

vi.mock('@/features/install/components/InstallDialog', () => ({
  InstallDialog: ({ action }: { action: string }) => <p>dialog install:{action}</p>,
}))

vi.mock('@/features/agents/components/RemoveAgentDialog', () => ({
  RemoveAgentDialog: () => <p>dialog remove</p>,
}))

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    cachedAgents: vi.fn(),
    getSettings: vi.fn(),
    syncStatus: vi.fn(),
    listTerminals: vi.fn(),
    setAgentFavorite: vi.fn(),
    launchTerminal: vi.fn(),
    revealPath: vi.fn(),
  },
}))

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic terminal agent',
    tagline: 'An agentic coding assistant',
    icon: null,
    category: 'cli',
    website: 'https://claude.com/claude-code',
    docs: 'https://code.claude.com/docs',
    features: ['Reads your repository', 'Runs commands'],
    popular: true,
    status: 'installed',
    binaryPath: '/usr/local/bin/claude',
    foundIn: 'path',
    version: { raw: '2.1.211', major: 2, minor: 1, patch: 211, comparable: true },
    installedVia: 'npm',
    installOptions: [],
    canInstall: false,
    installDocsUrl: null,
    canUpdate: true,
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
    removal: 'hidden',
    warnings: [],
    scanMs: 12,
    ...overrides,
  }
}

function report(agent?: Agent): ScanReport {
  return { ...emptyScanReport, agents: agent ? [agent] : [] }
}

/** The page answered with `agent`; the id in the route is what resolves it out of the report. */
function renderPage(overrides: Partial<Agent> = {}, route = '/agents/claude-code') {
  const found = agent(overrides)
  vi.mocked(ipc.cachedAgents).mockResolvedValue(report(found))
  return {
    ...renderWithProviders(
      <Routes>
        <Route path="/agents/:agentId" element={<AgentPage />} />
        <Route path="/agents" element={<p>agents list</p>} />
      </Routes>,
      { route },
    ),
    found,
  }
}

beforeEach(() => {
  vi.mocked(ipc.getSettings).mockResolvedValue(testSettings())
  vi.mocked(ipc.syncStatus).mockResolvedValue({
    provider: 'gist',
    enabled: false,
    mode: 'manual',
    connected: false,
    tokenHint: null,
    account: null,
    lastPushMs: null,
    lastPullMs: null,
    lastError: null,
    running: false,
    encryption: { enabled: false },
  })
  vi.mocked(ipc.listTerminals).mockResolvedValue({ options: [], defaultCwd: '' })
  vi.mocked(ipc.setAgentFavorite).mockResolvedValue(testSettings())
  vi.mocked(ipc.launchTerminal).mockResolvedValue({
    id: 'session-1',
    agentId: 'claude-code',
    agentName: 'Claude Code',
    cwd: '',
    shell: 'pwsh',
    command: 'claude',
    cols: 80,
    rows: 24,
    running: true,
    exitCode: null,
    startedAtMs: 0,
  })
  vi.mocked(ipc.revealPath).mockResolvedValue(undefined)
  // The terminal store is a module-level singleton: one case's session must not be the next
  // one's, which is the same reason `setup.ts` clears the session filters.
  useTerminalStore.setState({
    sessions: {},
    workspaces: [],
    activeId: null,
    buffered: {},
    exits: {},
    expanded: false,
    maximized: false,
  })
})

afterEach(cleanup)

describe('AgentPage', () => {
  it('shows a skeleton until the first report arrives', () => {
    vi.mocked(ipc.cachedAgents).mockReturnValue(new Promise(() => {}))
    renderWithProviders(
      <Routes>
        <Route path="/agents/:agentId" element={<AgentPage />} />
      </Routes>,
      { route: '/agents/claude-code' },
    )

    expect(document.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(screen.queryByRole('heading')).toBeNull()
  })

  it('says so when the route names an agent that is not in the catalog', async () => {
    renderPage({}, '/agents/never-heard-of-it')

    expect(await screen.findByText('This agent is not in the catalog any more.')).toBeVisible()
    // Not a dead end: the state carries the way back to the list.
    expect(screen.getByRole('link', { name: 'All agents' })).toHaveAttribute('href', '/agents')
  })

  it('names the agent, its version and the update it is offered', async () => {
    renderPage({ update: { latest: '3.0.0', source: 'npm', checkedAtMs: 0 } })

    expect(await screen.findByRole('heading', { name: 'Claude Code' })).toBeVisible()
    // The version and the update are each stated twice — the header badge and the status row.
    expect(screen.getAllByText('2.1.211').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Update to 3.0.0').length).toBeGreaterThan(0)
    expect(screen.getByText('An agentic coding assistant')).toBeVisible()
  })

  it('offers run, update and remove for an installed agent, and no install', async () => {
    renderPage()

    expect(await screen.findByRole('button', { name: 'Run in terminal' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Update' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull()
  })

  it('offers installation instead of run/update when the binary is not on the machine', async () => {
    renderPage({
      status: 'notInstalled',
      binaryPath: null,
      version: null,
      canInstall: true,
      canUpdate: false,
      update: null,
    })

    expect(
      await screen.findByText(
        'Ahabby knows how to manage this agent, but the executable is not on this machine.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Install' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Run in terminal' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Update' })).toBeNull()
    // "Not installed" is stated twice on purpose: as the badge and as the quick status row.
    expect(screen.getAllByText('Not installed').length).toBeGreaterThan(1)
  })

  it('lets a tab with a create form keep its owner only while the agent is installed', async () => {
    const missing = renderPage({ status: 'notInstalled', binaryPath: null, version: null })
    await userEvent.click(await screen.findByRole('tab', { name: 'Skills' }))
    expect(screen.getByText('tab skills owner:false')).toBeVisible()
    // Two mounts in one case would stack their DOM — cleanup is not automatic here.
    missing.unmount()

    renderPage()
    await userEvent.click(await screen.findByRole('tab', { name: 'Skills' }))
    expect(screen.getByText('tab skills owner:true')).toBeVisible()
  })

  it('carries the resource counts on the tab strip', async () => {
    const owner = { id: 'claude-code', name: 'Claude Code', icon: null }
    renderPage({
      configs: [
        {
          id: 'c',
          label: 'C',
          path: '/tmp/c.json',
          format: 'json',
          scope: { kind: 'global' },
          agent: owner,
          exists: true,
          editable: true,
        },
      ],
      skills: [{ id: 's' } as never],
      mcpServers: [{ id: 'm' } as never, { id: 'm2' } as never],
      other: [{ id: 'o' } as never],
    })

    const configsTab = await screen.findByRole('tab', { name: /Configs/ })
    expect(within(configsTab).getByText('1')).toBeVisible()
    expect(within(screen.getByRole('tab', { name: /Skills/ })).getByText('1')).toBeVisible()
    expect(within(screen.getByRole('tab', { name: /MCP/ })).getByText('2')).toBeVisible()
    expect(within(screen.getByRole('tab', { name: /Other/ })).getByText('1')).toBeVisible()
  })

  it('hands the selected tab its own props', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('tab', { name: 'MCP' }))
    expect(screen.getByText('tab mcp owner:true')).toBeVisible()

    await userEvent.click(screen.getByRole('tab', { name: 'Extensions' }))
    expect(screen.getByText('tab extensions:false')).toBeVisible()
  })

  it('pins the agent from the header without leaving the page', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Add to favorites' }))
    expect(ipc.setAgentFavorite).toHaveBeenCalledWith('claude-code', true)
  })

  it('starts the agent in the terminal with no command of its own', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Run in terminal' }))

    // The frontend sends an agent id and a size — never a program or a command line.
    await waitFor(() =>
      expect(ipc.launchTerminal).toHaveBeenCalledWith('claude-code', null, 80, 24),
    )
    // …and the session it answers with becomes an open workspace, so the dock comes up by itself.
    expect(Object.keys(useTerminalStore.getState().sessions)).toEqual(['session-1'])
    expect(useTerminalStore.getState().expanded).toBe(true)
  })

  it('opens the update dialog for an agent that is installed', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Update' }))
    expect(screen.getByText('dialog install:update')).toBeVisible()
  })

  it('opens the install dialog for an agent that is not', async () => {
    renderPage({ status: 'notInstalled', binaryPath: null, version: null, canInstall: true })

    await userEvent.click(await screen.findByRole('button', { name: 'Install' }))
    expect(screen.getByText('dialog install:install')).toBeVisible()
  })

  it('opens the removal dialog from the header', async () => {
    renderPage()

    await userEvent.click(await screen.findByRole('button', { name: 'Remove' }))
    expect(screen.getByText('dialog remove')).toBeVisible()
  })

  it('marks a manifest whose declarations still need a docs check', async () => {
    renderPage({ unverified: ['skills.path'] })

    // The badge and the note under Quick settings both say it, on purpose.
    expect((await screen.findAllByText('Needs verification')).length).toBeGreaterThan(0)
  })
})
