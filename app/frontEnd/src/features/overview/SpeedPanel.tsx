import { ArrowDown, ArrowUp } from '@phosphor-icons/react'

import { Panel } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { RollingNumber } from '@/components/viz/rolling-number'
import { SpeedChart, type SpeedSample } from '@/components/viz/speed-chart'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { formatBytes, formatRate, joinQuantity } from '@/lib/format'
import type { Telemetry } from '@/model/telemetry'

/**
 * 实时网速：整页唯一的大数字是下行速率（逐位滚动，只动变化的那一位），上行退一档；
 * 下面是按时间平滑滚动的走势。箭头带系列色当图例，数字本身用文字色。
 */
export function SpeedPanel({
  telemetry,
  history,
  className,
}: {
  telemetry: Telemetry | undefined
  history: SpeedSample[]
  className?: string
}) {
  const t = useT()
  if (!telemetry) {
    return (
      <Panel className={className}>
        <Skeleton className="h-4 w-20" />
        <Skeleton className="mt-4 h-14 w-56" />
        <Skeleton className="mt-6 h-[132px] w-full" />
      </Panel>
    )
  }
  const down = formatRate(telemetry.rxRate)
  const up = formatRate(telemetry.txRate)
  const today = telemetry.traffic.today
  return (
    <Panel className={cn('flex flex-col', className)}>
      <div className="flex h-5 items-center gap-2 text-footnote font-medium text-text-2">
        {t.overview.speedTitle}
        {today != null && <span className="num ml-auto text-caption font-normal text-text-3">{t.overview.todayUsed(joinQuantity(formatBytes(today)))}</span>}
      </div>

      {/* 并排还是上下排只看卡片宽度，不看数字：下行那一栏按最宽的读数（「99.9 Mbps」= 185 px）占位，
          数字怎么跳，上行都待在原地，也不会一会儿挤到下一行、一会儿又弹回来 */}
      <div className="mt-3 @container">
        <div className="flex flex-col gap-4 @min-[308px]:grid @min-[308px]:grid-cols-[185px_auto] @min-[308px]:items-end @min-[308px]:justify-start @min-[308px]:gap-x-[clamp(16px,100cqw_-_292px,48px)]">
          <Rate direction="down" label={t.overview.download} value={down.value} unit={down.unit} large />
          <Rate direction="up" label={t.overview.upload} value={up.value} unit={up.unit} />
        </div>
      </div>

      <SpeedChart
        className="mt-6"
        height={128}
        samples={history}
        labels={{
          down: t.overview.download,
          up: t.overview.upload,
          ago: t.overview.ago,
          now: t.overview.now,
          waiting: t.overview.waiting,
        }}
      />
      <div className="mt-2 flex justify-between text-caption2 font-medium text-text-4">
        <span>{t.overview.ago(60)}</span>
        <span>{t.overview.now}</span>
      </div>
    </Panel>
  )
}

function Rate({
  direction,
  label,
  value,
  unit,
  large = false,
}: {
  direction: 'down' | 'up'
  label: string
  value: string
  unit: string
  large?: boolean
}) {
  const Arrow = direction === 'down' ? ArrowDown : ArrowUp
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-caption text-text-3">
        <Arrow className="size-3.5" weight="bold" style={{ color: `var(--color-series-${direction})` }} aria-hidden />
        {label}
      </div>
      <div className={cn('flex items-baseline gap-1.5 text-text', large ? 'mt-1' : 'mt-0.5')}>
        <RollingNumber value={value} className={cn('num', large ? 'text-display' : 'text-metric')} />
        <span className={cn('font-medium text-text-2', large ? 'text-[20px]' : 'text-[15px]')}>{unit}</span>
      </div>
    </div>
  )
}
