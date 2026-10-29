import { useState } from 'react'

import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/cn'
import { formatBytes, joinQuantity } from '@/lib/format'

export interface UsageBar {
  /** 1–31 */
  day: number
  bytes: number
  /** 是否今天（高亮） */
  today?: boolean
}

/**
 * 逐日用量柱状图（单一序列，不需要图例）：细柱、顶端 4px 圆角落在底线上、柱间 2px 留白；
 * 今天的柱子用实色，其余同色调淡一档；悬停显示当天用量。纵轴只标最大值，横轴标 1 / 8 / 15 / 22 / 月末。
 */
export function UsageBars({ bars, daysInMonth, height = 120, label, className }: { bars: UsageBar[]; daysInMonth: number; height?: number; label: (day: number) => string; className?: string }) {
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<UsageBar | null>(null)
  const max = Math.max(1, ...bars.map((bar) => bar.bytes))
  const gap = 2
  const slot = width / daysInMonth
  const barWidth = Math.max(2, slot - gap)
  const ticks = [1, 8, 15, 22, daysInMonth]
  const byDay = new Map(bars.map((bar) => [bar.day, bar]))
  return (
    <div className={cn('relative', className)}>
      <div ref={ref} className="relative w-full" style={{ height }} onPointerLeave={() => setHover(null)}>
        {width > 0 && (
          <svg width={width} height={height} className="block" role="img" aria-label={label(0)}>
            <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--color-line)" />
            {Array.from({ length: daysInMonth }, (_, i) => {
              const day = i + 1
              const bar = byDay.get(day)
              const h = bar ? Math.max(bar.bytes > 0 ? 3 : 0, (bar.bytes / max) * (height - 4)) : 0
              const x = i * slot + gap / 2
              const r = Math.min(4, barWidth / 2, h)
              return (
                <g key={day} onPointerEnter={() => bar && setHover(bar)}>
                  {/* 命中区比柱子大，细柱也好悬停 */}
                  <rect x={i * slot} y={0} width={slot} height={height} fill="transparent" />
                  {h > 0 && (
                    <path
                      d={`M${x},${height} V${height - h + r} Q${x},${height - h} ${x + r},${height - h} H${x + barWidth - r} Q${x + barWidth},${height - h} ${x + barWidth},${height - h + r} V${height} Z`}
                      fill="var(--color-series-down)"
                      opacity={bar?.today || hover?.day === day ? 1 : 0.45}
                    />
                  )}
                </g>
              )
            })}
          </svg>
        )}
        {hover && width > 0 && (
          <div
            className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-[10px] bg-raised px-2.5 py-1.5 text-caption whitespace-nowrap shadow-overlay"
            style={{ left: Math.min(Math.max((hover.day - 0.5) * slot, 60), width - 60) }}
          >
            <span className="text-text-3">{label(hover.day)}</span>
            <span className="num ml-2 font-semibold text-text">{joinQuantity(formatBytes(hover.bytes))}</span>
          </div>
        )}
      </div>
      <div className="relative mt-1.5 h-4 text-caption2 font-medium text-text-4">
        {width > 0 &&
          ticks.map((day) => (
            <span key={day} className="num absolute -translate-x-1/2" style={{ left: (day - 0.5) * slot }}>
              {day}
            </span>
          ))}
      </div>
    </div>
  )
}
