import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'

import { resetSessionState, useSessionState } from './sessionState'

// RTL's auto-cleanup is not configured (see `src/test/setup.ts`), and every case renders a probe.
afterEach(cleanup)

/** A stand-in for a page filter: one text field, one chip and one counter behind a button. */
function Probe({ storageKey = 'test.query' }: { storageKey?: string }) {
  const [query, setQuery] = useSessionState(storageKey, '')
  const [scoped, setScoped] = useSessionState(`${storageKey}.scope`, false)
  const [clicks, setClicks] = useSessionState(`${storageKey}.clicks`, 0)

  return (
    <div>
      <input aria-label="Query" value={query} onChange={(event) => setQuery(event.target.value)} />
      <button type="button" aria-pressed={scoped} onClick={() => setScoped(!scoped)}>
        Scoped
      </button>
      {/* Two calls in one tick: the second must see what the first left. */}
      <button
        type="button"
        onClick={() => {
          setClicks((previous) => previous + 1)
          setClicks((previous) => previous + 1)
        }}
      >
        Count
      </button>
      <p>{clicks}</p>
    </div>
  )
}

describe('useSessionState', () => {
  it('hands the value a screen was left with to its next mount', async () => {
    const user = userEvent.setup()
    resetSessionState()
    const first = render(<Probe />)

    await user.type(screen.getByLabelText('Query'), 'installed')
    await user.click(screen.getByRole('button', { name: 'Scoped' }))
    first.unmount()

    render(<Probe />)
    expect(screen.getByLabelText('Query')).toHaveValue('installed')
    expect(screen.getByRole('button', { name: 'Scoped' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('composes updaters called in the same tick, like useState', async () => {
    const user = userEvent.setup()
    resetSessionState()
    render(<Probe />)

    await user.click(screen.getByRole('button', { name: 'Count' }))
    expect(screen.getByText('2')).toBeInTheDocument()
  })

  it('keeps every key its own value until the session is reset', async () => {
    const user = userEvent.setup()
    resetSessionState()
    const scoped = render(<Probe storageKey="test.left" />)
    await user.type(screen.getByLabelText('Query'), 'pdf')
    scoped.unmount()

    const other = render(<Probe storageKey="test.right" />)
    expect(screen.getByLabelText('Query')).toHaveValue('')
    other.unmount()

    resetSessionState('test.left')
    render(<Probe storageKey="test.left" />)
    expect(screen.getByLabelText('Query')).toHaveValue('')
  })
})
