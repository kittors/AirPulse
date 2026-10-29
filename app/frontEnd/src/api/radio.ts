import { RAT_CODE, supportedNrBandList } from '@/lib/bands'
import { parseCells, type LockedCell, type NeighborCell } from '@/model/cells'

import { api } from './client'
import { deviceApi } from './device'
import { goformGet, goformSet } from './goform'
import type { BearerPreference, RawBandLock, RawCellInfo } from './types'

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

export const BEARER_PREFERENCES: BearerPreference[] = [
  'WL_AND_5G',
  'LTE_AND_5G',
  'Only_5G',
  'WCDMA_AND_LTE',
  'Only_LTE',
  'Only_WCDMA',
]

/** 切换后可能掉网、需要先确认的模式 */
export const RISKY_PREFERENCES = new Set<BearerPreference>(['Only_5G', 'Only_LTE', 'Only_WCDMA'])

export function parseBandList(value: string | undefined): number[] {
  return (value ?? '')
    .split(',')
    .map((part) => Number.parseInt(part.trim().replace(/^[bn]/i, ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

/**
 * 重启协议栈：与原版锁频后的动作一致——两个卡槽先 AT+SFUN=5（关）再 AT+SFUN=4（开），间隔 100 ms。
 * 单卡机型对卡槽 1 可能返回 ERROR，不影响结果，忽略即可。期间会断网几秒。
 */
export async function restartNetworkStack() {
  for (const [command, slot] of [
    ['AT+SFUN=5', 0],
    ['AT+SFUN=5', 1],
    ['AT+SFUN=4', 0],
    ['AT+SFUN=4', 1],
  ] as const) {
    await deviceApi.at(command, slot).catch(() => undefined)
    await sleep(100)
  }
}

let lastNeighbors: NeighborCell[] = []
let lastLocked: LockedCell[] = []

export const radioApi = {
  async netSelect(): Promise<BearerPreference | null> {
    const res = await goformGet<{ net_select?: string }>('net_select')
    const value = res.net_select as BearerPreference | undefined
    return value && BEARER_PREFERENCES.includes(value) ? value : null
  },

  setNetSelect: (value: BearerPreference) => goformSet('SET_BEARER_PREFERENCE', { BearerPreference: value }),

  async bandLock(): Promise<{ lte: number[]; nr: number[] }> {
    const res = await goformGet<RawBandLock>(['lte_band_lock', 'nr_band_lock'])
    return { lte: parseBandList(res.lte_band_lock), nr: parseBandList(res.nr_band_lock) }
  },

  /** 基带支持的 5G 频段（后端进程内缓存，不区分卡槽） */
  async supportedNrBands(slot = 0): Promise<number[] | null> {
    const res = await api<{ band_list?: unknown[] }>('/getSupportNrBandList', { query: { slot }, timeout: 10_000 })
    return supportedNrBandList(res.band_list)
  },

  /**
   * 提交频段锁并重启协议栈。两个写操作任一成功就重启（与原版判定一致），两个都失败才报错；
   * 返回哪一项失败了，界面据此提示「部分生效」。
   */
  async applyBandLock(lte: number[], nr: number[]) {
    const [lteResult, nrResult] = await Promise.allSettled([
      goformSet('LTE_BAND_LOCK', { lte_band_lock: lte.join(',') }),
      goformSet('NR_BAND_LOCK', { nr_band_lock: nr.join(',') }),
    ])
    if (lteResult.status === 'rejected' && nrResult.status === 'rejected') throw lteResult.reason
    await restartNetworkStack()
    return { lteOk: lteResult.status === 'fulfilled', nrOk: nrResult.status === 'fulfilled' }
  },

  async cells(signal?: AbortSignal): Promise<{ neighbors: NeighborCell[]; locked: LockedCell[] }> {
    const raw = await goformGet<RawCellInfo>(['neighbor_cell_info', 'locked_cell_info'], { signal })
    const parsed = parseCells(raw)
    if (parsed.neighbors) lastNeighbors = parsed.neighbors
    if (parsed.locked) lastLocked = parsed.locked
    return { neighbors: lastNeighbors, locked: lastLocked }
  },

  lockCell: (cell: { pci: number; earfcn: number; tech: 'NR' | 'LTE' }) =>
    goformSet('CELL_LOCK', { pci: cell.pci, earfcn: cell.earfcn, rat: RAT_CODE[cell.tech] }),

  unlockAllCells: () => goformSet('UNLOCK_ALL_CELL'),
}
