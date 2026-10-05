import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import en from './locales/en.json'
import ru from './locales/ru.json'

export const LANGUAGES = ['en', 'ru'] as const
export type Language = (typeof LANGUAGES)[number]

export const DEFAULT_LANGUAGE: Language = 'en'

export function isLanguage(value: string): value is Language {
  return (LANGUAGES as readonly string[]).includes(value)
}

/**
 * Initialise i18next. Called once, from the settings store, so the language that was saved
 * in Settings is the one the app starts with (no flash of the wrong locale).
 */
export function initI18n(language: Language) {
  if (!i18n.isInitialized) {
    void i18n.use(initReactI18next).init({
      resources: {
        en: { translation: en },
        ru: { translation: ru },
      },
      lng: language,
      fallbackLng: DEFAULT_LANGUAGE,
      interpolation: { escapeValue: false },
      returnNull: false,
    })
  } else {
    void i18n.changeLanguage(language)
  }
  return i18n
}

export default i18n
