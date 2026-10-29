import { BatteryCharging, BatteryMedium, CellSignalHigh, ChartPieSlice, ChatCircleText, Copy, Devices, Plug, Thermometer } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'

import { extractCode, smsApi } from '@/api/sms'
import { hrefOf } from '@/app/router'
import { Button } from '@/components/ui/button'
import { Module } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { Meter, toneByThreshold } from '@/components/ui/meter'
import { toast } from '@/components/ui/toast'
import { LevelScale, SIGNAL_GRADIENT, THERMAL_GRADIENT } from '@/components/viz/level-scale'
import { Sparkline } from '@/components/viz/sparkline'
import { useTelemetryHistory } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { formatBytes, formatDuration, joinQuantity } from '@/lib/format'
import { overallQuality, positionIn, qualityOf, type Metric } from '@/lib/signal'
import type { Telemetry } from '@/model/telemetry'

import { clientsQuery } from '../hotspot/queries'
import { QUALITY_DOT, QUALITY_TEXT, Quantity, relativeTime } from './parts'
import { useUptimeMs } from './useUptime'

function ModuleSkeleton({ className }: { className?: string }) {
  return (
    <div className={cn('rounded-card bg-surface p-5 shadow-card max-sm:p-4', className)}>
      <Skeleton className="h-4 w-20" />
      <Skeleton className="mt-4 h-8 w-28" />
      <Skeleton className="mt-3 h-3.5 w-40 max-w-full" />
    </div>
  )
}

/* —— 信号：RSRP 读数 + 一句结论 + 色阶条 + SINR / RSRQ —— */

export function SignalModule({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  const history = useTelemetryHistory()
  if (!telemetry) return <ModuleSkeleton className={className} />
  const cell = telemetry.primary
  // 读数旁的质量词和下面那句结论用同一个口径（强度与干扰取更差的一项），不会出现「良好」配「一般」
  const quality = overallQuality(cell?.rsrp ?? null, cell?.sinr ?? null)
  return (
    <Module
      icon={<CellSignalHigh weight="fill" />}
      label={t.overview.signalTitle}
      aside={cell ? `${cell.tech === 'NR' ? '5G' : '4G'}${cell.band ? ` · ${cell.tech === 'NR' ? 'n' : 'B'}${cell.band}` : ''}` : undefined}
      href={hrefOf('radio')}
      className={className}
    >
      <div className="flex items-baseline gap-2">
        <Quantity value={cell?.rsrp ?? '—'} unit="dBm" className="text-metric text-text" unitClassName="text-[15px]" />
        <span className={cn('text-[15px] font-semibold', QUALITY_TEXT[quality])}>{t.signal.quality[quality]}</span>
      </div>
      {/* 按最长的那句说明占位：信号好坏一变，句子长短跟着变，这一行的高度也不会在一行、两行之间来回跳 */}
      <p className="mt-1 grid text-footnote text-text-2">
        <span aria-hidden className="invisible [grid-area:1/1]">
          {Object.values(t.overview.signalSummary).reduce((a, b) => (b.length > a.length ? b : a))}
        </span>
        <span className="[grid-area:1/1]">{t.overview.signalSummary[quality]}</span>
      </p>

      {/* 近 1 分钟的 RSRP 走势与波动幅度：调锁频 / 锁小区时一眼看出稳不稳 */}
      <RsrpTrend values={history.rsrp} />

      <div className="mt-auto pt-5">
        <LevelScale position={cell?.rsrp == null ? null : positionIn('rsrp', cell.rsrp)} gradient={SIGNAL_GRADIENT} />
        <div className="mt-1.5 flex justify-between text-caption2 font-medium text-text-4">
          <span>{t.overview.weak}</span>
          <span>{t.overview.strong}</span>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3">
          <MiniReading label="SINR" metric="sinr" value={cell?.sinr ?? null} />
          <MiniReading label="RSRQ" metric="rsrq" value={cell?.rsrq ?? null} />
        </div>
      </div>
    </Module>
  )
}

/** 采样不够 3 个时先空着同样高的位置（说明写「正在记录」），够了再画：卡片不会过几秒突然长高 */
function RsrpTrend({ values }: { values: (number | null)[] }) {
  const t = useT()
  const finite = values.filter((v): v is number => v != null)
  const ready = finite.length >= 3
  return (
    <div className="mt-4">
      {ready ? <Sparkline values={values} height={34} /> : <div className="h-[34px]" aria-hidden />}
      <p className="num mt-1.5 text-caption text-text-3">
        {ready ? t.overview.rsrpSwing(Math.max(...finite) - Math.min(...finite)) : t.overview.rsrpCollecting}
      </p>
    </div>
  )
}

function MiniReading({ label, metric, value }: { label: string; metric: Metric; value: number | null }) {
  const t = useT()
  const quality = qualityOf(metric, value)
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1.5 text-caption text-text-3">
        <span className={cn('size-1.5 rounded-full', QUALITY_DOT[quality])} aria-hidden />
        {label}
        <span className="sr-only">{t.signal.quality[quality]}</span>
      </div>
      <Quantity value={value ?? '—'} unit="dB" className="mt-0.5 text-[17px] leading-[22px] font-semibold text-text" unitClassName="text-caption" />
    </div>
  )
}

