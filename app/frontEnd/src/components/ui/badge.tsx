import { useEffect, useRef, useState, type ComponentProps } from 'react'

import { cn } from '@/lib/cn'
import type { Tone } from '@/lib/tone'

export type { Tone }

const TONES: Record<Tone, string> = {
  neutral: 'bg-sunken text-text-2',
  accent: 'bg-accent-soft text-accent-text',
  success: 'bg-success-soft text-success-text',
  warning: 'bg-warning-soft text-warning-text',
  danger: 'bg-danger-soft text-danger-text',
}

const DOTS: Record<Tone, string> = {
  neutral: 'bg-text-4',
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
}

/**
 * 状态标签：浅底 + 深一档的同色文字（不拿状态色本身当字色），总有文字说明，颜色不单独承担含义。
 */
export function Badge({
  tone = 'neutral',
  dot = false,
  live = false,
  size = 'md',
  className,
  children,
  ...props
}: ComponentProps<'span'> & {
  tone?: Tone
  /** 前置小圆点 */
  dot?: boolean
  /** 圆点带扩散，表示实时 */
  live?: boolean
  size?: 'sm' | 'md'
}) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap [&_svg]:shrink-0',
        size === 'md' ? 'h-6 px-2.5 text-caption [&_svg]:size-3.5' : 'h-5 px-2 text-[11px] [&_svg]:size-3',
        TONES[tone],
        className,
      )}
      {...props}
    >
      {(dot || live) && <span className={cn('ap-live-dot size-1.5', DOTS[tone])} data-breathing={live || undefined} aria-hidden />}
      {children}
    </span>
  )
}

/**
 * 计数角标（docs/design.md §3.4）。
 * - 高 18、最小宽 18（个位数时是正圆），11px/600 等宽数字；
 * - 文字用 text-box-trim 按大写字母高度光学居中，不支持的浏览器靠等高行高兜底；
 * - alert（未读）红底白字，neutral（在线数这类普通计数）灰底灰字；
 * - 超过 99 显示 99+；数值变化时轻轻弹一下；
 * - ring：压在图标上时描一圈背景色，把角标和图标分开。
 */
export function CountBadge({
  count,
  tone = 'alert',
  ring = false,
  className,
}: {
  count: number | null | undefined
  tone?: 'alert' | 'neutral' | 'accent'
  ring?: boolean
  className?: string
}) {
  const value = count ?? 0
  const [bump, setBump] = useState(0)
  const previous = useRef(value)
  useEffect(() => {
    if (value > previous.current) setBump((n) => n + 1)
    previous.current = value
  }, [value])
  if (value <= 0) return null
  const text = value > 99 ? '99+' : String(value)
  return (
    <span
      key={bump}
      aria-label={String(value)}
      className={cn(
        'num inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full px-[5px] text-[11px] leading-[18px] font-semibold',
        bump > 0 && 'ap-bump',
        tone === 'alert' && 'bg-danger text-white',
        tone === 'neutral' && 'bg-[rgb(120_120_128/0.16)] text-text-2',
        tone === 'accent' && 'bg-accent-solid text-on-accent',
        ring && 'ring-2 ring-[var(--ap-badge-ring,var(--color-bg))]',
        className,
      )}
    >
      <span className="trim-cap">{text}</span>
    </span>
  )
}
