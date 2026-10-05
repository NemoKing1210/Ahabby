import { render, type RenderOptions } from '@testing-library/react'
import type { ReactElement } from 'react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router-dom'

import { initI18n } from '@/shared/i18n'
import { TooltipProvider } from '@/shared/ui/Tooltip'

/**
 * Renders a component with the providers every feature assumes exist: i18n, a router (for
 * `Link`) and the tooltip provider. Keeps component tests free of boilerplate.
 */
export function renderWithProviders(
  ui: ReactElement,
  options?: RenderOptions & { route?: string },
) {
  const i18n = initI18n('en')
  const { route = '/', ...renderOptions } = options ?? {}

  return render(
    <I18nextProvider i18n={i18n}>
      <TooltipProvider>
        <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
      </TooltipProvider>
    </I18nextProvider>,
    renderOptions,
  )
}
