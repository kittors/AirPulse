import type { Transition } from 'motion/react'

/**
 * 动效参数（全站统一，docs/design.md §3.5）。
 * 原则：短、利落、几乎不回弹——动画是为了让变化看得见，不是为了表演。
 * visualDuration 是视觉上「到位」的时间，bounce 是回弹量。
 * 用户系统开了「减弱动态效果」时，MotionConfig reducedMotion="user" 会自动去掉位移与缩放。
 */
export const spring = {
  /** 选中块、开关、芯片这类小件 */
  snappy: { type: 'spring', visualDuration: 0.26, bounce: 0.1 } as Transition,
  /** 读数、进度这类数值过渡：稳，不回弹 */
  smooth: { type: 'spring', visualDuration: 0.4, bounce: 0 } as Transition,
  /** 浮层进出 */
  pop: { type: 'spring', visualDuration: 0.3, bounce: 0.12 } as Transition,
  /** 列表换位 */
  layout: { type: 'spring', visualDuration: 0.3, bounce: 0.06 } as Transition,
}

/** 展开 / 收起（折叠区） */
export const collapse = {
  initial: { opacity: 0, height: 0 },
  animate: { opacity: 1, height: 'auto' },
  exit: { opacity: 0, height: 0 },
  transition: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
} as const
