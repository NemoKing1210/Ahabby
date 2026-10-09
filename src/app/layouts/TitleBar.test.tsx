import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ipc } from '@/shared/api/ipc'
import { queryKeys } from '@/shared/api/keys'
import type { WindowChrome } from '@/shared/bindings/WindowChrome'
import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { TitleBar } from './TitleBar'

vi.mock('@/shared/api/ipc', () => ({
  ipc: {
    windowChrome: vi.fn(),
    windowStartDrag: vi.fn(),
    windowMinimize: vi.fn(),
    windowToggleMaximize: vi.fn(),
    windowClose: vi.fn(),
  },
}))

const WINDOWED: WindowChrome = { custom: true, maximized: false, focused: true }

beforeEach(() => {
  // The real commands answer a promise; the header calls them through `.catch`.
  vi.mocked(ipc.windowStartDrag).mockResolvedValue(undefined)
  vi.mocked(ipc.windowMinimize).mockResolvedValue(undefined)
  vi.mocked(ipc.windowClose).mockResolvedValue(undefined)
  vi.mocked(ipc.windowToggleMaximize).mockResolvedValue(WINDOWED)
})

/**
 * Mounts the header the way `boot()` does, with the chrome already in the cache: what is asserted
 * here is which command a press on the bar reaches, not how the state got there.
 */
function renderBar(chrome: WindowChrome) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  client.setQueryData(queryKeys.windowChrome(), chrome)

  render(
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={initI18n('en')}>
        <TooltipProvider>
          <TitleBar />
        </TooltipProvider>
      </I18nextProvider>
    </QueryClientProvider>,
  )

  return client
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('TitleBar', () => {
  it('draws nothing where the OS frames the window', () => {
    renderBar({ custom: false, maximized: false, focused: true })

    expect(screen.queryByRole('banner')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Close' })).toBeNull()
  })

  it('drags the window from the bar, and only from the bar itself', () => {
    renderBar(WINDOWED)

    fireEvent.mouseDown(screen.getByRole('banner'), { button: 0, detail: 1 })

    expect(ipc.windowStartDrag).toHaveBeenCalledTimes(1)
    expect(ipc.windowClose).not.toHaveBeenCalled()

    // The buttons keep their own press: a caption button is not a drag region.
    const close = screen.getByRole('button', { name: 'Close' })
    fireEvent.mouseDown(close, { button: 0, detail: 1 })
    fireEvent.click(close)

    expect(ipc.windowStartDrag).toHaveBeenCalledTimes(1)
    expect(ipc.windowClose).toHaveBeenCalledTimes(1)
  })

  it('maximizes on the second press instead of starting another drag', async () => {
    renderBar(WINDOWED)

    fireEvent.mouseDown(screen.getByRole('banner'), { button: 0, detail: 2 })

    await vi.waitFor(() => expect(ipc.windowToggleMaximize).toHaveBeenCalledTimes(1))
    expect(ipc.windowStartDrag).not.toHaveBeenCalled()
  })

  it('offers a restore while the window is maximized, and writes the answer back', async () => {
    vi.mocked(ipc.windowToggleMaximize).mockResolvedValue({
      custom: true,
      maximized: false,
      focused: true,
    })
    const client = renderBar({ ...WINDOWED, maximized: true })

    expect(screen.queryByRole('button', { name: 'Maximize' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))

    await vi.waitFor(() =>
      expect(client.getQueryData<WindowChrome>(queryKeys.windowChrome())?.maximized).toBe(false),
    )
    expect(screen.getByRole('button', { name: 'Maximize' })).toBeInTheDocument()
  })
})
