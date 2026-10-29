import { useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from 'react'

import { useElementSize } from '@/hooks/useElementSize'
import { cn } from '@/lib/cn'
import { formatRate, joinQuantity } from '@/lib/format'

import { areaPath, monotonePath, type Point } from './curve'

export interface SpeedSample {
  /** 采样时间（毫秒，本机时钟） */
  t: number
  /** 下行 / 上行，字节每秒 */
  down: number
  up: number
}

/** 速率低于 1 Mbps 时也给出 1 Mbps 的刻度，空闲时曲线贴在底部而不是把噪声放大 */
const MIN_SCALE = 125_000
/** 超过 5 秒没有采样就断开线段，不把离线期间连成一条斜线 */
const GAP_MS = 5_000
/** 画面比真实时间晚一个采样间隔多一点：新点在画面外，随时间滑进来 */
const DELAY_MS = 1_200

/** 纵轴分档：1、1.5、2、3、4、5、6、8 × 10ⁿ */
function niceScale(value: number): number {
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const step = [1, 1.5, 2, 3, 4, 5, 6, 8, 10].find((s) => s * base >= value) ?? 10
  return step * base
}

/** 刻度标签：800M / 1.5G / 400K（bit/s） */
function compactRate(bytesPerSecond: number): string {
  const { value, unit } = formatRate(bytesPerSecond)
  return `${value.replace(/\.0+$/, '')}${unit.replace('bps', '')}`
}

/**
 * 实时速率走势（学 Apple 股票：干净的线 + 淡面积，没有竖向网格）。
 * 曲线的位置完全由时间决定：每帧按「现在」平移整组路径，而不是「新数据到了就跳一格再弹回」，
 * 所以滚动是连续的；最后一个点之后补一段同高的线延到右边缘，数据迟到时线平着走、不在半空断掉。
 * 下行蓝线 + 面积，上行橙线；悬停显示十字线与两项读数（读数用文字色，不用系列色）。
 */
export function SpeedChart({
  samples,
  windowSec = 60,
  height = 140,
  labels,
  className,
}: {
  samples: SpeedSample[]
  windowSec?: number
  height?: number
  labels: { down: string; up: string; ago: (seconds: number) => string; now: string; waiting: string }
  className?: string
}) {
  const gradientId = `ap-speed-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const groupRef = useRef<SVGGElement>(null)
  const offsetRef = useRef(0)
  const top = 6
  const bottom = height - 1
  const plotH = bottom - top
  const latest = samples.at(-1)
  const pxPerMs = width / (windowSec * 1000)

  const visible = useMemo(
    () => (latest ? samples.filter((s) => latest.t - s.t <= windowSec * 1000 + DELAY_MS + GAP_MS) : []),
    [samples, latest, windowSec],
  )
  const origin = visible[0]?.t ?? 0

  // 纵轴：只看可见窗口内的峰值；涨了立刻跟上，跌到六成以下才收回，避免来回跳
  const scaleRef = useRef(MIN_SCALE)
  const yMax = useMemo(() => {
    const peak = visible.reduce((max, s) => Math.max(max, s.down, s.up), 0)
    const target = niceScale(Math.max(MIN_SCALE, peak * 1.12))
    if (target > scaleRef.current || target < scaleRef.current * 0.6) scaleRef.current = target
    return scaleRef.current
  }, [visible])

  const y = (v: number) => bottom - (Math.min(v, yMax) / yMax) * plotH

  const paths = useMemo(() => {
    const groups: SpeedSample[][] = []
    for (const sample of visible) {
      const group = groups.at(-1)
      const prev = group?.at(-1)
      if (!group || !prev || sample.t - prev.t > GAP_MS) groups.push([sample])
      else if (sample.t > prev.t) group.push(sample)
    }
    return groups.map((group, index) => {
      const last = group.at(-1)!
      // 最后一段补一个同高的点，延到「现在」之后，数据迟到时线平着走
      const tail = index === groups.length - 1 ? [{ ...last, t: last.t + DELAY_MS + 2_500 }] : []
      const points = [...group, ...tail]
      const down: Point[] = points.map((s) => [(s.t - origin) * pxPerMs, y(s.down)])
      const up: Point[] = points.map((s) => [(s.t - origin) * pxPerMs, y(s.up)])
      return { key: group[0].t, area: areaPath(down, bottom), down: monotonePath(down), up: monotonePath(up) }
    })
    // y 依赖 yMax / 高度
  }, [visible, origin, pxPerMs, yMax, height])

  // 每帧按时间平移；开了「减弱动态效果」就只在数据到达时挪一次（布局阶段先摆好，首帧不闪）
  useLayoutEffect(() => {
    if (!width || !latest) return
    const place = (now: number) => {
      const dx = width - (now - DELAY_MS - origin) * pxPerMs
      offsetRef.current = dx
      groupRef.current?.setAttribute('transform', `translate(${dx.toFixed(2)} 0)`)
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      place(latest.t + DELAY_MS)
      return
    }
    let frame = 0
    const tick = () => {
      place(Date.now())
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [width, origin, pxPerMs, latest])

  const [hover, setHover] = useState<SpeedSample | null>(null)
  const onPointer = (event: PointerEvent<SVGSVGElement>) => {
    if (visible.length === 0 || !pxPerMs) return
    const rect = event.currentTarget.getBoundingClientRect()
    const t = origin + (event.clientX - rect.left - offsetRef.current) / pxPerMs
    let best = visible[0]
    for (const s of visible) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s
    setHover(best)
  }
  const hoverX = hover ? (hover.t - origin) * pxPerMs + offsetRef.current : 0
  const ready = width > 0 && visible.length >= 2

  return (
    <div ref={ref} className={cn('relative w-full select-none', className)} style={{ height }}>
      {width > 0 && (
        <svg
          width={width}
          height={height}
          className="block touch-pan-y"
          role="img"
          aria-label={
            latest
              ? `${labels.down} ${joinQuantity(formatRate(latest.down))}，${labels.up} ${joinQuantity(formatRate(latest.up))}`
              : labels.waiting
          }
          onPointerMove={onPointer}
          onPointerDown={onPointer}
          onPointerLeave={() => setHover(null)}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--color-series-down)" stopOpacity="0.18" />
              <stop offset="1" stopColor="var(--color-series-down)" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* 横向发丝线：底线 + 半程 + 顶端，刻度标签写在图内左侧，不占宽度 */}
          {[0, 0.5, 1].map((f) => {
            const gy = Math.round(y(yMax * f)) + (f === 0 ? -0.5 : 0.5)
            return (
              <g key={f}>
                <line x1={0} x2={width} y1={gy} y2={gy} stroke="var(--color-line)" strokeWidth={1} strokeDasharray={f === 0 ? undefined : '2 3'} />
                {f > 0 && (
                  <text x={0} y={gy + 13} className="num fill-text-4 text-[10.5px] font-medium">
                    {compactRate(yMax * f)}
                  </text>
                )}
              </g>
            )
          })}

          {ready ? (
            <g ref={groupRef}>
              {paths.map((path) => (
                <g key={path.key}>
                  <path d={path.area} fill={`url(#${gradientId})`} />
                  <path d={path.up} fill="none" stroke="var(--color-series-up)" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
                  <path d={path.down} fill="none" stroke="var(--color-series-down)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                </g>
              ))}
            </g>
          ) : (
            <text x={width / 2} y={top + plotH / 2 + 4} textAnchor="middle" className="fill-text-4 text-[12px]">
              {labels.waiting}
            </text>
          )}

          {hover && (
            <g pointerEvents="none">
              <line x1={hoverX} x2={hoverX} y1={top} y2={bottom} stroke="var(--color-text-3)" strokeOpacity={0.5} strokeWidth={1} />
              <circle cx={hoverX} cy={y(hover.up)} r={4} fill="var(--color-series-up)" stroke="var(--color-surface)" strokeWidth={2} />
              <circle cx={hoverX} cy={y(hover.down)} r={4} fill="var(--color-series-down)" stroke="var(--color-surface)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}

      {hover && latest && (
        <div
          className="pointer-events-none absolute -top-2 z-10 w-44 rounded-[12px] bg-raised px-3 py-2.5 shadow-overlay"
          style={{ left: Math.min(Math.max(hoverX + 12, 0), Math.max(0, width - 176)) }}
        >
          <p className="mb-1 text-caption text-text-3">
            {latest.t - hover.t < 1500 ? labels.now : labels.ago(Math.round((latest.t - hover.t) / 1000))}
          </p>
          {(['down', 'up'] as const).map((key) => (
            <p key={key} className="flex items-center gap-2 text-footnote text-text-2">
              <span className="size-2 rounded-full" style={{ background: `var(--color-series-${key})` }} aria-hidden />
              <span className="flex-1">{key === 'down' ? labels.down : labels.up}</span>
              <span className="num font-semibold text-text">{joinQuantity(formatRate(hover[key]))}</span>
            </p>
          ))}
        </div>
      )}
    </div>
  )
}