/* —— 本月流量：已用 / 上限 + 进度 + 月底预测 —— */

export function DataModule({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  if (!telemetry) return <ModuleSkeleton className={className} />
  const { used, limit, month, alertPercent } = telemetry.traffic
  const value = limit != null ? used : (month ?? used)
  const amount = formatBytes(value)
  const now = new Date()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const elapsed = now.getDate() - 1 + (now.getHours() * 60 + now.getMinutes()) / 1440
  // 月初前两天样本太少，预测不可靠，先不给
  const projected = value != null && elapsed >= 2 ? (value / elapsed) * daysInMonth : null
  const ratio = limit && value != null ? (value / limit) * 100 : null
  return (
    <Module icon={<ChartPieSlice weight="fill" />} label={t.overview.monthTraffic} className={className}>
      <Quantity value={amount.value} unit={amount.unit} className="text-metric text-text" unitClassName="text-[15px]" />
      <p className="num mt-1 text-footnote text-text-2">
        {limit && value != null ? (
          // 只在「·」处折行，不把「147 GB」拆成两行
          <>
            <span className="whitespace-nowrap">{t.overview.limitTotal(joinQuantity(formatBytes(limit)))}</span>
            {' · '}
            <span className={cn('whitespace-nowrap', value > limit && 'text-danger-text')}>
              {value <= limit
                ? t.overview.limitLeft(joinQuantity(formatBytes(limit - value)))
                : t.overview.limitOver(joinQuantity(formatBytes(value - limit)))}
            </span>
          </>
        ) : (
          t.overview.noLimitSet
        )}
      </p>
      <div className="mt-auto pt-4">
        {ratio != null && (
          <Meter value={Math.min(100, ratio)} tone={toneByThreshold(ratio, [alertPercent ?? 80, 100])} label={t.overview.monthTraffic} />
        )}
        {projected != null && <p className="num mt-2 text-caption text-text-3">{t.overview.projected(joinQuantity(formatBytes(projected)))}</p>}
      </div>
    </Module>
  )
}

/* —— 已连接设备 —— */

export function ClientsModule({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  // 和热点页同一份数据（同一个查询键）：Wi-Fi 和 USB 都算；遥测里的 wifi_access_sta_num 只数 Wi-Fi，只在列表到手前兜底
  const clients = useQuery({ ...clientsQuery, refetchInterval: 10_000 })
  if (!telemetry && !clients.data) return <ModuleSkeleton className={className} />
  const list = clients.data?.clients
  const wifi = list ? list.filter((c) => c.via === 'wifi').length : (telemetry?.wifiClients ?? 0)
  const usb = list ? list.filter((c) => c.via === 'usb').length : 0
  const count = wifi + usb
  const detail = count === 0 ? t.overview.clientsNone : usb === 0 ? t.overview.clientsVia : wifi === 0 ? t.overview.clientsUsb : t.overview.clientsMixed(wifi, usb)
  return (
    <Module icon={<Devices weight="fill" />} label={t.overview.clientsTitle} href={hrefOf('hotspot')} className={className}>
      <Quantity value={count} unit={t.overview.clientsUnit} className="text-metric text-text" unitClassName="text-[15px]" />
      <p className="mt-1 text-footnote text-text-2">{detail}</p>
    </Module>
  )
}

/* —— 最新短信：来自谁 · 多久前 · 正文两行；认出验证码时给一个「复制验证码」 —— */

/** 未读数变了就换一个 key 立刻重查（平时 30 秒一次） */
export const latestSmsQuery = (unread: number) => ({
  queryKey: ['sms', 'latest', unread] as const,
  queryFn: ({ signal }: { signal: AbortSignal }) => smsApi.list(5, signal),
  staleTime: 10_000,
})

export function SmsModule({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  const unread = telemetry?.smsUnread ?? 0
  const sms = useQuery({ ...latestSmsQuery(unread), enabled: Boolean(telemetry), refetchInterval: 30_000, retry: 1 })
  if (!telemetry || sms.isPending) return <ModuleSkeleton className={className} />
  const latest = sms.data?.find((message) => !message.outgoing)
  const code = latest ? extractCode(latest.body) : null
  return (
    <Module
      icon={<ChatCircleText weight="fill" />}
      label={t.overview.smsTitle}
      aside={
        <a href={hrefOf('messages')} className={cn('font-medium hover:underline', unread > 0 ? 'text-danger-text' : 'text-accent-text')}>
          {unread > 0 ? t.overview.unreadCount(unread) : t.common.viewAll}
        </a>
      }
      className={className}
    >
      {latest ? (
        <>
          <p className="flex items-center gap-1.5 truncate text-caption text-text-3">
            {latest.unread && <span className="size-1.5 shrink-0 rounded-full bg-accent" aria-hidden />}
            <span className="truncate">
              {latest.number} · {relativeTime(t, latest.time)}
            </span>
          </p>
          <p className="mt-1 line-clamp-2 text-subhead text-text">{latest.body}</p>
          {code && (
            <Button
              variant="soft"
              size="sm"
              icon={<Copy weight="bold" />}
              className="num mt-auto self-start max-sm:mt-3"
              onClick={async () => {
                if (await copyText(code)) toast.success(t.overview.codeCopied(code))
                else toast.error(t.common.copyFailed)
              }}
            >
              {t.overview.copyCode(code)}
            </Button>
          )}
        </>
      ) : (
        <p className="text-footnote text-text-3">{t.overview.smsEmpty}</p>
      )}
    </Module>
  )
}

/* —— 机身温度：读数 + 一句状态 + 色阶条 —— */

export function ThermalModule({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  if (!telemetry) return <ModuleSkeleton className={className} />
  const celsius = telemetry.thermal.maxC
  const state = celsius == null ? null : celsius < 45 ? 'normal' : celsius < 55 ? 'warm' : celsius < 65 ? 'hot' : 'critical'
  return (
    <Module icon={<Thermometer weight="fill" />} label={t.overview.thermalTitle} className={className}>
      <Quantity value={celsius == null ? '—' : celsius.toFixed(1)} unit="°C" className="text-metric text-text" unitClassName="text-[15px]" />
      <p className={cn('mt-1 text-footnote', state === 'hot' || state === 'critical' ? 'text-danger-text' : state === 'warm' ? 'text-warning-text' : 'text-text-2')}>
        {state ? t.overview.thermal[state] : '—'}
      </p>
      <div className="mt-auto pt-5">
        <LevelScale position={celsius == null ? null : (celsius - 20) / 60} gradient={THERMAL_GRADIENT} />
        <div className="num mt-1.5 flex justify-between text-caption2 font-medium text-text-4">
          <span>20°</span>
          <span>80°</span>
        </div>
      </div>
    </Module>
  )
}

/* —— 供电与负载：供电方式 + 运行时长 + CPU / 内存两条细条 —— */

export function PowerModule({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  const uptimeMs = useUptimeMs(telemetry)
  if (!telemetry) return <ModuleSkeleton className={className} />
  const { battery, cpu, memory } = telemetry
  const Icon = battery ? (battery.charging ? BatteryCharging : BatteryMedium) : Plug
  return (
    <Module icon={<Icon weight="fill" />} label={t.overview.powerTitle} className={className}>
      <p className="text-[17px] leading-[22px] font-semibold text-text">
        {battery?.percent != null ? t.overview.battery(battery.percent) : t.overview.usbPower}
        {battery?.charging && <span className="ml-1.5 text-footnote font-medium text-success-text">{t.overview.charging}</span>}
      </p>
      {uptimeMs != null && (
        <p className="mt-1 text-footnote text-text-2">
          {t.overview.uptime} {formatDuration(uptimeMs / 1000, t.units)}
        </p>
      )}
      <div className="mt-auto flex flex-col gap-2.5 pt-5">
        <LoadRow label={t.overview.cpu} value={cpu.usage} />
        <LoadRow label={t.overview.memory} value={memory.usage} />
      </div>
    </Module>
  )
}

function LoadRow({ label, value }: { label: string; value: number | null }) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-9 shrink-0 text-caption text-text-3">{label}</span>
      <Meter value={value} tone={toneByThreshold(value, [75, 90])} size="sm" label={label} className="flex-1" />
      <span className="num w-10 shrink-0 text-right text-caption font-medium text-text-2">{value == null ? '—' : `${Math.round(value)}%`}</span>
    </div>
  )
}
