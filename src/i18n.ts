import en from '../messages/en.json'
import zh from '../messages/zh.json'

export type LanguageTag = 'en' | 'zh'
type MessageKey = Exclude<keyof typeof zh, '$schema'>

const messages = { en, zh }
let currentLanguageTag: LanguageTag = 'zh'

export function languageTag() {
  return currentLanguageTag
}

export function setLanguageTag(tag: LanguageTag) {
  currentLanguageTag = tag
}

export function message(key: MessageKey) {
  return messages[currentLanguageTag][key]
}
