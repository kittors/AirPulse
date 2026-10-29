import type { QueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/ui/card'
import { netSelectQuery } from '@/hooks/useRadio'
import { useTelemetry, useTelemetryHistory } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { formatDuration } from '@/lib/format'
import { overallQuality } from '@/lib/signal'
import { cn } from '@/lib/cn'
import type { Telemetry } from '@/model/telemetry'

import { CellPanel } from './CellPanel'
import { DeviceDetails } from './DeviceDetails'
import { clientsQuery, wifiQuery } from '../hotspot/queries'
import { apnQuery } from '../settings/ipv6'
import { switchesQuery } from '../settings/switches'
import { ClientsModule, DataModule, latestSmsQuery, PowerModule, SignalModule, SmsModule, ThermalModule } from './modules'
import { carrierName, QUALITY_DOT } from './parts'
import { QuickControls } from './QuickControls'
import { SpeedPanel } from './SpeedPanel'

/**
 * 总览：先回答用户最关心的几件事——网好不好、多快、流量用了多少、有没有新短信、机器热不热；
 * 常切的开关（移动数据、Wi-Fi、性能模式、IPv6、网络模式）紧跟在网速和信号下面。
 * 标题就是运营商，副标题是「制式 · 频段 · 联网时长」；
 * 网格按容器宽度排：宽屏四列（网速占三列 + 信号一列 / 四个模块 / 小区三列 + 供电一列），窄屏两列，手机上小模块两两并排。
 */
/** 首屏数据：切页前预读（见 AppShell）；遥测本身一直在轮询 */
export function preload(client: QueryClient) {
  const unread = client.getQueryData<Telemetry>(['telemetry'])?.smsUnread ?? 0
  return Promise.all([
    client.prefetchQuery(clientsQuery),
    client.prefetchQuery(latestSmsQuery(unread)),
    // 快捷开关
    client.prefetchQuery(switchesQuery),
    client.prefetchQuery(wifiQuery),
    client.prefetchQuery(apnQuery),
    client.prefetchQuery(netSelectQuery),
  ])
}

export default function OverviewPage() {
  const { data } = useTelemetry()
  const history = useTelemetryHistory()
  return (
    <>
      <Header telemetry={data} />
      <div className="@container">
        <div className="grid grid-flow-row-dense grid-cols-2 gap-4 max-sm:gap-3 @4xl:grid-cols-4">
          <SpeedPanel telemetry={data} history={history.speed} className="col-span-2 @4xl:col-span-3" />
          <SignalModule telemetry={data} className="col-span-2 @4xl:col-span-1" />
          <QuickControls className="col-span-2 @4xl:col-span-4" />
          <DataModule telemetry={data} className="col-span-1" />
          <ClientsModule telemetry={data} className="col-span-1" />
          <SmsModule telemetry={data} className="col-span-2 @3xl:col-span-1" />
          <ThermalModule telemetry={data} className="col-span-1" />
          <CellPanel telemetry={data} className="col-span-2 @4xl:col-span-3" />
          <PowerModule telemetry={data} className="col-span-1 @3xl:col-span-2 @4xl:col-span-1" />
          <DeviceDetails telemetry={data} className="col-span-2 @4xl:col-span-4" />
        </div>
      </div>
    </>
  )
}

function Header({ telemetry }: { telemetry: Telemetry | undefined }) {
  const t = useT()
  if (!telemetry) return <PageHeader title={null} subtitle={null} />
  const quality = overallQuality(telemetry.primary?.rsrp ?? null, telemetry.primary?.sinr ?? null)
  const connected = telemetry.dataState === 'connected'
  const band = telemetry.primary?.band ? `${telemetry.primary.tech === 'NR' ? 'n' : 'B'}${telemetry.primary.band}` : null
  const parts = [
    telemetry.mode === 'NONE' ? null : t.network.modes[telemetry.mode],
    band,
    connected
      ? telemetry.connectedSeconds != null
        ? t.overview.connectedFor(formatDuration(telemetry.connectedSeconds, t.units))
        : t.network.data.connected
      : t.network.data[telemetry.dataState],
  ].filter(Boolean)
  return (
    <PageHeader
      title={telemetry.mode === 'NONE' && !telemetry.provider ? t.overview.noSim : carrierName(t, telemetry)}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span
            className={cn('ap-live-dot size-2', connected ? QUALITY_DOT[quality] : 'bg-text-4')}
            data-breathing={connected || undefined}
            aria-hidden
          />
          {parts.map((part, index) => (
            <span key={index} className="flex items-center gap-2">
              {index > 0 && <span className="text-text-4">·</span>}
              {part}
            </span>
          ))}
        </span>
      }
    />
  )
}
