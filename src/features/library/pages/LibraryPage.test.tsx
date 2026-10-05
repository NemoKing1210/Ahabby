import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Library } from '@/shared/bindings/Library'
import type { McpServer } from '@/shared/bindings/McpServer'
import type { OtherResource } from '@/shared/bindings/OtherResource'
import type { Skill } from '@/shared/bindings/Skill'
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

function skill(name: string, path: string, agents: AgentRef[]): Skill {
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
    removable: true,
    unverified: false,
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
  hasSecrets: false,
  removable: true,
  unverified: false,
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
  skills: [skill('pdf', '/a/pdf', [claude, opencode]), skill('review', '/a/review', [claude])],
  mcpServers: [SERVER],
  other: [RESOURCE],
  stats: { agents: 2, installedAgents: 2, skills: 2, mcpServers: 1, other: 1 },
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
})
