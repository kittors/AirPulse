import { CaretRight } from '@phosphor-icons/react'

import { hrefOf } from '@/app/router'
import { Panel, PanelHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { useT } from '@/i18n'
import { bandLabel, earfcnToMHz, LTE_BANDS, NR_BANDS } from '@/lib/bands'
import { cn } from '@/lib/cn'
import type { ServingCell, Telemetry } from '@/model/telemetry'

import { Readout } from './parts'

/**
 * 当前小区：频段、频率、带宽、PCI、频点、小区 ID 一行排开；NSA 时 4G 锚点与 5G 辅载波各一行。
 * 标题旁一句频段资料（双工 · 频率范围 · 运营商），右上角就近跳到「射频」去锁频 / 锁小区。
 */
export function CellPanel({ telemetry, className }: { telemetry: Telemetry | undefined; className?: string }) {
  const t = useT()
  const cells = telemetry ? ([telemetry.lte && telemetry.mode !== 'SA' ? telemetry.lte : null, telemetry.nr].filter(Boolean) as ServingCell[]) : []
  const primary = telemetry?.primary
  const info = primary?.band ? (primary.tech === 'NR' ? NR_BANDS : LTE_BANDS)[primary.band] : undefined
  return (
    <Panel className={cn('@container', className)}>
      <PanelHeader
        title={t.overview.cellTitle}
        detail={
          info && primary?.band
            ? `${bandLabel(primary.tech, primary.band)} · ${info.duplex} ${info.range} MHz${info.carriers.length ? ` · ${info.carriers.map((code) => t.network.carriers[code]).join(' / ')}` : ''}`
            : undefined
        }
        action={
          <a href={hrefOf('radio')} className="group flex items-center gap-0.5 text-footnote font-medium text-accent-text">
            {t.overview.goRadio}
            <CaretRight className="size-3 transition-transform duration-200 group-hover:translate-x-0.5" weight="bold" />
          </a>
        }
      />
      {!telemetry ? (
        <Skeleton className="h-12 w-full" />
      ) : cells.length === 0 ? (
        <p className="text-footnote text-text-3">{t.overview.noService}</p>
      ) : (
        <div className="flex flex-col gap-5">
          {cells.map((cell) => (
            <CellRow key={cell.tech} cell={cell} label={cells.length > 1 ? (cell.tech === 'LTE' ? t.overview.anchor : t.overview.secondary) : null} />
          ))}
        </div>
      )}
    </Panel>
  )
}

function CellRow({ cell, label }: { cell: ServingCell; label: string | null }) {
  const t = useT()
  const freq = cell.earfcn != null ? earfcnToMHz(cell.earfcn) : null
  const items = [
    { key: 'band', label: t.overview.band, value: cell.band ? bandLabel(cell.tech, cell.band) : null },
    { key: 'freq', label: t.overview.frequency, value: freq != null ? freq.toFixed(freq >= 1000 ? 1 : 2) : null, unit: 'MHz' },
    { key: 'bw', label: t.overview.bandwidth, value: cell.bandwidthMHz, unit: 'MHz' },
    { key: 'pci', label: t.overview.pci, value: cell.pci, copy: true },
    { key: 'earfcn', label: t.overview.earfcn, value: cell.earfcn, copy: true },
    { key: 'cell', label: t.overview.cellId, value: cell.cellId, copy: true },
  ]
  return (
    <div>
      {label && <p className="mb-2.5 text-caption font-medium text-text-2">{label}</p>}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-5 @md:grid-cols-3">
        {items.map((item) => (
          <div key={item.key} className="min-w-0">
            <Readout
              label={item.label}
              value={item.value ?? '—'}
              unit={item.value != null ? item.unit : undefined}
              copy={item.copy && item.value != null ? String(item.value) : null}
            />
          </div>
        ))}
      </dl>
    </div>
  )
}
