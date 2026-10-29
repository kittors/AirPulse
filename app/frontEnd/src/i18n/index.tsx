import { storage } from '@/lib/storage'
import { createStore, useStore } from '@/lib/store'

import { en } from './en'
import { zh, type Messages } from './zh'

export type { Ipv6Change, Messages } from './zh'
export type Locale = 'zh' | 'en'

export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'zh', label: '简体中文' },
  { value: 'en', label: 'English' },
]

const DICTS: Record<Locale, Messages> = { zh, en }

function detect(): Locale {
  const saved = storage.get<Locale | null>('locale', null)
  if (saved === 'zh' || saved === 'en') return saved
  return navigator.language?.toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

export const localeStore = createStore<Locale>(detect())

localeStore.subscribe(() => {
  const locale = localeStore.get()
  storage.set('locale', locale)
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
})

/**
 * 文案：直接取对象属性（t.nav.overview），有完整的类型提示；
 * 需要插值的条目写成函数（t.radio.bandsSelected(3)）。
 * 英文词典的类型就是中文词典的结构，漏翻一个键编译就过不去。
 */
export function useT(): Messages {
  return DICTS[useStore(localeStore)]
}

/** 组件外（请求层、toast 文案）用 */
export function getT(): Messages {
  return DICTS[localeStore.get()]
}

export function useLocale(): [Locale, (locale: Locale) => void] {
  return [useStore(localeStore), localeStore.set]
}

export function initLocale() {
  document.documentElement.lang = localeStore.get() === 'zh' ? 'zh-CN' : 'en'
}
