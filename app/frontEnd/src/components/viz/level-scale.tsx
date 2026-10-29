import { cn } from '@/lib/cn'

/** 信号强度色阶（RSRP -125 → -70 dBm）：微弱红 → 一般橙黄 → 良好 / 极佳绿，色带与质量阈值对齐 */
export const SIGNAL_GRADIENT =
  'linear-gradient(90deg, var(--color-danger) 0%, var(--color-danger) 22%, var(--color-warning) 42%, var(--color-yellow) 56%, var(--color-success) 72%, var(--color-success) 100%)'

/** 机身温度色阶（20 → 80 °C）：正常绿 → 偏热黄 → 热橙 → 过热红 */
export const THERMAL_GRADIENT =
  'linear-gradient(90deg, var(--color-success) 0%, var(--color-success) 30%, var(--color-yellow) 48%, var(--color-warning) 66%, var(--color-danger) 88%, var(--color-danger) 100%)'

/**
 * 色阶条（学 Apple 天气的紫外线指数条）：一条细的渐变色带 + 一个圆点标出当前位置。
 * 颜色本身就是刻度，不需要再画刻度线；圆点用正文色、描一圈卡片底色，在色带上像嵌进去一样清楚。
 * position 为 null 时色带变灰、不画点。
 */
export function LevelScale({
  position,
  gradient,
  className,
}: {
  /** 0–1 */
  position: number | null
  gradient: string
  className?: string
}) {
  const clamped = position == null ? null : Math.min(1, Math.max(0, position))
  return (
    <div className={cn('relative h-[5px] w-full', className)} aria-hidden>
      <div
        className={cn('absolute inset-0 rounded-full', clamped == null && 'opacity-30 grayscale')}
        style={{ background: gradient }}
      />
      {clamped != null && (
        <span
          className="ap-motion-safe-transition absolute top-1/2 size-[11px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-text shadow-[0_0_0_2.5px_var(--color-surface)] transition-[left] duration-500 ease-out"
          style={{ left: `${clamped * 100}%` }}
        />
      )}
    </div>
  )
}
