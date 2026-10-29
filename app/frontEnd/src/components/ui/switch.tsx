import { CircleNotch } from '@phosphor-icons/react'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import type { ComponentProps } from 'react'

import { cn } from '@/lib/cn'

/**
 * 开关：iOS 比例（44 × 26），拨杆沿弹簧曲线位移；按住时拨杆横向拉伸，松手回弹。
 * loading 时拨杆里转圈并禁用，表示指令已发出、等待设备确认。
 * 命中区域用伪元素扩到 44px，手指好点。
 */
export function Switch({
  className,
  loading = false,
  disabled,
  size = 'md',
  ...props
}: ComponentProps<typeof SwitchPrimitive.Root> & { loading?: boolean; size?: 'md' | 'sm' }) {
  return (
    <SwitchPrimitive.Root
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'group relative inline-flex shrink-0 items-center rounded-full p-[2px]',
        'bg-[rgb(120_120_128/0.16)] transition-colors duration-200 ease-out dark:bg-[rgb(120_120_128/0.32)]',
        'before:absolute before:-inset-x-1 before:-inset-y-[9px] before:content-[""]',
        'data-[state=checked]:bg-accent-solid disabled:cursor-not-allowed',
        !loading && 'disabled:opacity-50',
        size === 'md' ? 'h-[26px] w-[44px]' : 'h-5 w-[34px]',
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          'pointer-events-none grid place-items-center rounded-full bg-white',
          'shadow-[0_2px_4px_rgb(0_0_0/0.18),0_0_0_0.5px_rgb(0_0_0/0.04)]',
          'ap-motion-safe-transition transition-[translate,width] duration-[420ms] ease-spring',
          'data-[state=checked]:bg-on-accent',
          size === 'md'
            ? 'h-[22px] w-[22px] group-active:w-[27px] data-[state=checked]:translate-x-[18px] group-active:data-[state=checked]:translate-x-[13px]'
            : 'h-4 w-4 group-active:w-5 data-[state=checked]:translate-x-3.5 group-active:data-[state=checked]:translate-x-2.5',
        )}
      >
        {loading && <CircleNotch className="ap-spin size-3 text-text-3" weight="bold" aria-hidden />}
      </SwitchPrimitive.Thumb>
    </SwitchPrimitive.Root>
  )
}
