import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/cn'

import { monotonePath, type Point } from './curve'

/**
 * 迷你走势线：只看形状，不画坐标轴。纵轴自动缩放，但跨度至少 minSpan，
 * 免得 1–2 dB 的正常抖动被放大成剧烈起伏；空值处断开。
 */
export function Sparkline({
  values,
  height = 36,
  minSpan = 10,
  className,
}: {
  values: (number | null)[]
  height?: number
  minSpan?: number
  className?: string
}) {
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const finite = values.filter((v): v is number => v != null && Number.isFinite(v))
  let lo = Math.min(...finite)
  let hi = Math.max(...finite)
  if (hi - lo < minSpan) {
    const mid = (hi + lo) / 2
    lo = mid - minSpan / 2
    hi = mid + minSpan / 2
  }
  const pad = 3
  const step = values.length > 1 ? width / (values.length - 1) : 0
  const y = (v: number) => pad + (1 - (v - lo) / (hi - lo)) * (height - pad * 2)
  const segments: Point[][] = []
  values.forEach((v, i) => {
    if (v == null || !Number.isFinite(v)) return void segments.push([])
    const last = segments.at(-1)
    const point: Point = [i * step, y(v)]
    if (last) last.push(point)
    else segments.push([point])
  })
  const lastIndex = values.length - 1
  const lastValue = values[lastIndex]
  return (
    <div ref={ref} className={cn('w-full', className)} style={{ height }} aria-hidden>
      {width > 0 && finite.length > 1 && (
        <svg width={width} height={height} className="block overflow-visible">
          {segments
            .filter((segment) => segment.length > 1)
            .map((segment, index) => (
              <path key={index} d={monotonePath(segment)} fill="none" stroke="var(--color-text-3)" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          {lastValue != null && <circle cx={lastIndex * step} cy={y(lastValue)} r={3} fill="var(--color-text)" stroke="var(--color-surface)" strokeWidth={2} />}
        </svg>
      )}
    </div>
  )
}
