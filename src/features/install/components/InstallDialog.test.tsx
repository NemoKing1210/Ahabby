import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type * as ipcModule from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'

import { ipc } from '@/shared/api/ipc'
import { renderWithProviders } from '@/test/render'

import { InstallDialog } from './InstallDialog'

// Only the plan is stubbed: it is what the dialog renders before anything is executed.
vi.mock('@/shared/api/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof ipcModule>()
  return {
    ipc: {
      ...actual.ipc,
      planInstall: vi.fn().mockResolvedValue({
        agentId: 'claude-code',
        agentName: 'Claude Code',
        action: 'update',
        methodId: 'npm',
        manager: 'npm',
        program: 'npm',
        args: [],
        displayCommand: 'npm install -g @anthropic-ai/claude-code',
        usesShell: false,
        managerAvailable: true,
        warnings: [],
        targetOs: 'linux',
      }),
    },
  }
})

function agent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: 'claude-code',
    name: 'Claude Code',
    description: 'Anthropic terminal agent',
    tagline: null,
    icon: null,
    category: 'cli',
    website: null,
    docs: null,
    features: [],
    popular: true,
    status: 'installed',
    binaryPath: '/usr/local/bin/claude',
    foundIn: 'path',
    version: { raw: '2.1.211', major: 2, minor: 1, patch: 211, comparable: true },
    installedVia: 'npm',
    installOptions: [
      {
        id: 'npm',
        manager: 'npm',
        command: 'npm install -g @anthropic-ai/claude-code',
        updateCommand: 'npm install -g @anthropic-ai/claude-code@latest',
        requires: [],
        docsUrl: null,
        note: null,
        available: true,
        unavailableReason: null,
        detected: true,
      },
    ],
    canInstall: true,
    installDocsUrl: null,
    canUpdate: true,
    configs: [],
    skills: [],
    mcpServers: [],
    other: [],
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' },
    warnings: [],
    scanMs: 12,
    ...overrides,
  }
}

function renderDialog(target: Agent, action: 'install' | 'update' = 'update') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <InstallDialog agent={target} action={action} onOpenChange={() => undefined} />
    </QueryClientProvider>,
  )
}

describe('InstallDialog', () => {
  afterEach(() => {
    cleanup()
    vi.mocked(ipc.planInstall).mockClear()
  })

  it('shows the installed and the available version in the update dialog', () => {
    renderDialog(agent({ update: { latest: '2.2.0', source: 'npm', checkedAtMs: 1 } }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Installed version')).toBeInTheDocument()
    expect(within(dialog).getByText('2.1.211')).toBeInTheDocument()
    expect(within(dialog).getByText('New version')).toBeInTheDocument()
    expect(within(dialog).getByText('2.2.0')).toBeInTheDocument()
  })

  it('says so when no newer version was detected', () => {
    renderDialog(agent())

    expect(
      within(screen.getByRole('dialog')).getByText('No newer version detected'),
    ).toBeInTheDocument()
  })

  it('omits the version block when the action is a fresh install', () => {
    renderDialog(agent({ status: 'notInstalled', version: null }), 'install')

    expect(
      within(screen.getByRole('dialog')).queryByText('Installed version'),
    ).not.toBeInTheDocument()
  })
})
