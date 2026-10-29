import { cn } from '@/lib/cn'

/**
 * 信号格：0–4 格。格数是主编码，颜色是辅助——
 * 4/3 格绿、2 格琥珀、1 格红、0 格全灰（三档状态色已过色觉障碍分离校验）。
 */
export function SignalBars({
  level,
  size = 16,
  className,
  label,
}: {
  level: number | null | undefined
  size?: number
  className?: string
  label?: string
}) {
  const lit = level == null ? 0 : Math.max(0, Math.min(4, Math.round(level)))
  const tone = lit >= 3 ? 'var(--color-success)' : lit === 2 ? 'var(--color-warning)' : lit === 1 ? 'var(--color-danger)' : ''
  const gap = Math.max(1.5, size / 10)
  const width = (size - gap * 3) / 4
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={cn('shrink-0', className)}
      role="img"
      aria-label={label ?? `${lit}/4`}
    >
      {[0, 1, 2, 3].map((index) => {
        const height = size * (0.34 + index * 0.22)
        return (
          <rect
            key={index}
            x={index * (width + gap)}
            y={size - height}
            width={width}
            height={height}
            rx={Math.min(1.5, width / 3)}
            fill={index < lit ? tone : 'var(--color-border-strong)'}
            className="ap-motion-safe-transition transition-[fill] duration-(--duration-base)"
          />
        )
      })}
    </svg>
  )
}
