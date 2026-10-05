import '@testing-library/jest-dom/vitest'

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
