import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { PageHeader } from './PageHeader'

describe('PageHeader', () => {
  it('pins the heading over a fully opaque background', () => {
    render(<PageHeader>Title</PageHeader>)

    const classes = screen.getByRole('banner').className.split(/\s+/)

    expect(classes).toContain('sticky')
    expect(classes).toContain('bg-background')
    // A `/NN` suffix on the background token or a blur behind it is what lets the list
    // scrolling under the header show through, which is exactly what pinning it must not do.
    expect(classes.filter((name) => name.startsWith('bg-background/'))).toEqual([])
    expect(classes.filter((name) => name.startsWith('backdrop-blur'))).toEqual([])
  })
})
