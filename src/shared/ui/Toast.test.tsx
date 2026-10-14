import { act, cleanup, fireEvent, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '@/test/render'

import { Toaster, TOAST_DEFAULTS, applyToastSettings, toast, useToastStore } from './Toast'

const MESSAGE = 'Something happened'

/** Pushes a message and lets React paint it: under fake timers the store's update needs a flush. */
function showMessage() {
  act(() => toast.info(MESSAGE))
}

/** The viewport is the element the position is painted on; there is exactly one of it. */
function viewport(): HTMLElement {
  const element = document.querySelector<HTMLElement>('[data-position]')
  if (!element) throw new Error('no toast viewport is mounted')
  return element
}

describe('toasts', () => {
  beforeEach(() => applyToastSettings(TOAST_DEFAULTS))

  // The store outlives the component, so a case's messages would otherwise be painted by the next
  // one's `Toaster`.
  afterEach(() => {
    cleanup()
    act(() => useToastStore.setState({ toasts: [] }))
  })

  it('paints a message in the position it was given', () => {
    applyToastSettings({ enabled: true, position: 'top-left', duration: 'normal' })
    renderWithProviders(<Toaster />)

    showMessage()

    expect(viewport()).toHaveAttribute('data-position', 'top-left')
    expect(within(viewport()).getByText(MESSAGE)).toBeInTheDocument()
  })

  it('shows nothing at all while the messages are off', () => {
    applyToastSettings({ enabled: false, position: 'top-center', duration: 'normal' })
    renderWithProviders(<Toaster />)

    showMessage()

    expect(screen.queryByText(MESSAGE)).toBeNull()
    expect(document.querySelector('[data-position]')).toBeNull()
  })

  it('hides a message once the delay it was given is up', () => {
    vi.useFakeTimers()
    try {
      applyToastSettings({ enabled: true, position: 'top-center', duration: 'short' })
      renderWithProviders(<Toaster />)
      showMessage()
      expect(screen.getByText(MESSAGE)).toBeInTheDocument()

      // Three seconds is what `short` means; the backstop that drops the store entry adds a little.
      act(() => {
        vi.advanceTimersByTime(3500)
      })

      expect(screen.queryByText(MESSAGE)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it('keeps a persistent message until it is closed', () => {
    vi.useFakeTimers()
    try {
      applyToastSettings({ enabled: true, position: 'top-center', duration: 'persistent' })
      renderWithProviders(<Toaster />)
      showMessage()

      act(() => {
        vi.advanceTimersByTime(60_000)
      })
      expect(screen.getByText(MESSAGE)).toBeInTheDocument()

      fireEvent.click(screen.getByRole('button', { name: 'Close' }))
      act(() => {
        vi.advanceTimersByTime(500)
      })

      expect(screen.queryByText(MESSAGE)).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})
