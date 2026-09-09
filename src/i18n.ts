import en from '../messages/en.json'
import zh from '../messages/zh.json'

export type LanguageTag = 'en' | 'zh'
type MessageKey = Exclude<keyof typeof zh, '$schema'>

const messages = { en, zh }
const STORAGE_KEY = 'inpaint-language'

function initialLanguage(): LanguageTag {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'zh') return stored
  } catch {
    // The current session still works when browser storage is unavailable.
  }
  return typeof navigator !== 'undefined' &&
    navigator.language.toLowerCase().startsWith('zh')
    ? 'zh'
    : 'en'
}

let currentLanguageTag: LanguageTag = initialLanguage()

export function languageTag() {
  return currentLanguageTag
}

export function setLanguageTag(tag: LanguageTag) {
  currentLanguageTag = tag
  try {
    window.localStorage.setItem(STORAGE_KEY, tag)
  } catch {
    // Keep the chosen language in memory even if persistence fails.
  }
}

export function message(key: MessageKey) {
  return messages[currentLanguageTag][key]
}
