import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Progress } from './Progress'

describe('Progress', () => {
  it('reports the filled amount, clamped to the range it declares', () => {
    const { rerender } = render(<Progress value={40} label="share" />)
    const bar = () => screen.getByRole('progressbar')

    expect(bar().getAttribute('aria-valuenow')).toBe('40')
    expect(bar().getAttribute('aria-valuemax')).toBe('100')

    rerender(<Progress value={250} label="share" />)
    expect(bar().getAttribute('aria-valuenow')).toBe('100')

    rerender(<Progress value={-10} label="share" />)
    expect(bar().getAttribute('aria-valuenow')).toBe('0')
  })
})
