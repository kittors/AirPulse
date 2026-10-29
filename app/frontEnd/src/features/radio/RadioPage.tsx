import type { QueryClient } from '@tanstack/react-query'

import { PageHeader } from '@/components/ui/card'
import { bandLockQuery, cellsQuery, netSelectQuery, nrBandsQuery } from '@/hooks/useRadio'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { bandLabel } from '@/lib/bands'
import { overallQuality } from '@/lib/signal'

import { QUALITY_TEXT } from '../overview/parts'
import { BandLock } from './BandLock'
import { CellList } from './CellList'
import { ModeList } from './ModeList'

/** 首屏数据：切页前预读（见 AppShell） */
export const preload = (client: QueryClient) =>
  Promise.all([
    client.prefetchQuery(netSelectQuery),
    client.prefetchQuery(bandLockQuery),
    client.prefetchQuery(nrBandsQuery),
    client.prefetchQuery(cellsQuery),
  ])

/**
 * 射频：由粗到细——选网模式（制式）→ 频段锁（频段）→ 周边小区（小区）。
 * 副标题一句话说清当前驻留在哪、信号怎么样，改完设置立刻能看到变化。
 */
export default function RadioPage() {
  const t = useT()
  const { data: telemetry } = useTelemetry()
  const cell = telemetry?.primary
  const quality = overallQuality(cell?.rsrp ?? null, cell?.sinr ?? null)
  return (
    <>
      <PageHeader
        title={t.radio.title}
        subtitle={
          telemetry && cell ? (
            <span className="num">
              {t.network.modes[telemetry.mode]}
              {cell.band ? ` · ${bandLabel(cell.tech, cell.band)}` : ''}
              {cell.pci != null ? ` · PCI ${cell.pci}` : ''}
              {' · '}
              <span className={QUALITY_TEXT[quality]}>{t.signal.quality[quality]}</span>
            </span>
          ) : (
            t.radio.subtitle
          )
        }
      />
      <div className="@container">
        <div className="grid grid-cols-1 gap-4 max-sm:gap-3 @4xl:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] @4xl:items-start">
          <ModeList />
          <BandLock className="@4xl:mt-[26px]" />
          <CellList className="@4xl:col-span-2" />
        </div>
      </div>
    </>
  )
}
