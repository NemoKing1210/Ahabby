import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import type { AgentRef } from '@/shared/bindings/AgentRef'
import { SHARED_OWNER } from '@/shared/lib/owners'
import { renderWithProviders } from '@/test/render'

import { CreateSkillDialog } from './CreateSkillDialog'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { createSkill: vi.fn() },
}))

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }

function renderDialog(owners: AgentRef[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <CreateSkillDialog owners={owners} onClose={() => {}} />
    </QueryClientProvider>,
  )
}

describe('CreateSkillDialog', () => {
  // RTL auto-cleanup is not configured in this project, and a dialog left mounted keeps the
  // next one from being interactive.
  afterEach(cleanup)

  it('defaults to the shared owner and sends the whole draft', async () => {
    const create = vi.mocked(ipc.createSkill).mockResolvedValue({
      data: {} as never,
      report: {} as never,
    })
    const user = userEvent.setup()
    const { getByLabelText, getByRole } = renderDialog([SHARED_OWNER, claude])

    // With several owners the form offers a choice, and the general one is preselected.
    expect(getByRole('combobox', { name: 'Owner' })).toHaveTextContent('Shared')

    const submit = getByRole('button', { name: 'Create skill' })
    expect(submit).toBeDisabled()

    await user.type(getByLabelText('Name'), 'Release Notes')
    await user.type(getByLabelText('Description'), 'Summarise a release')
    await user.type(getByLabelText('Instructions'), '# Steps')

    expect(submit).not.toBeDisabled()
    await user.click(submit)

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('shared', {
        name: 'Release Notes',
        description: 'Summarise a release',
        content: '# Steps',
      }),
    )
  })

  it('sends an untouched description and body as absent', async () => {
    const create = vi.mocked(ipc.createSkill).mockResolvedValue({
      data: {} as never,
      report: {} as never,
    })
    const user = userEvent.setup()
    const { getByLabelText, getByRole } = renderDialog([claude])

    // One owner is not a choice: it is shown as a tag instead of a select.
    expect(getByRole('button', { name: 'Create skill' })).toBeDisabled()

    await user.type(getByLabelText('Name'), 'Lint free')
    await user.click(getByRole('button', { name: 'Create skill' }))

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith('claude-code', {
        name: 'Lint free',
        description: null,
        content: null,
      }),
    )
  })
})
