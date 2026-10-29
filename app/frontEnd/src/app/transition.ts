import type { CSSProperties } from 'react'
import { flushSync } from 'react-dom'

/**
 * 切页 / 切分区的过渡（View Transitions）：旧内容向导航的反方向轻移淡出，新内容从导航方向滑入归位
 * （往后面的标签走从右边进，往回走从左边进；只横移，不上下动）。
 *
 * - 过渡期间根元素带 data-nav-level，样式（index.css「切页过渡」）只在这时给内容区起名：
 *   切整页是 .ap-page，切分区是 .ap-section；顶栏、标签栏、通知单独成层并压在内容上面，保持不动。
 * - 新旧内容用不同的名字（按路由 / 分区命名，见 viewName），浏览器把它们当成「一个退场、一个进场」各自在原位动画：
 *   旧页面停在离开时的滚动位置淡出，新页面在顶部滑入，中间不会出现整块上下平移。
 * - 不支持 View Transitions 的浏览器直接换，新内容挂载时自己滑入。
 */

interface ViewTransitionLike {
  finished: Promise<void>
  skipTransition: () => void
}

type StartViewTransition = (update: () => void) => ViewTransitionLike

/** 不支持 View Transitions 时，滑入动画放完之前一直保留 data-nav-level */
const FALLBACK_MS = 400
/**
 * 浏览器要先画一帧截下旧画面才会调用更新：页面不出帧（Android WebView 熄屏、宿主把网页挂在后台但不合成）时会一直等着，
 * 导航看起来像卡住。等不到就跳过动画，直接换（跳过时浏览器照样会调用更新）。
 */
const CAPTURE_TIMEOUT_MS = 600

let generation = 0

export function swapView(update: () => void, { level, direction }: { level: 'page' | 'section'; direction: 1 | -1 }) {
  const root = document.documentElement
  const id = ++generation
  root.dataset.navLevel = level
  root.style.setProperty('--ap-nav-dir', String(direction))
  // 过渡还没放完又点了下一个：只有最后一次负责收尾
  const finish = () => {
    if (id === generation) delete root.dataset.navLevel
  }
  const start = (document as Document & { startViewTransition?: StartViewTransition }).startViewTransition?.bind(document)
  if (!start) {
    update()
    window.setTimeout(finish, FALLBACK_MS)
    return
  }
  let updated = false
  const transition = start(() => {
    updated = true
    flushSync(update)
  })
  const watchdog = window.setTimeout(() => !updated && transition.skipTransition(), CAPTURE_TIMEOUT_MS)
  void transition.finished.finally(() => {
    window.clearTimeout(watchdog)
    finish()
  })
}

/** 内容区在过渡里的名字（新旧不同名，见上） */
export const viewName = (name: string) => ({ '--ap-vt': name }) as CSSProperties

/** 在一组有序的标签里，从 from 到 to 是往后（1）还是往前（-1） */
export function directionOf<T>(order: readonly T[], from: T, to: T): 1 | -1 {
  return order.indexOf(to) >= order.indexOf(from) ? 1 : -1
}
