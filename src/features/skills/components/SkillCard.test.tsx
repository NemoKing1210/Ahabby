import { describe, expect, it, vi } from 'vitest'
import { fireEvent, screen, within } from '@testing-library/react'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import type { Skill } from '@/shared/bindings/Skill'
import { renderWithProviders } from '@/test/render'

import { SkillCard } from './SkillCard'

vi.mock('@/shared/api/ipc', () => ({
  ipc: { revealPath: vi.fn().mockResolvedValue(undefined) },
}))

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }

function skill(overrides: Partial<Skill> = {}): Skill {
  return {
    id: 'pdf#/a/pdf',
    name: 'pdf',
    description: 'about pdf',
    path: '/a/pdf',
    entryPath: '/a/pdf/SKILL.md',
    scope: { kind: 'global' },
    agents: [claude],
    frontmatter: [],
    content: '# body',
    sizeBytes: 10,
    enabled: true,
    removable: true,
    unverified: false,
    ...overrides,
  }
}

/** Right click the card's title — a hit area outside its own buttons. */
async function openMenu(container: HTMLElement, name = 'pdf') {
  fireEvent.contextMenu(within(container).getByText(name), { clientX: 40, clientY: 60 })
  return within(await screen.findByRole('menu'))
}

describe('SkillCard context menu', () => {
  it('offers the card actions and dispatches the toggle', async () => {
    const onToggle = vi.fn()
    const view = renderWithProviders(
      <SkillCard
        skill={skill()}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onToggle={onToggle}
      />,
    )

    expect(screen.queryByRole('menu')).toBeNull()

    const menu = await openMenu(view.container)
    expect(menu.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Switch off' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Copy path' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Show in file manager' })).toBeTruthy()
    expect(menu.getByRole('menuitem', { name: 'Delete skill' })).toBeTruthy()

    fireEvent.click(menu.getByRole('menuitem', { name: 'Switch off' }))
    expect(onToggle).toHaveBeenCalledWith(skill(), false)

    view.unmount()
  })

  it('leaves out the actions the backend would refuse on a plugin-managed skill', async () => {
    const view = renderWithProviders(
      <SkillCard
        skill={skill({ removable: false })}
        onOpen={() => undefined}
        onToggle={vi.fn()}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
    )

    const menu = await openMenu(view.container)
    expect(menu.getByRole('menuitem', { name: 'Open' })).toBeTruthy()
    expect(menu.queryByRole('menuitem', { name: 'Switch off' })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: 'Edit' })).toBeNull()
    expect(menu.queryByRole('menuitem', { name: 'Delete skill' })).toBeNull()

    view.unmount()
  })
})
