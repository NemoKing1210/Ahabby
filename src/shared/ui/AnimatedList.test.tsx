import { fireEvent, render, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'

import { AnimatedList } from './AnimatedList'

describe('AnimatedList', () => {
  it('renders the rows in order and keeps list semantics', () => {
    const { container, unmount } = render(
      <AnimatedList as="ul" grouped={false}>
        {['alpha', 'beta', 'gamma'].map((id) => (
          <span key={id}>{id}</span>
        ))}
      </AnimatedList>,
    )

    const view = within(container)
    expect(view.getAllByRole('listitem')).toHaveLength(3)
    expect(view.getByRole('list').textContent).toBe('alphabetagamma')
    unmount()
  })

  it('keeps a removed row in the tree for its exit, then drops it', async () => {
    function List() {
      const [items, setItems] = useState(['alpha', 'beta'])
      return (
        <>
          <button type="button" onClick={() => setItems(['alpha'])}>
            drop
          </button>
          <AnimatedList grouped={false}>
            {items.map((id) => (
              <span key={id}>{id}</span>
            ))}
          </AnimatedList>
        </>
      )
    }

    const { container, getByRole, unmount } = render(<List />)
    fireEvent.click(getByRole('button'))

    expect(within(container).queryByText('beta')).not.toBeNull()
    expect(within(container).getByText('alpha')).toBeTruthy()
    await waitFor(() => expect(within(container).queryByText('beta')).toBeNull())
    expect(within(container).getByText('alpha')).toBeTruthy()
    unmount()
  })
})
