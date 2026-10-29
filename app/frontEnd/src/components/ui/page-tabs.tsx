import type { Icon } from '@phosphor-icons/react'
import { LayoutGroup, motion } from 'motion/react'
import { useEffect, useId, useRef } from 'react'

import { hrefOf, type RouteId } from '@/app/router'
import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'

export interface PageTab<T extends string> {
  value: T
  label: string
  icon?: Icon
}

/**
 * 页内分区标签（工具、设置这类大页面）：iOS 分段控件的外观，但每一项是链接（#/tools/at），
 * 刷新、前进后退都停在原分区；选中块在各项之间滑动。窄屏上可以横向滑动。
 */
export function PageTabs<T extends string>({
  route,
  tabs,
  value,
  className,
}: {
  route: RouteId
  tabs: PageTab<T>[]
  value: T
  className?: string
}) {
  const group = useId()
  const nav = useRef<HTMLElement>(null)
  // 窄屏上标签放不下时，把当前分区滚进可视范围（例如直接打开 #/tools/update）
  useEffect(() => {
    const el = nav.current
    const active = el?.querySelector<HTMLElement>('[aria-current="page"]')
    if (!el || !active || el.scrollWidth <= el.clientWidth) return
    const box = el.getBoundingClientRect()
    const item = active.getBoundingClientRect()
    if (item.left < box.left + 16) el.scrollLeft -= box.left + 16 - item.left
    else if (item.right > box.right - 16) el.scrollLeft += item.right - (box.right - 16)
  }, [value])
  return (
    <LayoutGroup id={group}>
      <nav
        ref={nav}
        className={cn(
          'ap-no-scrollbar -mx-4 mb-6 overflow-x-auto px-4 max-sm:mb-5 lg:mx-0 lg:px-0',
          // 两端淡出，提示还能横向滑动
          'max-lg:[mask-image:linear-gradient(to_right,transparent,#000_12px,#000_calc(100%-12px),transparent)]',
          className,
        )}
      >
        <div className="inline-flex rounded-[10px] bg-[rgb(120_120_128/0.12)] p-[2px] dark:bg-[rgb(120_120_128/0.24)]">
          {tabs.map((tab) => {
            const active = tab.value === value
            const TabIcon = tab.icon
            return (
              <a
                key={tab.value}
                href={hrefOf(route, tab.value)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative flex h-8 shrink-0 items-center gap-1.5 rounded-[8px] px-3.5 text-[13px] font-medium whitespace-nowrap',
                  'transition-colors duration-150',
                  active ? 'text-text' : 'text-text-2 hover:text-text',
                )}
              >
                {active && (
                  <motion.span layoutId="page-tab" transition={spring.snappy} className="absolute inset-0 rounded-[8px] bg-thumb shadow-thumb" aria-hidden />
                )}
                {TabIcon && <TabIcon className="relative size-[15px]" weight={active ? 'fill' : 'regular'} />}
                <span className="relative">{tab.label}</span>
              </a>
            )
          })}
        </div>
      </nav>
    </LayoutGroup>
  )
}
