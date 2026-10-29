import { LayoutGroup, motion } from 'motion/react'
import { useId, type KeyboardEvent, type ReactNode } from 'react'

import { cn } from '@/lib/cn'
import { spring } from '@/lib/motion'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  /** 只有图标时给读屏用的名字 */
  ariaLabel?: string
  disabled?: boolean
}

/**
 * 分段控件（iOS 样式）：浅灰圆角矩形轨道 + 白色选中块，选中块用共享布局（layoutId）
 * 在选项之间滑过去、宽度一起变，选项宽度不等时也严丝合缝。
 *
 * 选项只给最小高度：轨道被父级拉高时选中块跟着撑满，上下留白始终相等。
 * 和输入框并排放时用 size="lg"，总高正好 40px，与 Input / Select 对齐。
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  size = 'md',
  ariaLabel,
  fullWidth = false,
  disabled = false,
  pending = false,
  className,
}: {
  value: T | undefined
  onChange: (value: T) => void
  options: SegmentOption<T>[]
  size?: 'lg' | 'md' | 'sm'
  ariaLabel: string
  fullWidth?: boolean
  disabled?: boolean
  pending?: boolean
  className?: string
}) {
  const group = useId()
  const enabled = options.filter((option) => !option.disabled)

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const index = enabled.findIndex((option) => option.value === value)
    let next = index
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1)
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') next = Math.min(enabled.length - 1, index + 1)
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = enabled.length - 1
    const target = enabled[next]
    if (target && target.value !== value) {
      onChange(target.value)
      ;(event.currentTarget.querySelector(`[data-value="${target.value}"]`) as HTMLElement | null)?.focus()
    }
  }

  return (
    <LayoutGroup id={group}>
      <div
        role="radiogroup"
        aria-label={ariaLabel}
        aria-disabled={disabled || undefined}
        aria-busy={pending || undefined}
        onKeyDown={onKeyDown}
        className={cn(
          'ap-no-scrollbar relative inline-flex max-w-full shrink-0 overflow-x-auto rounded-[9px] bg-[rgb(120_120_128/0.12)] p-[2px] dark:bg-[rgb(120_120_128/0.24)]',
          fullWidth && 'flex w-full',
          disabled && 'opacity-60',
          className,
        )}
      >
        {options.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              data-value={option.value}
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={option.ariaLabel}
              tabIndex={selected || (value === undefined && option === enabled[0]) ? 0 : -1}
              disabled={disabled || option.disabled}
              onClick={() => !selected && onChange(option.value)}
              className={cn(
                'relative inline-flex min-w-0 shrink-0 items-center justify-center gap-1.5 rounded-[7px] font-medium whitespace-nowrap',
                'transition-colors duration-150 focus-visible:outline-offset-0 disabled:cursor-not-allowed disabled:opacity-50',
                '[&_svg]:relative [&_svg]:z-10 [&_svg]:size-[15px]',
                size === 'lg' && 'min-h-9 px-4 text-[14px]',
                size === 'md' && 'min-h-7 px-3.5 text-[13px] max-sm:min-h-8',
                size === 'sm' && 'min-h-6 px-2.5 text-[12px] max-sm:min-h-7',
                fullWidth && 'flex-1',
                selected ? 'text-text' : 'text-text-2 hover:text-text',
              )}
            >
              {selected && (
                <motion.span
                  layoutId="thumb"
                  transition={spring.snappy}
                  className={cn('absolute inset-0 rounded-[7px] bg-thumb shadow-thumb', pending && 'animate-pulse')}
                  aria-hidden
                />
              )}
              <span className="relative z-10 inline-flex items-center gap-1.5">{option.label}</span>
            </button>
          )
        })}
      </div>
    </LayoutGroup>
  )
}
