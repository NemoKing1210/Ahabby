import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import type { AgentRef } from '@/shared/bindings/AgentRef'
import { renderWithProviders } from '@/test/render'

import { Select } from './Select'
import { agentOption, anyAgentOption, ownerOption } from './agentOptions'

const claude: AgentRef = { id: 'claude-code', name: 'Claude Code', icon: 'claude' }
const shared: AgentRef = { id: 'shared', name: 'Shared', icon: null }

// Radix opens the list on pointerdown and scrolls the active row into view; jsdom has neither
// pointer capture nor scrollIntoView, and RTL does not auto-clean up here (see AGENTS.md).
Element.prototype.hasPointerCapture = () => false
Element.prototype.setPointerCapture = () => {}
Element.prototype.releasePointerCapture = () => {}
Element.prototype.scrollIntoView = () => {}

afterEach(() => {
  cleanup()
  // An open list puts `pointer-events: none` on the body and lifts it again on close.
  document.body.style.removeProperty('pointer-events')
})

describe('Select with agent options', () => {
  it('shows the agent tile in the trigger and in every row', async () => {
    const { container } = renderWithProviders(
      <Select
        ariaLabel="Owner"
        value="claude-code"
        onValueChange={() => {}}
        options={[
          anyAgentOption('All', '9'),
          agentOption(claude, { description: '2.0.30' }),
          ownerOption(shared, 'Shared', '3'),
        ]}
      />,
    )

    const trigger = container.querySelector('[aria-label="Owner"]') as HTMLElement
    const triggerTile = trigger.querySelector('span[aria-hidden]') as HTMLElement
    expect(triggerTile.style.backgroundColor).toBe('rgb(9, 9, 11)')
    expect(triggerTile.querySelector('svg')).toBeTruthy()
    expect(trigger.querySelector('span.truncate')?.textContent).toBe('Claude Code')

    await userEvent.click(trigger)
    const rows = await screen.findAllByRole('option')
    // Radix drops `className` on its text node, so the label is the wrapper's own last child.
    expect(
      rows.map((row) => row.querySelector('span[id] > span > span:last-child')?.textContent),
    ).toEqual(['All', 'Claude Code', 'Shared'])
    // Everything painted after that text node is the dimmed note.
    expect(
      rows.map((row) =>
        (row.textContent ?? '').slice(row.querySelector('span[id]')?.textContent?.length ?? 0),
      ),
    ).toEqual(['9', '2.0.30', '3'])

    // Every row keeps the same tile column: the two agent-less rows hold a mark on a neutral
    // tile instead of a brand colour.
    const tiles = rows.map((row) => row.querySelector('span[aria-hidden]') as HTMLElement)
    expect(tiles.every((tile) => tile.className.includes('size-5'))).toBe(true)
    expect(tiles.map((tile) => tile.style.backgroundColor)).toEqual(['', 'rgb(9, 9, 11)', ''])
    expect(tiles[0]?.querySelector('svg')).toBeTruthy()
    expect(tiles[2]?.querySelector('svg')).toBeTruthy()
  })

  it('leaves options without an icon exactly as they were', async () => {
    const { container } = renderWithProviders(
      <Select
        ariaLabel="Theme"
        value="dark"
        onValueChange={vi.fn()}
        options={[
          { value: 'dark', label: 'Dark' },
          { value: 'light', label: 'Light' },
        ]}
      />,
    )
    const trigger = container.querySelector('[aria-label="Theme"]') as HTMLElement
    expect(trigger.textContent).toBe('Dark')
    await userEvent.click(trigger)
    const rows = await screen.findAllByRole('option')
    expect(rows.map((row) => row.textContent)).toEqual(['Dark', 'Light'])
    // No icon slot at all: the row text is the label and nothing else.
    expect(rows.map((row) => row.querySelector('span[id] > span')?.children.length)).toEqual([1, 1])
  })

  it('falls back to the placeholder when the value is not among the options', () => {
    const { container } = renderWithProviders(
      <Select
        ariaLabel="Manager"
        value=""
        onValueChange={() => {}}
        placeholder="Not chosen"
        options={[{ value: 'npm', label: 'npm' }]}
      />,
    )
    const trigger = container.querySelector('[aria-label="Manager"]') as HTMLElement
    expect(trigger.textContent).toBe('Not chosen')
    // The placeholder is not an option: no tile, just the dimmed text.
    expect(trigger.querySelector('span.truncate')?.textContent).toBe('Not chosen')
    expect(trigger.querySelector('.size-5')).toBeNull()
  })
})
