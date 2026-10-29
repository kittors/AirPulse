import type { RawCellInfo, RawLockedCell, RawNeighborCell } from '@/api/types'
import { earfcnToMHz, techOfEarfcn, techOfRat } from '@/lib/bands'

import { num, parseBands, type Tech } from './telemetry'

export interface NeighborCell {
  key: string
  /** 由频点推断：原版邻区数据不带制式，锁定时据此自动带上正确的 rat */
  tech: Tech
  band: number | null
  earfcn: number
  pci: number
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  freqMHz: number | null
}

export interface LockedCell {
  key: string
  tech: Tech
  earfcn: number
  pci: number
}

export const cellKey = (pci: number, earfcn: number) => `${earfcn}:${pci}`

function neighbor(raw: RawNeighborCell): NeighborCell | null {
  const pci = num(raw.pci)
  const earfcn = num(raw.earfcn)
  if (pci == null || earfcn == null) return null
  return {
    key: cellKey(pci, earfcn),
    tech: techOfEarfcn(earfcn),
    band: parseBands(raw.band)[0] ?? null,
    earfcn,
    pci,
    rsrp: num(raw.rsrp),
    rsrq: num(raw.rsrq),
    sinr: num(raw.sinr),
    freqMHz: earfcnToMHz(earfcn),
  }
}

function locked(raw: RawLockedCell): LockedCell | null {
  const pci = num(raw.pci)
  const earfcn = num(raw.earfcn)
  if (pci == null || earfcn == null) return null
  return { key: cellKey(pci, earfcn), tech: techOfRat(raw.rat), earfcn, pci }
}

/**
 * 邻区与已锁小区。设备偶尔把字段返回成空字符串（不是空数组），
 * 原版这时保留上一次的表格不刷新——这里返回 null，由调用方沿用旧值。
 */
export function parseCells(raw: RawCellInfo): { neighbors: NeighborCell[] | null; locked: LockedCell[] | null } {
  const neighbors = Array.isArray(raw.neighbor_cell_info)
    ? raw.neighbor_cell_info
        .map(neighbor)
        .filter((cell): cell is NeighborCell => cell !== null)
        .sort((a, b) => (b.rsrp ?? -999) - (a.rsrp ?? -999))
    : null
  const lockedCells = Array.isArray(raw.locked_cell_info)
    ? raw.locked_cell_info.map(locked).filter((cell): cell is LockedCell => cell !== null)
    : null
  return { neighbors, locked: lockedCells }
}
