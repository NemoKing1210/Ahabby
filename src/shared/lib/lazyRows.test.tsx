import { act, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

// The stub has to be published before `lazyRows` is imported, which a hoisted callback does — see
// `@/test/intersectionObserver` for why the module is reached through a dynamic import.
const { FakeIntersectionObserver } = await vi.hoisted(async () => {
  const stub = await import('@/test/intersectionObserver')
  stub.installFakeIntersectionObserver()
  return { FakeIntersectionObserver: stub.FakeIntersectionObserver }
})

import { useLazyRows } from './lazyRows'

/** The hook as a screen uses it: the count as text, the sentinel as a real element. */
function Row({ total, resetKey }: { total: number; resetKey: unknown }) {
  const { count, sentinelRef } = useLazyRows(total, { resetKey })
  return (
    <>
      <span>{count}</span>
      <div ref={sentinelRef} />
    </>
  )
}

function renderRows(initialProps: { total: number; resetKey: unknown }) {
  const rendered = render(<Row {...initialProps} />)
  return { ...rendered, count: () => Number(rendered.container.textContent) }
}

describe('useLazyRows', () => {
  it('reveals a batch at a time while the sentinel stays in view', () => {
    FakeIntersectionObserver.reset()
    const { count, unmount } = renderRows({ total: 100, resetKey: 'first' })

    expect(count()).toBe(24)
    act(() => FakeIntersectionObserver.latest().intersect())
    expect(count()).toBe(48)
    act(() => FakeIntersectionObserver.latest().intersect())
    expect(count()).toBe(72)
    unmount()
  })

  it('never reports more rows than the list has', () => {
    FakeIntersectionObserver.reset()
    const { count, unmount } = renderRows({ total: 30, resetKey: 'first' })

    act(() => FakeIntersectionObserver.latest().intersect())
    expect(count()).toBe(30)
    unmount()
  })

  it('watches nothing while the whole list already fits in a batch', () => {
    FakeIntersectionObserver.reset()
    const { count, unmount } = renderRows({ total: 5, resetKey: 'first' })

    expect(count()).toBe(5)
    expect(FakeIntersectionObserver.instances).toHaveLength(0)
    unmount()
  })

  it('starts another list at its first batch', () => {
    FakeIntersectionObserver.reset()
    const { count, rerender, unmount } = renderRows({ total: 100, resetKey: 'first' })

    act(() => FakeIntersectionObserver.latest().intersect())
    expect(count()).toBe(48)

    // The same hook, another list: what was revealed for the first one is not this one's.
    rerender(<Row total={100} resetKey="second" />)
    expect(count()).toBe(24)
    act(() => FakeIntersectionObserver.latest().intersect())
    expect(count()).toBe(48)
    unmount()
  })
})
