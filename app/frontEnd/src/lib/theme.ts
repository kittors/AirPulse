import { useSyncExternalStore } from 'react'

import { storage } from './storage'
import { createStore, useStore } from './store'

export type ThemeMode = 'system' | 'light' | 'dark'
export type Accent = 'blue' | 'teal' | 'violet' | 'pink' | 'graphite'

export const ACCENTS: Accent[] = ['blue', 'teal', 'violet', 'pink', 'graphite']
/** 色票预览用的代表色（与 index.css 里各强调色的浅色 accent-solid 一致） */
export const ACCENT_SWATCH: Record<Accent, string> = {
  blue: '#007aff',
  teal: '#0a9bb5',
  violet: '#9b4fd1',
  pink: '#e8355d',
  graphite: '#1d1d1f',
}

/** 与 index.css 的 --color-bg 一致，用于浏览器地址栏 / 状态栏底色 */
const BG = { light: '#f5f5f7', dark: '#000000' }

/** 旧版本存下的强调色（indigo / sky）统一回到默认的系统蓝 */
function readAccent(): Accent {
  const saved = storage.get<string>('accent', 'blue')
  return (ACCENTS as string[]).includes(saved) ? (saved as Accent) : 'blue'
}

export const themeStore = createStore<ThemeMode>(storage.get<ThemeMode>('theme', 'system'))
export const accentStore = createStore<Accent>(readAccent())

const media = () => window.matchMedia('(prefers-color-scheme: dark)')

function apply() {
  const root = document.documentElement
  const mode = themeStore.get()
  const accent = accentStore.get()
  if (mode === 'system') root.removeAttribute('data-theme')
  else root.setAttribute('data-theme', mode)
  if (accent === 'blue') root.removeAttribute('data-accent')
  else root.setAttribute('data-accent', accent)

  const resolved = mode === 'system' ? (media().matches ? 'dark' : 'light') : mode
  document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]').forEach((meta) => {
    const scheme = meta.media.includes('dark') ? 'dark' : 'light'
    meta.content = mode === 'system' ? BG[scheme] : BG[resolved]
  })
}

themeStore.subscribe(() => {
  storage.set('theme', themeStore.get())
  apply()
})
accentStore.subscribe(() => {
  storage.set('accent', accentStore.get())
  apply()
})

/** 入口处调用一次：同步属性，并跟随系统明暗变化 */
export function initTheme() {
  apply()
  media().addEventListener('change', apply)
}

function subscribeSystem(listener: () => void) {
  const query = media()
  query.addEventListener('change', listener)
  return () => query.removeEventListener('change', listener)
}

export function useTheme() {
  const mode = useStore(themeStore)
  const accent = useStore(accentStore)
  const systemDark = useSyncExternalStore(
    subscribeSystem,
    () => media().matches,
    () => false,
  )
  const resolved: 'light' | 'dark' = mode === 'system' ? (systemDark ? 'dark' : 'light') : mode
  return {
    mode,
    resolved,
    accent,
    setMode: themeStore.set,
    setAccent: accentStore.set,
  }
}
