import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Theme } from '@/shared/bindings/Theme'

import {
  createThemeApplier,
  resolveTheme,
  THEME_FADE_MS,
  type ResolvedTheme,
  type ThemeHost,
} from './theme'

interface NativeCall {
  theme: Theme
  resolved: ResolvedTheme
  caption: string
  text: string
}

/** A {@link ThemeHost} that records every call, with a hand-driven OS preference. */
function createHarness() {
  const root = document.createElement('div')
  const listeners = new Set<() => void>()
  const native: NativeCall[] = []
  let prefersDark = false

  const host: ThemeHost = {
    root,
    systemPrefersDark: () => prefersDark,
    watchSystem: (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    nativeColors: () => ({ caption: '#101010', text: '#f0f0f0' }),
    applyNative: (theme, resolved, colors) => native.push({ theme, resolved, ...colors }),
  }

  return {
    host,
    root,
    native,
    /** OS preference flip, as WebView2 would report it. */
    flipSystem: (dark: boolean) => {
      prefersDark = dark
      for (const listener of [...listeners]) listener()
    },
    listeners,
  }
}

describe('resolveTheme', () => {
  it('honours an explicit choice whatever the OS asks for', () => {
    expect(resolveTheme('dark', false)).toBe('dark')
    expect(resolveTheme('light', true)).toBe('light')
  })

  it('follows the OS only for system', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
  })
})

describe('createThemeApplier', () => {
  it('drives the root element and the native chrome from the resolved theme', () => {
    const { host, root, native } = createHarness()
    const applier = createThemeApplier(host)

    expect(applier.apply('dark')).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)
    expect(root.dataset.theme).toBe('dark')
    expect(native).toEqual([
      { theme: 'dark', resolved: 'dark', caption: '#101010', text: '#f0f0f0' },
    ])

    expect(applier.apply('light')).toBe('light')
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.dataset.theme).toBe('light')
    expect(native).toEqual([
      { theme: 'dark', resolved: 'dark', caption: '#101010', text: '#f0f0f0' },
      { theme: 'light', resolved: 'light', caption: '#101010', text: '#f0f0f0' },
    ])
  })

  it('keeps repainting both the root and the native chrome while the OS flips', () => {
    const { host, root, native, flipSystem } = createHarness()
    const applier = createThemeApplier(host)

    applier.apply('system')
    expect(root.classList.contains('dark')).toBe(false)

    flipSystem(true)
    expect(root.classList.contains('dark')).toBe(true)
    expect(native.at(-1)).toEqual({
      theme: 'system',
      resolved: 'dark',
      caption: '#101010',
      text: '#f0f0f0',
    })

    flipSystem(false)
    expect(root.classList.contains('dark')).toBe(false)
    expect(native).toHaveLength(3)
  })

  it('drops the system subscription when an explicit theme replaces it', () => {
    // Regression: the leftover `system` listener used to re-apply the OS theme after the
    // user had picked light, so the choice looked like it had not been applied at all.
    const { host, root, listeners, flipSystem } = createHarness()
    const applier = createThemeApplier(host)

    applier.apply('system')
    applier.apply('light')
    expect(listeners.size).toBe(0)

    flipSystem(true)
    expect(root.dataset.theme).toBe('light')
    expect(root.classList.contains('dark')).toBe(false)
  })

  it('replaces the previous system subscription instead of stacking them', () => {
    const { host, listeners } = createHarness()
    const applier = createThemeApplier(host)

    applier.apply('system')
    applier.apply('system')
    applier.apply('system')
    expect(listeners.size).toBe(1)
  })

  it('dispose silences the OS for good', () => {
    const { host, root, listeners, flipSystem } = createHarness()
    const applier = createThemeApplier(host)

    applier.apply('system')
    applier.dispose()
    expect(listeners.size).toBe(0)

    flipSystem(true)
    expect(root.dataset.theme).toBe('system')
    expect(root.classList.contains('dark')).toBe(false)
  })

  describe('crossfade', () => {
    afterEach(() => {
      vi.useRealTimers()
    })

    it('flags a real theme change for the length of the transition', () => {
      vi.useFakeTimers()
      const { host, root } = createHarness()
      const applier = createThemeApplier(host)

      applier.apply('light')
      // The very first paint must not fade the empty window from light to dark.
      expect(root.hasAttribute('data-theme-animating')).toBe(false)

      applier.apply('dark')
      expect(root.hasAttribute('data-theme-animating')).toBe(true)

      vi.advanceTimersByTime(THEME_FADE_MS)
      expect(root.hasAttribute('data-theme-animating')).toBe(false)
    })

    it('stays still when the theme resolves to the one already on screen', () => {
      vi.useFakeTimers()
      const { host, root } = createHarness()
      const applier = createThemeApplier(host)

      applier.apply('light')
      applier.apply('light')
      expect(root.hasAttribute('data-theme-animating')).toBe(false)
    })
  })
})
