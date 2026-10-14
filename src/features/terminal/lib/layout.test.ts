import { describe, expect, it } from 'vitest'

import type { TerminalPane } from '../store'
import {
  SIZE_MAX,
  SIZE_MIN,
  canAdoptLayout,
  clampSize,
  focusPaneFromKey,
  paneCount,
  panesForLayout,
} from './layout'

/** Two panes holding sessions: the shape a grid folds down from. */
const TWO_SESSIONS: TerminalPane[] = [
  { id: 'p1', sessionId: 's1' },
  { id: 'p2', sessionId: 's2' },
]

/** A grid with a session in the first pane and three empty ones — what `4` produces. */
const GRID: TerminalPane[] = [
  { id: 'p1', sessionId: 's1' },
  { id: 'p2', sessionId: null },
  { id: 'p3', sessionId: null },
  { id: 'p4', sessionId: null },
]

describe('paneCount', () => {
  it('counts the slots each layout shows', () => {
    expect(paneCount('single')).toBe(1)
    expect(paneCount('columns')).toBe(2)
    expect(paneCount('rows')).toBe(2)
    expect(paneCount('grid')).toBe(4)
  })
})

describe('canAdoptLayout', () => {
  it('allows a layout whose slots can hold every session', () => {
    expect(canAdoptLayout([{ id: 'p1', sessionId: 's1' }], 'grid')).toBe(true)
    expect(canAdoptLayout(TWO_SESSIONS, 'columns')).toBe(true)
    expect(
      canAdoptLayout(
        [
          { id: 'p1', sessionId: 's1' },
          { id: 'p2', sessionId: 's2' },
          { id: 'p3', sessionId: 's3' },
          { id: 'p4', sessionId: 's4' },
        ],
        'grid',
      ),
    ).toBe(true)
    // Empty panes are not sessions: a grid whose tail is unused folds freely.
    expect(canAdoptLayout(GRID, 'single')).toBe(true)
  })

  it('refuses a fold that would leave a session behind', () => {
    const three: TerminalPane[] = [
      { id: 'p1', sessionId: 's1' },
      { id: 'p2', sessionId: 's2' },
      { id: 'p3', sessionId: 's3' },
    ]

    expect(canAdoptLayout(three, 'columns')).toBe(false)
    expect(canAdoptLayout(TWO_SESSIONS, 'single')).toBe(false)
  })
})

describe('panesForLayout', () => {
  it('grows by appending empty panes, minting one id each', () => {
    const minted: string[] = []
    const mint = () => {
      const id = `n${minted.length + 1}`
      minted.push(id)
      return id
    }

    const panes = panesForLayout([{ id: 'p1', sessionId: 's1' }], 'grid', mint)

    expect(panes).toHaveLength(4)
    expect(panes[0]).toEqual({ id: 'p1', sessionId: 's1' })
    expect(panes.slice(1)).toEqual([
      { id: 'n1', sessionId: null },
      { id: 'n2', sessionId: null },
      { id: 'n3', sessionId: null },
    ])
  })

  it('compacts the sessions into the first slots when it folds', () => {
    const panes = panesForLayout(
      [
        { id: 'p1', sessionId: 's1' },
        { id: 'p2', sessionId: null },
        { id: 'p3', sessionId: 's2' },
        { id: 'p4', sessionId: null },
      ],
      'columns',
      () => 'new',
    )

    expect(panes).toEqual([
      { id: 'p1', sessionId: 's1' },
      { id: 'p3', sessionId: 's2' },
    ])
  })

  it('leaves a workspace that already wears the layout alone', () => {
    const panes = panesForLayout(TWO_SESSIONS, 'columns', () => 'new')

    expect(panes).toEqual(TWO_SESSIONS)
    expect(panes[0]).toBe(TWO_SESSIONS[0])
  })
})

describe('clampSize', () => {
  it('keeps a divider fraction usable', () => {
    expect(clampSize(0.5)).toBe(0.5)
    expect(clampSize(0.01)).toBe(SIZE_MIN)
    expect(clampSize(0.99)).toBe(SIZE_MAX)
  })
})

describe('focusPaneFromKey', () => {
  it('reads the pane a Ctrl/Cmd+digit asks for', () => {
    expect(focusPaneFromKey(new KeyboardEvent('keydown', { code: 'Digit2', ctrlKey: true }))).toBe(
      2,
    )
    expect(focusPaneFromKey(new KeyboardEvent('keydown', { code: 'Digit4', metaKey: true }))).toBe(
      4,
    )
  })

  it('leaves every other key to the shell', () => {
    expect(focusPaneFromKey(new KeyboardEvent('keydown', { code: 'Digit2' }))).toBeNull()
    expect(
      focusPaneFromKey(
        new KeyboardEvent('keydown', { code: 'Digit2', ctrlKey: true, shiftKey: true }),
      ),
    ).toBeNull()
    expect(
      focusPaneFromKey(
        new KeyboardEvent('keydown', { code: 'Digit2', ctrlKey: true, altKey: true }),
      ),
    ).toBeNull()
    expect(
      focusPaneFromKey(new KeyboardEvent('keydown', { code: 'Digit5', ctrlKey: true })),
    ).toBeNull()
    expect(
      focusPaneFromKey(new KeyboardEvent('keydown', { code: 'Digit0', ctrlKey: true })),
    ).toBeNull()
    expect(
      focusPaneFromKey(new KeyboardEvent('keydown', { code: 'KeyA', ctrlKey: true })),
    ).toBeNull()
  })
})
