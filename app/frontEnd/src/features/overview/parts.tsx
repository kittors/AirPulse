import type { ReactNode } from 'react'

import { Tooltip } from '@/components/ui/overlay'
import { toast } from '@/components/ui/toast'
import { useT, type Messages } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import type { Quality } from '@/lib/signal'
import type { Telemetry } from '@/model/telemetry'

export function carrierName(t: Messages, telemetry: Telemetry): string {
  if (telemetry.carrier) return t.network.carriers[telemetry.carrier]
  return telemetry.provider || t.network.unknownCarrier
}

/** 质量词的文字色：用状态色的「文字档」（比图形档深一级），保证对比度 */
export const QUALITY_TEXT: Record<Quality, string> = {
  excellent: 'text-success-text',
  good: 'text-success-text',
  fair: 'text-warning-text',
  poor: 'text-danger-text',
  none: 'text-text-3',
}

export const QUALITY_DOT: Record<Quality, string> = {
  excellent: 'bg-success',
  good: 'bg-success',
  fair: 'bg-warning',
  poor: 'bg-danger',
  none: 'bg-text-4',
}

/** 「3 分钟前」这类相对时间 */
export function relativeTime(t: Messages, time: number | null, now = Date.now()): string {
  if (time == null) return ''
  const diff = Math.max(0, now - time)
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return t.overview.time.justNow
  if (minutes < 60) return t.overview.time.minutes(minutes)
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t.overview.time.hours(hours)
  const days = Math.floor(hours / 24)
  return days === 1 ? t.overview.time.yesterday : t.overview.time.days(days)
}

/** 数字 + 小一号的单位，基线对齐 */
export function Quantity({
  value,
  unit,
  className,
  unitClassName,
}: {
  value: ReactNode
  unit?: ReactNode
  className?: string
  unitClassName?: string
}) {
  return (
    <span className={cn('inline-flex items-baseline gap-1 whitespace-nowrap', className)}>
      <span className="num">{value}</span>
      {unit ? <span className={cn('font-medium text-text-2', unitClassName)}>{unit}</span> : null}
    </span>
  )
}

/** 一项读数：小标签 + 数值；给了 copy 时整块可点，悬停提示「点击复制」 */
export function Readout({
  label,
  value,
  unit,
  copy,
  className,
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  copy?: string | null
  className?: string
}) {
  const t = useT()
  const body = (
    <>
      <span className="block text-caption text-text-3">{label}</span>
      <Quantity value={value ?? '—'} unit={unit} className="mt-1 text-[17px] leading-[22px] font-semibold text-text" unitClassName="text-caption" />
    </>
  )
  if (!copy) return <div className={cn('min-w-0', className)}>{body}</div>
  return (
    <Tooltip content={t.overview.clickToCopy}>
      <button
        type="button"
        onClick={async () => {
          if (await copyText(copy)) toast.success(t.common.copied, { description: copy })
          else toast.error(t.common.copyFailed)
        }}
        className={cn('-m-1.5 min-w-0 rounded-[10px] p-1.5 text-left transition-colors hover:bg-hover', className)}
      >
        {body}
      </button>
    </Tooltip>
  )
}
