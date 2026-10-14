import { useState } from 'react'
import { cleanup, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { Chip } from './Chip'
import { FilterChipGroup, FilterSearch } from './FilterBar'

afterEach(cleanup)

/** A search box the way a screen uses one: the text is the caller's own state. */
function Harness() {
  const [value, setValue] = useState('pdf')
  return <FilterSearch value={value} onValueChange={setValue} placeholder="Search library…" />
}

describe('FilterSearch', () => {
  it('is labelled the same everywhere, and clears the text it was given', async () => {
    const user = userEvent.setup()
    const { container } = renderWithProviders(<Harness />)

    // One name for every search box in the app; the placeholder says what *this* screen searches.
    const field = within(container).getByRole('textbox', { name: 'Search' })
    expect(field).toHaveValue('pdf')

    await user.click(within(container).getByRole('button', { name: 'Clear search' }))

    expect(within(container).getByRole('textbox', { name: 'Search' })).toHaveValue('')
    // Nothing left to clear, so the control is gone rather than offered dead.
    expect(within(container).queryByRole('button', { name: 'Clear search' })).toBeNull()
  })
})

describe('FilterChipGroup', () => {
  it('is named by its caption, or by the fuller label a caller hands it', () => {
    const { container } = renderWithProviders(
      <>
        <FilterChipGroup label="Type">
          <Chip label="Package" />
        </FilterChipGroup>
        <FilterChipGroup label="Filter by kind" ariaLabel="Filter by kind of entry">
          <Chip label="Skills" />
        </FilterChipGroup>
      </>,
    )

    const groups = within(container).getAllByRole('group')
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual([
      'Type',
      'Filter by kind of entry',
    ])
    expect(within(container).getByText('Type')).toBeTruthy()
  })
})
