import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Library } from '@/shared/bindings/Library'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import type { Skill } from '@/shared/bindings/Skill'
import { SHARED_OWNER_ID } from '@/shared/lib/owners'
import { renderWithProviders } from '@/test/render'

import { LibraryPage } from './LibraryPage'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { listLibrary: vi.fn() },
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

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }
const opencode: AgentRef = { id: 'opencode', name: 'OpenCode', icon: 'opencode' }
/** The agent-neutral surface: a resource that belongs to no single agent. */
const shared: AgentRef = { id: SHARED_OWNER_ID, name: 'Shared' }

function skill(name: string, path: string, agents: AgentRef[], extra: Partial<Skill> = {}): Skill {
  return {
    id: `${name}#${path}`,
    name,
    description: `about ${name}`,
    path,
    entryPath: `${path}/SKILL.md`,
    scope: { kind: 'global' },
    agents,
    frontmatter: [],
    content: '# body',
    sizeBytes: 10,
    enabled: true,
    removable: true,
    unverified: false,
    ...extra,
  }
}

const SERVER: McpServer = {
  id: 'github#/a/.mcp.json',
  name: 'github',
  transport: { type: 'stdio', command: 'npx', args: ['-y'] },
  scope: { kind: 'global' },
  agent: claude,
  sourceConfig: '/a/.mcp.json',
  keyPath: ['mcpServers', 'github'],
  env: [],
  headers: [],
  raw: '{}',
  createdMs: Date.UTC(2024, 0, 2),
  modifiedMs: Date.UTC(2024, 5, 3),
  hasSecrets: false,
  enabled: true,
  removable: true,
  unverified: false,
}

const SERVER_HTTP: McpServer = {
  ...SERVER,
  id: 'remote#/b/.mcp.json',
  name: 'remote',
  transport: { type: 'http', url: 'https://mcp.example.com', protocol: 'http' },
  sourceConfig: '/b/.mcp.json',
  keyPath: ['mcpServers', 'remote'],
}

const RESOURCE: OtherResource = {
  id: 'claude-code.instructions.1',
  kind: 'instructions',
  label: 'CLAUDE.md',
  path: '/a/CLAUDE.md',
  agent: claude,
  scope: { kind: 'global' },
  format: 'markdown',
  description: null,
  content: null,
  sizeBytes: 20,
  isDirectory: false,
  exists: true,
  itemCount: null,
  unverified: false,
}

const LIBRARY: Library = {
  skills: [
    skill('pdf', '/a/pdf', [claude, opencode], {
      createdMs: Date.UTC(2025, 9, 1),
      modifiedMs: Date.UTC(2025, 9, 2),
    }),
    skill('review', '/a/review', [claude]),
    // Agent-neutral, and the filesystem reported a modification time only.
    skill('global', '/agents/skills/global', [shared], {
      createdMs: null,
      modifiedMs: Date.UTC(2025, 8, 3),
    }),
  ],
  mcpServers: [SERVER, SERVER_HTTP],
  other: [RESOURCE],
  stats: { agents: 2, installedAgents: 2, skills: 3, mcpServers: 2, other: 1 },
  scannedAtMs: Date.now() - 60_000,
  problems: [],
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <LibraryPage />
    </QueryClientProvider>,
  )
}

/**
 * Agent brand marks ship an SVG `<title>` with the agent name, which `getByText` would count
 * as a second match for every tag — ignore it and query the visible labels only.
 */
const TEXT = { ignore: 'script, style, title' } as const

