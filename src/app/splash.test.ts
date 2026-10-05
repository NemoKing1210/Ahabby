import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createSplashDismisser, SPLASH_EXIT_MS, SPLASH_MIN_MS, type SplashHost } from './splash'

const splashElement = () => document.getElementById('ah-splash')

interface Harness {
  dismiss: () => void
  /** Arms a splash to dismiss, then moves the injected clock and the timers together. */
  advance: (ms: number) => void
}

function createHarness({ reducedMotion = false } = {}): Harness {
  document.body.insertAdjacentHTML('afterbegin', '<div id="ah-splash"></div>')
  let now = 0

  const host: SplashHost = {
    splash: splashElement,
    now: () => now,
    reducedMotion: () => reducedMotion,
  }

  return {
    dismiss: createSplashDismisser(host),
    advance: (ms) => {
      now += ms
      vi.advanceTimersByTime(ms)
    },
  }
}

describe('createSplashDismisser', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
  })

  it('holds the splash for the minimum time, then removes it after the exit', () => {
    const { dismiss, advance } = createHarness()

    dismiss()
    advance(SPLASH_MIN_MS - 1)
    expect(splashElement()?.dataset.state).toBeUndefined()

    advance(1)
    // Leaving is not gone: the fade has to play out over the app first.
    expect(splashElement()?.dataset.state).toBe('leaving')

    advance(SPLASH_EXIT_MS + 1)
    expect(splashElement()).toBeNull()
  })

  it('counts the minimum time from when the splash appeared, not from the call', () => {
    const { dismiss, advance } = createHarness()

    // The app took longer than the minimum to boot: there is nothing left to wait for.
    advance(SPLASH_MIN_MS * 2)
    dismiss()
    advance(1)
    expect(splashElement()?.dataset.state).toBe('leaving')
  })

  it('is a no-op when the splash is already gone', () => {
    const { dismiss } = createHarness()

    splashElement()?.remove()
    expect(() => dismiss()).not.toThrow()
    expect(splashElement()).toBeNull()
  })

  it('takes the splash down twice at most', () => {
    const { dismiss, advance } = createHarness()

    dismiss()
    advance(SPLASH_MIN_MS)
    dismiss()
    advance(SPLASH_EXIT_MS + 1)
    expect(splashElement()).toBeNull()
  })

  it('skips the exit wait when the OS asked for less motion', () => {
    const { dismiss, advance } = createHarness({ reducedMotion: true })

    dismiss()
    advance(SPLASH_MIN_MS)
    expect(splashElement()?.dataset.state).toBe('leaving')

    advance(1)
    expect(splashElement()).toBeNull()
  })
})
