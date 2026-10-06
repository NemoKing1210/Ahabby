import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Skill } from '@/shared/bindings/Skill'
import { renderWithProviders } from '@/test/render'

import { SkillsTab } from './SkillsTab'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { deleteSkill: vi.fn(), setSkillEnabled: vi.fn() },
}))

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }

function skill(name: string, enabled: boolean): Skill {
  return {
    id: `${name}#/a/${name}`,
    name,
    description: `about ${name}`,
    path: `/a/${name}`,
    entryPath: `/a/${name}/SKILL.md`,
    scope: { kind: 'global' },
    agents: [claude],
    frontmatter: [],
    content: '# body',
    sizeBytes: 10,
    enabled,
    removable: true,
    unverified: false,
  }
}

function renderTab(skills: Skill[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return renderWithProviders(
    <QueryClientProvider client={client}>
      <SkillsTab agentId="claude-code" skills={skills} />
    </QueryClientProvider>,
  )
}

describe('SkillsTab', () => {
  it('narrows the agent skills to what is switched off', async () => {
    const user = userEvent.setup()
    const { container } = renderTab([
      skill('alpha', true),
      skill('beta', true),
      skill('parked', false),
    ])

    const activity = within(container).getByRole('group', { name: 'Activity' })
    expect(within(activity).getByRole('button', { name: 'All 3' })).toBeTruthy()
    expect(within(activity).getByRole('button', { name: 'On 2' })).toBeTruthy()
    expect(within(activity).getByRole('button', { name: 'Off 1' })).toBeTruthy()

    await user.click(within(activity).getByRole('button', { name: 'Off 1' }))
    expect(within(container).getByRole('button', { name: 'parked' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'alpha' })).toBeNull()

    await user.click(within(activity).getByRole('button', { name: 'On 2' }))
    expect(within(container).getByRole('button', { name: 'alpha' })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'parked' })).toBeNull()
  })

  it('says so when the chosen state has nothing behind it', async () => {
    const user = userEvent.setup()
    const { container } = renderTab([skill('parked', false)])

    await user.click(within(container).getByRole('button', { name: 'On 0' }))

    // An empty list under a filter is not the same as an agent with no skills at all.
    expect(within(container).getByText('Nothing here is switched on')).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'parked' })).toBeNull()
  })
})
