import { beforeEach, describe, expect, it } from 'vitest'

import { applyRememberedRoute } from './routeMemory'

/** One URL per test: jsdom keeps the previous case's hash otherwise. */
beforeEach(() => {
  window.history.replaceState(null, '', '/')
})

describe('applyRememberedRoute', () => {
  it('opens the remembered screen when the window was opened bare', () => {
    expect(applyRememberedRoute('/settings/terminal')).toBe(true)
    expect(window.location.hash).toBe('#/settings/terminal')
  })

  it('keeps the hash the app was started with', () => {
    window.location.hash = '/agents/claude-code'

    // A reload or a deep link is what the user asked for; the remembered screen is a fallback.
    expect(applyRememberedRoute('/library')).toBe(false)
    expect(window.location.hash).toBe('#/agents/claude-code')
  })

  it('has nothing to restore without a remembered screen', () => {
    expect(applyRememberedRoute(null)).toBe(false)
    expect(applyRememberedRoute(undefined)).toBe(false)
    // Home is where an empty hash already points, so remembering it must not touch the URL.
    expect(applyRememberedRoute('/')).toBe(false)
    expect(window.location.hash).toBe('')
  })
})
