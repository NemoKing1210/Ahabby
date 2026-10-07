import '@testing-library/jest-dom/vitest'
import { afterEach } from 'vitest'

import { resetSessionState } from '@/shared/lib/sessionState'

/**
 * jsdom ships neither browser observer a Radix component may reach for: the tab indicator
 * measures its trigger with a `ResizeObserver`, and a couple of surfaces use
 * `IntersectionObserver`. The stubs are inert — no layout happens in jsdom anyway.
 */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (!('ResizeObserver' in globalThis)) {
  Object.defineProperty(globalThis, 'ResizeObserver', {
    value: ResizeObserverStub,
    writable: true,
    configurable: true,
  })
}

/**
 * A screen keeps the filters it was left with in the session store (`shared/lib/sessionState`),
 * which outlives its component on purpose — and would therefore outlive a test case too.
 * Clearing it between cases is what keeps one case's filters out of the next one's assertions.
 */
afterEach(() => resetSessionState())
