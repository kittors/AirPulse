import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

/**
 * 可切换芯片（频段锁）：替代原生复选框。
 * - pressed：允许驻留——强调色浅底 + 强调色字；未选：透明底 + 虚线框 + 灰字，一眼分清；
 * - live：设备此刻驻留在这个频段，芯片里文字前一颗绿点；
 * - dirty：与设备上的配置不一致（尚未应用），右上角一颗强调色小点。
 */
export function ToggleChip({
  pressed,
  onPressedChange,
  live = false,
  dirty = false,
  onClick,
  className,
  children,
  ...props
}: Omit<ComponentProps<'button'>, 'onChange'> & {
  pressed: boolean
  onPressedChange?: (pressed: boolean) => void
  live?: boolean
  dirty?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      {...props}
      // 包在 Tooltip / Popover 的 asChild 里时外层也会注入 onClick：两者串联，不能互相覆盖
      onClick={(event) => {
        onClick?.(event)
        if (!event.defaultPrevented) onPressedChange?.(!pressed)
      }}
      className={cn(
        'ap-press relative inline-flex h-8 min-w-[56px] items-center justify-center gap-1.5 rounded-chip px-3',
        'num text-[14px] font-medium select-none max-sm:h-9',
        'disabled:cursor-not-allowed disabled:opacity-40',
        pressed
          ? 'bg-accent-soft text-accent-text hover:bg-[color-mix(in_oklab,var(--color-accent-soft),var(--color-accent)_8%)]'
          : 'border border-dashed border-border-strong text-text-3 hover:text-text-2',
        className,
      )}
    >
      {live && <span aria-hidden className="size-1.5 rounded-full bg-success" />}
      {children}
      {dirty && (
        <span aria-hidden className="absolute -top-[3px] -right-[3px] size-2 rounded-full bg-accent ring-2 ring-surface" />
      )}
    </button>
  )
}
