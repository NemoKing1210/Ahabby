import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

import de from './locales/de.json'
import en from './locales/en.json'
import es from './locales/es.json'
import fr from './locales/fr.json'
import ja from './locales/ja.json'
import ru from './locales/ru.json'
import zh from './locales/zh.json'

export const LANGUAGES = ['en', 'ru', 'zh', 'es', 'de', 'ja', 'fr'] as const
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
        zh: { translation: zh },
        es: { translation: es },
        de: { translation: de },
        ja: { translation: ja },
        fr: { translation: fr },
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
