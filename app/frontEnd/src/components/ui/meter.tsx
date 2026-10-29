import { cn } from '@/lib/cn'

export type MeterTone = 'accent' | 'success' | 'warning' | 'danger' | 'neutral'

const FILL: Record<MeterTone, string> = {
  accent: 'bg-accent',
  success: 'bg-success',
  warning: 'bg-warning',
  danger: 'bg-danger',
  neutral: 'bg-text-3',
}

/** 按阈值取严重程度：[警告线, 危险线]，越高越糟（CPU、内存、温度） */
export function toneByThreshold(value: number | null | undefined, [warnAt, dangerAt]: [number, number]): MeterTone {
  if (value == null || Number.isNaN(value)) return 'neutral'
  if (value >= dangerAt) return 'danger'
  if (value >= warnAt) return 'warning'
  return 'accent'
}

export function Meter({
  value,
  max = 100,
  tone = 'accent',
  size = 'md',
  label,
  className,
}: {
  value: number | null | undefined
  max?: number
  tone?: MeterTone
  size?: 'sm' | 'md'
  /** 读屏用名称 */
  label?: string
  className?: string
}) {
  const ratio = value == null || Number.isNaN(value) ? 0 : Math.min(1, Math.max(0, value / max))
  return (
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value ?? undefined}
      className={cn(
        'relative w-full overflow-hidden rounded-full bg-[rgb(120_120_128/0.16)] dark:bg-[rgb(120_120_128/0.28)]',
        size === 'md' ? 'h-1.5' : 'h-1',
        className,
      )}
    >
      <div
        className={cn(
          'ap-motion-safe-transition absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-(--duration-slow) ease-out',
          FILL[tone],
        )}
        style={{ width: `${ratio * 100}%` }}
      />
    </div>
  )
}