describe('LibraryPage', () => {
  beforeEach(() => {
    vi.mocked(ipc.listLibrary).mockResolvedValue(LIBRARY)
  })

  it('heads a shared name and leaves a one-agent name in the plain list', async () => {
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // `review` belongs to a single agent, so it needs no heading of its own.
    expect(within(container).queryByRole('heading', { name: 'review' })).toBeNull()
    expect(within(container).getAllByRole('button', { name: 'review' })).toHaveLength(1)

    const pdf = within(container).getByRole('button', { name: 'pdf' })
    const review = within(container).getByRole('button', { name: 'review' })
    expect(within(pdf).getAllByText('Claude Code', TEXT).length).toBeGreaterThan(0)
    expect(within(pdf).getAllByText('OpenCode', TEXT).length).toBeGreaterThan(0)
    // The solo skill does not pretend to belong to the agent that does not own it.
    expect(within(review).queryByText('OpenCode', TEXT)).toBeNull()
  })

  it('lists a shared skill under each agent when grouped by agent', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('button', { name: 'Agent' }))

    expect(within(container).getByRole('heading', { name: 'Claude Code' })).toBeTruthy()
    expect(within(container).getByRole('heading', { name: 'OpenCode' })).toBeTruthy()
    expect(within(container).queryByRole('heading', { name: 'pdf' })).toBeNull()
    expect(within(container).getAllByText('/a/pdf')).toHaveLength(2)
  })

  it('narrows every tab with the search box', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.type(within(container).getByRole('textbox', { name: 'Search' }), 'review')

    expect(within(container).getAllByRole('button', { name: 'review' })).toHaveLength(1)
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()
    expect(within(container).getByRole('tab', { name: /^Skills/ })).toHaveTextContent('1')
  })

  it('shows the MCP servers with their owning agent', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('tab', { name: /^MCP/ }))

    expect(within(container).getByText('npx')).toBeTruthy()
    // The skills panel is gone, so the owner tag can only come from the server card.
    expect(within(container).queryByRole('button', { name: 'pdf' })).toBeNull()
    expect(within(container).getAllByText('Claude Code', TEXT).length).toBeGreaterThan(0)
  })

  it('offers a way out of a dead-end filter', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.type(within(container).getByRole('textbox', { name: 'Search' }), 'nothing here')

    expect(within(container).getByText('No results for “nothing here”')).toBeTruthy()
    const clear = within(container).getAllByRole('button', { name: 'Clear filters' })[0]
    expect(clear).toBeDefined()
    if (clear) await user.click(clear)

    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
  })

  it('labels the agent-neutral surface and files it under its own group', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // Grouped by name, the global skill carries the shared tag (translated, not the
    // backend's "Shared" display name).
    const global = within(container).getByRole('button', { name: 'global' })
    expect(within(global).getAllByText('Shared', TEXT).length).toBeGreaterThan(0)

    await user.click(within(container).getByRole('button', { name: 'Agent' }))

    // Grouped by owner, the shared resources get their own section.
    expect(within(container).getByRole('heading', { name: 'Shared' })).toBeTruthy()
    expect(within(container).getByRole('heading', { name: 'Claude Code' })).toBeTruthy()
  })

  it('narrows a tab with its own facet chips', async () => {
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('tab', { name: /^MCP/ }))
    expect(within(container).getByText('npx')).toBeTruthy()
    expect(within(container).getByText('https://mcp.example.com')).toBeTruthy()

    // The chip carries the number of matching servers, so its name is unambiguous.
    await user.click(within(container).getByRole('button', { name: 'http 1' }))

    expect(within(container).getByText('https://mcp.example.com')).toBeTruthy()
    expect(within(container).queryByText('npx')).toBeNull()
  })

  it('narrows a tab to the resources that are switched off', async () => {
    vi.mocked(ipc.listLibrary).mockResolvedValue({
      ...LIBRARY,
      skills: [...LIBRARY.skills, skill('parked', '/a/parked', [claude], { enabled: false })],
    })
    const user = userEvent.setup()
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    // The row counts what each choice would show, so "Off 0" cannot look like a filter that
    // does nothing.
    const activity = within(container).getByRole('group', { name: 'Activity' })
    expect(within(activity).getByRole('button', { name: 'All 4' })).toBeTruthy()
    expect(within(activity).getByRole('button', { name: 'On 3' })).toBeTruthy()
    expect(within(activity).getByRole('button', { name: 'Off 1' })).toBeTruthy()

    await user.click(within(activity).getByRole('button', { name: 'Off 1' }))
    expect(within(container).getByRole('button', { name: 'parked' })).toBeTruthy()
    expect(within(container).queryByRole('heading', { name: 'pdf' })).toBeNull()
    // Narrowing this tab does not empty the others: their badges keep their own counts.
    expect(within(container).getByRole('tab', { name: /^MCP/ })).toHaveTextContent('2')

    await user.click(within(activity).getByRole('button', { name: 'All 4' }))
    expect(within(container).getByRole('heading', { name: 'pdf' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'parked' })).toBeTruthy()
  })

  it('shows the file date each resource carries, and labels it honestly', async () => {
    const { container } = renderPage()
    await within(container).findByRole('heading', { name: 'pdf' })

    const pdf = within(container).getByRole('button', { name: 'pdf' })
    expect(within(pdf).getByText(/^Created /)).toBeTruthy()

    // The shared skill has no creation time, so its card falls back to the modification
    // time rather than calling it "created".
    const global = within(container).getByRole('button', { name: 'global' })
    expect(within(global).getByText(/^Modified /)).toBeTruthy()
    expect(within(global).queryByText(/^Created /)).toBeNull()
  })

  it('offers a context menu on an "Other" resource card', async () => {
    const user = userEvent.setup()
    const view = renderPage()
    const { container } = view
    await within(container).findByRole('heading', { name: 'pdf' })

    await user.click(within(container).getByRole('tab', { name: /^Other/ }))
    fireEvent.contextMenu(within(container).getByText('CLAUDE.md'), { clientX: 40, clientY: 60 })

    const menu = within(await screen.findByRole('menu'))
    expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()

    view.unmount()
  })
})
