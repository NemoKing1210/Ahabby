import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type * as ipcModule from '@/shared/api/ipc'

import { ipc } from '@/shared/api/ipc'
import { renderWithProviders } from '@/test/render'

import { useJobStore } from '../store'
import { JobConsole } from './JobConsole'

// Only the cancellation is observed: every other command keeps its real implementation.
vi.mock('@/shared/api/ipc', async (importOriginal) => {
  const actual = await importOriginal<typeof ipcModule>()
  return { ipc: { ...actual.ipc, cancelJob: vi.fn().mockResolvedValue(true) } }
})

const cancelJob = vi.mocked(ipc.cancelJob)

function renderConsole() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <JobConsole jobId="job-1" />
    </QueryClientProvider>,
  )
}

describe('JobConsole', () => {
  beforeEach(() => {
    cancelJob.mockClear()
    useJobStore.setState({
      jobs: {
        'job-1': {
          jobId: 'job-1',
          agentId: 'claude-code',
          action: 'update',
          command: 'npm install -g @anthropic-ai/claude-code',
          lines: [],
        },
      },
    })
  })

  afterEach(() => {
    cleanup()
    useJobStore.setState({ jobs: {} })
  })

  it('does not stop the job until the confirmation is accepted', async () => {
    const user = userEvent.setup()
    renderConsole()

    await user.click(screen.getByRole('button', { name: 'Cancel job' }))

    const dialog = screen.getByRole('dialog')
    expect(within(dialog).getByText('Cancel this job?')).toBeInTheDocument()
    // The job is still running: nothing was stopped just by opening the dialog.
    expect(cancelJob).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Cancel job' }))
    expect(cancelJob).toHaveBeenCalledWith('job-1')
  })

  it('leaves the job alone when the confirmation is dismissed', async () => {
    const user = userEvent.setup()
    renderConsole()

    await user.click(screen.getByRole('button', { name: 'Cancel job' }))
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }))

    expect(cancelJob).not.toHaveBeenCalled()
  })
})
