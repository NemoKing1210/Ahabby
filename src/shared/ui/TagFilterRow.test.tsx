import { cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { TAG_LIMIT, TagFilterRow, withSelected } from './TagFilterRow'

const TAGS: string[] = Array.from({ length: TAG_LIMIT + 3 }, (_, index) => `tag${index}`)
const LAST = `tag${TAG_LIMIT + 2}`

afterEach(cleanup)

describe('TagFilterRow', () => {
  it('offers a tag that is switched on even when the list no longer holds it', () => {
    // The vocabulary is a view of what is on screen, so a narrowing search can drop the very tag
    // that is doing the narrowing — and that tag's chip is the only way back.
    expect(withSelected(['docs'], ['design'])).toEqual(['docs', 'design'])
    expect(withSelected(['Docs'], ['docs'])).toEqual(['Docs'])
  })

  it('folds the row past its limit but never hides a tag that is switched on', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(
      <TagFilterRow tags={TAGS} selected={[LAST]} onToggle={vi.fn()} />,
    )

    expect(within(container).getByRole('button', { name: LAST })).toBeTruthy()
    expect(within(container).queryByRole('button', { name: 'tag8' })).toBeNull()
    // "Show 2 more": the folded-away tags that are not switched on.
    const fold = within(container).getByRole('button', { name: 'Show 2 more' })

    await user.click(fold)

    expect(within(container).getByRole('button', { name: 'tag8' })).toBeTruthy()
    expect(within(container).getByRole('button', { name: 'Collapse' })).toBeTruthy()
  })

  it('reports the tag it was clicked with', async () => {
    const user = userEvent.setup()
    const onToggle = vi.fn()
    const { container } = renderWithProviders(
      <TagFilterRow tags={['docs', 'forms']} selected={['forms']} onToggle={onToggle} />,
    )

    expect(within(container).getByRole('button', { name: 'forms' })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
    await user.click(within(container).getByRole('button', { name: 'docs' }))
    expect(onToggle).toHaveBeenCalledWith('docs')
  })

  it('renders nothing when there is no tag to offer', () => {
    const { container } = renderWithProviders(
      <TagFilterRow tags={[]} selected={[]} onToggle={vi.fn()} />,
    )

    expect(container.querySelector('[role="group"]')).toBeNull()
  })
})
