import React from 'react'
import ReactDOM from 'react-dom/client'

import '@/styles/globals.css'

import { ipc } from '@/shared/api/ipc'
import { DEFAULT_LANGUAGE, initI18n, type Language } from '@/shared/i18n'

import { appearanceApplier } from './app/appearance'
import { AppProviders } from './app/providers'
import { AppRouter } from './app/router'
import { suppressNativeMenu } from './app/nativeMenu'
import { dismissSplash } from './app/splash'
import { themeApplier } from './app/theme'

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
  // Before anything renders: the WebView must never answer a right click with Back/Reload.
  suppressNativeMenu()

  let language: Language = DEFAULT_LANGUAGE
  try {
    const settings = await ipc.getSettings()
    language = settings.language
    themeApplier.apply(settings.theme)
    appearanceApplier.apply(settings)
  } catch {
    // A missing/unreadable settings file is not fatal: fall back to the defaults.
    themeApplier.apply('system')
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

// The splash goes away as soon as the app rendered — and also if boot failed, so a hang never
// hides behind a spinner that is not actually loading anything.
void boot().finally(dismissSplash)
