import { keepPreviousData, useQuery } from '@tanstack/react-query'

import { authStatusStore } from '@/api/auth'
import { fetchQos, fetchTelemetry } from '@/api/device'
import type { SpeedSample } from '@/components/viz/speed-chart'
import { createStore, useStore } from '@/lib/store'
import type { Telemetry } from '@/model/telemetry'

/** 轮询间隔：与原版默认一致，每秒一次；标签页切到后台时 React Query 自动暂停 */
export const REFRESH_MS = 1_000

export interface TelemetryHistory {
  speed: SpeedSample[]
  rsrp: (number | null)[]
  sinr: (number | null)[]
}

/**
 * 历史读数放在全局环形缓冲里（而不是组件状态）：
 * 切到别的页面再回来，速率曲线和信号趋势不会从零开始。
 */
export const historyStore = createStore<TelemetryHistory>({ speed: [], rsrp: [], sinr: [] })

function record(telemetry: Telemetry): Telemetry {
  historyStore.set((prev) => ({
    speed: [...prev.speed, { t: telemetry.at, down: telemetry.rxRate, up: telemetry.txRate }].slice(-150),
    rsrp: [...prev.rsrp, telemetry.primary?.rsrp ?? null].slice(-60),
    sinr: [...prev.sinr, telemetry.primary?.sinr ?? null].slice(-60),
  }))
  return telemetry
}

export function useTelemetry() {
  const status = useStore(authStatusStore)
  return useQuery<Telemetry>({
    queryKey: ['telemetry'],
    queryFn: ({ signal }) => fetchTelemetry(signal).then(record),
    enabled: status === 'signed-in',
    refetchInterval: REFRESH_MS,
    refetchIntervalInBackground: false,
    retry: false,
    staleTime: 0,
    // 断网或一次请求失败时保留上一次的读数，界面不清空、不闪
    placeholderData: keepPreviousData,
  })
}

export const useTelemetryHistory = () => useStore(historyStore)

/** QCI 与签约速率：每 10 秒查一次；换小区 / 换制式时立即重查 */
export function useQos(telemetry: Telemetry | undefined) {
  return useQuery({
    queryKey: ['qos', telemetry?.mode, telemetry?.primary?.pci, telemetry?.sim.slot],
    queryFn: () => fetchQos(telemetry!),
    enabled: Boolean(telemetry) && telemetry!.mode !== 'NONE' && telemetry!.dataState === 'connected',
    refetchInterval: 10_000,
    staleTime: 10_000,
    retry: false,
  })
}
