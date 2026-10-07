import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'

import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

import { BrowserProvider } from '@/features/browser/context'

/**
 * Renders a component with the providers every feature assumes exist: i18n, a router (for
 * `Link`), the tooltip provider, a query cache and Ahabby's own browser.
 *
 * The cache is per call, so one case's answers cannot leak into the next one; `retry` is off
 * because a test that expects a failure should not wait for React Query to ask twice.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { route?: string },
) {
  const i18n = initI18n('en')
  const { route = '/', ...renderOptions } = options ?? {}
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 0 } },
  })

  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <TooltipProvider>
          <MemoryRouter initialEntries={[route]}>
            <BrowserProvider>{ui}</BrowserProvider>
          </MemoryRouter>
        </TooltipProvider>
      </QueryClientProvider>
    </I18nextProvider>,
    renderOptions,
  )
}
