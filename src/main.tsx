import React from 'react'
import ReactDOM from 'react-dom/client'

import '@/styles/globals.css'

import { ipc } from '@/shared/api/ipc'
import { DEFAULT_LANGUAGE, initI18n, type Language } from '@/shared/i18n'

import { AppProviders } from './app/providers'
import { AppRouter } from './app/router'
import { applyTheme } from './app/theme'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('Ahabby: #root element is missing from index.html')
}
const container: HTMLElement = rootElement

/**
 * Language and theme are resolved once, before the first render: the settings live in the
 * backend, and reading them here is what keeps the first paint free of a language or theme
 * flash. Any later change is applied by `useSaveSettings`.
 */
async function boot() {
  let language: Language = DEFAULT_LANGUAGE
  try {
    const settings = await ipc.getSettings()
    language = settings.language
    applyTheme(settings.theme)
  } catch {
    // A missing/unreadable settings file is not fatal: fall back to the defaults.
    applyTheme('system')
  }
  initI18n(language)

  ReactDOM.createRoot(container).render(
    <React.StrictMode>
      <AppProviders>
        <AppRouter />
      </AppProviders>
    </React.StrictMode>,
  )
}

void boot()
