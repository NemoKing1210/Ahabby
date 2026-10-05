import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { Agent } from '@/shared/bindings/Agent'
import type { ScanReport } from '@/shared/bindings/ScanReport'
import { renderWithProviders } from '@/test/render'

import { RemoveAgentDialog } from './RemoveAgentDialog'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { removeAgent: vi.fn() },
}))

const REPORT: ScanReport = {
  agents: [],
  problems: [],
  scannedAtMs: 0,
  durationMs: 4,
  installed: 0,
  availableToInstall: 0,
  os: 'windows',
  shared: { configs: [], skills: [], mcpServers: [], other: [], roots: [] },
}

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
    version: null,
    installedVia: 'npm',
    installOptions: [],
    canInstall: false,
    installDocsUrl: null,
    canUpdate: false,
    canUninstall: false,
    configs: [],
    skills: [],
    mcpServers: [],
    other: [],
    update: null,
    unverified: [],
    notes: null,
    manifestSource: { kind: 'builtin' },
    removal: 'hidden',
    warnings: [],
    scanMs: 4,
    ...overrides,
  }
}

function renderDialog(overrides: Partial<Agent> = {}) {
  const onClose = vi.fn()
  const onUninstall = vi.fn()
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  // Radix renders the dialog into a portal on `document.body`, so the queries below use
  // the screen rather than the render container.
  const view = renderWithProviders(
    <QueryClientProvider client={client}>
      <RemoveAgentDialog agent={agent(overrides)} onClose={onClose} onUninstall={onUninstall} />
    </QueryClientProvider>,
  )
  return { ...view, onClose, onUninstall }
}

describe('RemoveAgentDialog', () => {
  it('offers only hiding when the agent cannot be removed from the machine', () => {
    const view = renderDialog()

    expect(screen.getByRole('button', { name: 'Hide' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(
      screen.getByText('This agent declares no uninstall command for your platform.'),
    ).toBeTruthy()

    view.unmount()
  })

  it('explains a missing package manager instead of offering deletion', () => {
    const view = renderDialog({
      installOptions: [
        {
          id: 'npm',
          manager: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          updateCommand: null,
          uninstallCommand: 'npm uninstall -g @anthropic-ai/claude-code',
          requires: [],
          docsUrl: null,
          note: null,
          available: false,
          unavailableReason: 'npm is not installed',
          detected: false,
        },
      ],
    })

    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    expect(screen.getByText('Removing it needs npm, which is not installed.')).toBeTruthy()

    view.unmount()
  })

  it('hides the agent through the backend without promising anything else', async () => {
    vi.mocked(ipc.removeAgent).mockResolvedValue({
      data: { agentId: 'claude-code', name: 'Claude Code', deleted: false, path: null },
      report: REPORT,
    })
    const view = renderDialog()
    const user = userEvent.setup()

    await user.click(screen.getByRole('button', { name: 'Hide' }))

    await waitFor(() =>
      expect(vi.mocked(ipc.removeAgent)).toHaveBeenCalledWith('claude-code', 'hide', true),
    )
    expect(view.onClose).toHaveBeenCalled()
    expect(view.onUninstall).not.toHaveBeenCalled()

    view.unmount()
  })

  it('offers a real uninstall when the manifest declares one, and hands off to the job', async () => {
    const view = renderDialog({
      canUninstall: true,
      installOptions: [
        {
          id: 'npm',
          manager: 'npm',
          command: 'npm install -g @anthropic-ai/claude-code',
          updateCommand: null,
          uninstallCommand: 'npm uninstall -g @anthropic-ai/claude-code',
          requires: [],
          docsUrl: null,
          note: null,
          available: true,
          unavailableReason: null,
          detected: true,
        },
      ],
    })
    const user = userEvent.setup()

    expect(screen.getByText('npm uninstall -g @anthropic-ai/claude-code')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Uninstall' }))

    expect(view.onUninstall).toHaveBeenCalledWith(expect.objectContaining({ id: 'claude-code' }))
    // Nothing is hidden: the uninstall flow owns the machine-level deletion.
    expect(vi.mocked(ipc.removeAgent)).not.toHaveBeenCalled()
    expect(view.onClose).toHaveBeenCalled()

    view.unmount()
  })

  it('deletes a user manifest when no uninstall is possible', async () => {
    vi.mocked(ipc.removeAgent).mockResolvedValue({
      data: {
        agentId: 'demo',
        name: 'Demo',
        deleted: true,
        path: '/cfg/catalog/demo.toml',
      },
      report: REPORT,
    })
    const view = renderDialog({
      id: 'demo',
      name: 'Demo',
      manifestSource: { kind: 'user', path: '/cfg/catalog/demo.toml' },
      removal: 'manifest',
    })
    const user = userEvent.setup()

    expect(screen.queryByRole('button', { name: 'Uninstall' })).toBeNull()
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() =>
      expect(vi.mocked(ipc.removeAgent)).toHaveBeenCalledWith('demo', 'delete', true),
    )
    expect(view.onUninstall).not.toHaveBeenCalled()

    view.unmount()
  })
})
