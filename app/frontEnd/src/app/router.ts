import { createStore, useStore } from '@/lib/store'

/**
 * hash 路由：设备上的静态文件服务没有 SPA 回退（访问 /radio 会 404），
 * 所以页面永远停在 /index.html，模块切换只改 #/radio 这一段；
 * 模块里的分区用第二段表示（#/tools/at、#/settings/network），刷新后还停在原处。
 */
export type RouteId = 'overview' | 'radio' | 'hotspot' | 'messages' | 'tools' | 'settings'

export const ROUTES: RouteId[] = ['overview', 'radio', 'hotspot', 'messages', 'tools', 'settings']

interface Location {
  route: RouteId
  /** 第二段（分区），没有时为 null */
  sub: string | null
}

function parse(): Location {
  const [head, sub] = window.location.hash.replace(/^#\/?/, '').split('?')[0].split('/')
  const route = ROUTES.includes(head as RouteId) ? (head as RouteId) : 'overview'
  return { route, sub: sub ? decodeURIComponent(sub) : null }
}

export const locationStore = createStore<Location>(parse())

// 换模块后回到顶部由外壳在新页面真正换上时做（AppShell）：这里就滚，旧页面会先跳到顶再被换掉
window.addEventListener('hashchange', () => locationStore.set(parse()))

export function hrefOf(route: RouteId, sub?: string | null): string {
  if (sub) return `#/${route}/${encodeURIComponent(sub)}`
  return route === 'overview' ? '#/' : `#/${route}`
}

export function navigate(route: RouteId, sub?: string | null) {
  window.location.hash = hrefOf(route, sub)
}

export const useRoute = () => useStore(locationStore).route
export const useSubRoute = () => useStore(locationStore).sub
