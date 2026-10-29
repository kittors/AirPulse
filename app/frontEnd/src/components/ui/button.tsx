import { CircleNotch } from '@phosphor-icons/react'
import { Slot } from '@radix-ui/react-slot'
import type { ComponentProps, ReactNode } from 'react'

import { cn } from '@/lib/cn'

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'ghost' | 'danger' | 'danger-soft'
export type ButtonSize = 'lg' | 'md' | 'sm' | 'icon-lg' | 'icon' | 'icon-sm'

/**
 * 按钮：胶囊形，纯色，不加光晕投影。
 * primary 强调色实底；secondary 中性灰底（iOS 的灰色按钮）；soft 强调色浅底；ghost 无底；danger 系列只给破坏性动作。
 */
const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent-solid text-on-accent hover:bg-accent-hover',
  secondary: 'bg-[rgb(120_120_128/0.12)] text-text hover:bg-[rgb(120_120_128/0.18)] dark:bg-[rgb(120_120_128/0.24)] dark:hover:bg-[rgb(120_120_128/0.32)]',
  soft: 'bg-accent-soft text-accent-text hover:bg-[color-mix(in_oklab,var(--color-accent-soft),var(--color-accent)_10%)]',
  ghost: 'text-text-2 hover:bg-hover hover:text-text',
  danger: 'bg-danger-solid text-white hover:bg-danger-solid-hover',
  'danger-soft': 'bg-danger-soft text-danger-text hover:bg-[color-mix(in_oklab,var(--color-danger-soft),var(--color-danger)_10%)]',
}

/** 手机上（<640px）统一抬到 ≥ 40px 的触控高度 */
const SIZES: Record<ButtonSize, string> = {
  lg: 'h-11 gap-2 px-5 text-[15px] font-semibold [&_svg]:size-[18px]',
  md: 'h-9 gap-1.5 px-4 text-[14px] font-medium [&_svg]:size-4 max-sm:h-10',
  sm: 'h-7 gap-1 px-3 text-[13px] font-medium [&_svg]:size-3.5 max-sm:h-9 max-sm:px-3.5',
  'icon-lg': 'size-11 [&_svg]:size-5',
  icon: 'size-9 [&_svg]:size-[18px] max-sm:size-10',
  'icon-sm': 'size-7 [&_svg]:size-4 max-sm:size-9',
}

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** 执行中：转圈、禁用，宽度不变 */
  loading?: boolean
  /** 前置图标；loading 时被转圈替换，按钮不会因此变宽 */
  icon?: ReactNode
  /** 把样式交给唯一的子元素（例如 <a>） */
  asChild?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  icon,
  asChild = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const classes = cn(
    'ap-press inline-flex shrink-0 select-none items-center justify-center rounded-full whitespace-nowrap',
    'disabled:pointer-events-none disabled:opacity-40 [&_svg]:shrink-0',
    VARIANTS[variant],
    SIZES[size],
    loading && 'disabled:opacity-70',
    className,
  )
  if (asChild) {
    return (
      <Slot className={classes} {...props}>
        {children}
      </Slot>
    )
  }
  return (
    <button type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={classes} {...props}>
      {loading ? <CircleNotch className="ap-spin" weight="bold" aria-hidden /> : icon}
      {children}
    </button>
  )
}
