import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import { SHARED_OWNER } from '@/shared/lib/owners'
import { renderWithProviders } from '@/test/render'

import { CreateMcpServerDialog } from './CreateMcpServerDialog'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { createMcpServer: vi.fn() },
}))

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }

function renderDialog(owners: AgentRef[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <CreateMcpServerDialog owners={owners} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('CreateMcpServerDialog', () => {
  // RTL auto-cleanup is not configured in this project, and a dialog left mounted keeps the
  // next one from being interactive.
  afterEach(cleanup)

  it('turns the stdio form into one argument per line and KEY=value pairs', async () => {
    const create = vi.mocked(ipc.createMcpServer).mockResolvedValue({
      data: {} as never,
      report: {} as never,
    })
    const user = userEvent.setup()
    const { getByLabelText, getByRole, queryByLabelText } = renderDialog([SHARED_OWNER])

    // A remote-only field is not on screen while the transport is local.
    expect(queryByLabelText('URL')).toBeNull()

    await user.type(getByLabelText('Name'), 'github')
    await user.type(getByLabelText('Command'), 'npx')
    await user.type(getByLabelText('Arguments'), '-y\n@modelcontextprotocol/server-github\n')
    await user.type(getByLabelText('Environment'), 'GITHUB_TOKEN=ghp_x\nLOG=info')
    await user.click(getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('shared', {
        name: 'github',
        transport: {
          type: 'stdio',
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: [
            { key: 'GITHUB_TOKEN', value: 'ghp_x' },
            { key: 'LOG', value: 'info' },
          ],
        },
      }),
    )
  })

  it('switches to a remote server: URL and headers replace the command', async () => {
    const create = vi.mocked(ipc.createMcpServer).mockResolvedValue({
      data: {} as never,
      report: {} as never,
    })
    const user = userEvent.setup()
    const { getByLabelText, getByRole, queryByLabelText } = renderDialog([claude])

    await user.click(getByRole('button', { name: 'Remote · HTTP' }))
    expect(queryByLabelText('Command')).toBeNull()
    // Without a URL there is nothing to write yet.
    expect(getByRole('button', { name: 'Add server' })).toBeDisabled()

    await user.type(getByLabelText('Name'), 'linear')
    await user.type(getByLabelText('URL'), 'https://mcp.linear.app/mcp')
    await user.type(getByLabelText('Headers'), 'Authorization=Bearer token')
    await user.click(getByRole('button', { name: 'Add server' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('claude-code', {
        name: 'linear',
        transport: {
          type: 'http',
          url: 'https://mcp.linear.app/mcp',
          headers: [{ key: 'Authorization', value: 'Bearer token' }],
        },
      }),
    )
  })
})
