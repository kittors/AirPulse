import { useQuery } from '@tanstack/react-query'

import { radioApi } from '@/api/radio'

export const radioKeys = {
  netSelect: ['radio', 'net-select'] as const,
  bandLock: ['radio', 'band-lock'] as const,
  nrBands: ['radio', 'nr-bands'] as const,
  cells: ['radio', 'cells'] as const,
}

/* 查询选项单独导出：页面预读（preload）和组件里的 useQuery 用同一份 */
export const netSelectQuery = { queryKey: radioKeys.netSelect, queryFn: radioApi.netSelect }
export const bandLockQuery = { queryKey: radioKeys.bandLock, queryFn: radioApi.bandLock }
/** 支持的 5G 频段：后端进程内缓存，前端也只查一次；取不到时由界面回退到默认列表 */
export const nrBandsQuery = { queryKey: radioKeys.nrBands, queryFn: () => radioApi.supportedNrBands(0), staleTime: Infinity, retry: false }
export const cellsQuery = { queryKey: radioKeys.cells, queryFn: ({ signal }: { signal: AbortSignal }) => radioApi.cells(signal), staleTime: 0 }

export const useNetSelect = () => useQuery(netSelectQuery)

export const useBandLock = () => useQuery(bandLockQuery)

export const useNrBands = () => useQuery(nrBandsQuery)

/** 邻区与已锁小区：区块可见时每 2.5 秒刷新（与原版默认一致），可暂停 */
export const useCells = (live: boolean) => useQuery({ ...cellsQuery, refetchInterval: live ? 2_500 : false, refetchIntervalInBackground: false })
