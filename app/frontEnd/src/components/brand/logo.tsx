import { cn } from '@/lib/cn'

/** 脉冲线条：与 public/favicon.svg 同一条路径（64×64 画布） */
export const PULSE_PATH = 'M11 34H21l4.5-8L31 44l6-28 5 22 3-4h8'

/**
 * 品牌标识：纯色圆角方块 + 一条心电脉冲线。不随强调色变（品牌要稳定），
 * 浅色主题黑底白线，深色主题反过来，在纯黑页面上也看得清。不用渐变、不加光晕。
 */
export function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" className={cn('shrink-0', className)} aria-hidden>
      <rect width="64" height="64" rx="15" className="fill-text" />
      <path
        d={PULSE_PATH}
        fill="none"
        className="stroke-bg"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function Wordmark({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={cn('flex min-w-0 items-baseline gap-1.5', className)}>
      <span className="text-[16px] font-semibold tracking-[-0.015em] text-text">AirPulse</span>
      {!compact && <span className="text-caption text-text-3">空脉</span>}
    </span>
  )
}
