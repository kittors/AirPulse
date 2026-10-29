import { useEffect, useRef, useState } from 'react'

import { request } from '@/api/client'
import { errorMessage } from '@/lib/errors'
import { storage } from '@/lib/storage'

/**
 * 测速（只测下行）：
 * - 局域网：设备发、浏览器收（GET /api/speedtest，256 × 8 MiB = 2 GiB，USB 3.0 也能跑满 10 秒），不消耗流量；
 * - 蜂窝网络：经设备代理下载公网文件（/api/proxy/--<URL>），后端单次最长 30 秒，这里取 20 秒。
 * 计时从收到第一个字节开始；每 250 ms 采样一次，显示值是最近 4 个样本的平均，单位统一 Mbps（bit / 1e6）。
 */

export type SpeedMode = 'lan' | 'cellular'
export type SpeedPhase = 'idle' | 'connecting' | 'running' | 'done' | 'error'

export interface SpeedSample {
  t: number
  mbps: number
}

export interface SpeedState {
  phase: SpeedPhase
  mode: SpeedMode
  samples: SpeedSample[]
  current: number | null
  average: number | null
  peak: number | null
  bytes: number
  seconds: number
  error: string | null
  /** 用户中途停止 */
  stopped: boolean
}

export interface SpeedRecord {
  at: number
  mode: SpeedMode
  average: number
  peak: number
  bytes: number
  seconds: number
  server?: string
}

export const LIMIT_SECONDS: Record<SpeedMode, number> = { lan: 10, cellular: 20 }
const SAMPLE_MS = 250
const HISTORY_KEY = 'speed-history'

const IDLE: SpeedState = { phase: 'idle', mode: 'lan', samples: [], current: null, average: null, peak: null, bytes: 0, seconds: 0, error: null, stopped: false }

export const loadHistory = () => storage.get<SpeedRecord[]>(HISTORY_KEY, [])
export const saveHistory = (records: SpeedRecord[]) => storage.set(HISTORY_KEY, records.slice(0, 10))

/** 目标地址带查询串时用 & 拼防缓存参数（原版直接拼 ?t=，会把随机数拼进最后一个参数里） */
export function proxyPath(url: string): string {
  const bust = `_ap=${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
  return `/proxy/--${url}${url.includes('?') ? '&' : '?'}${bust}`
}

export function useSpeedTest(onRecord: (record: SpeedRecord) => void) {
  const [state, setState] = useState<SpeedState>(IDLE)
  const stopRef = useRef<(() => void) | null>(null)
  const recordRef = useRef(onRecord)
  recordRef.current = onRecord

  // 离开页面就停，不在后台继续吃流量
  useEffect(() => () => stopRef.current?.(), [])

  const start = async (mode: SpeedMode, options: { url?: string; threads?: number } = {}) => {
    stopRef.current?.()
    const controller = new AbortController()
    const readers = new Set<ReadableStreamDefaultReader<Uint8Array>>()
    let stopped = false
    let capped = false
    const cancelAll = () => {
      controller.abort()
      readers.forEach((reader) => void reader.cancel().catch(() => undefined))
    }
    stopRef.current = () => {
      stopped = true
      cancelAll()
    }

    setState({ ...IDLE, mode, phase: 'connecting' })
    const limitMs = LIMIT_SECONDS[mode] * 1000
    let total = 0
    let firstByteAt = 0
    let lastAt = 0
    let lastBytes = 0
    let peak = 0
    const recent: number[] = []
    const samples: SpeedSample[] = []

    const tick = () => {
      if (!firstByteAt) return
      const now = performance.now()
      const dt = (now - lastAt) / 1000
      if (dt <= 0) return
      const mbps = ((total - lastBytes) * 8) / 1e6 / dt
      lastAt = now
      lastBytes = total
      recent.push(mbps)
      if (recent.length > 4) recent.shift()
      const smooth = recent.reduce((sum, v) => sum + v, 0) / recent.length
      peak = Math.max(peak, smooth)
      samples.push({ t: (now - firstByteAt) / 1000, mbps: smooth })
      setState((s) => ({ ...s, phase: 'running', samples: [...samples], current: smooth, peak, bytes: total, seconds: (now - firstByteAt) / 1000 }))
      if (now - firstByteAt >= limitMs) {
        capped = true
        cancelAll()
      }
    }
    const timer = window.setInterval(tick, SAMPLE_MS)

    const paths =
      mode === 'lan'
        ? ['/speedtest?ckSize=256']
        : Array.from({ length: Math.max(1, options.threads ?? 1) }, () => proxyPath(options.url ?? ''))

    let lastByteAt = 0
    const results = await Promise.allSettled(
      paths.map(async (path) => {
        const res = await request(path, { signal: controller.signal, timeout: 15_000 })
        if (!res.body) throw new Error('no body')
        const reader = res.body.getReader()
        readers.add(reader)
        try {
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            const now = performance.now()
            if (!firstByteAt) {
              firstByteAt = now
              lastAt = now
            }
            total += value.byteLength
            lastByteAt = now
          }
        } catch (error) {
          // 主动取消（到时 / 停止）或中途断流：已收到的数据照样算
          if (!total) throw error
        } finally {
          readers.delete(reader)
        }
      }),
    )
    window.clearInterval(timer)
    stopRef.current = null

    if (!total) {
      if (stopped) return setState({ ...IDLE, mode })
      const failure = results.find((r): r is PromiseRejectedResult => r.status === 'rejected')
      return setState({ ...IDLE, mode, phase: 'error', error: failure ? errorMessage(failure.reason) : null })
    }

    const end = capped ? firstByteAt + limitMs : lastByteAt || performance.now()
    const seconds = Math.max(0.001, (end - firstByteAt) / 1000)
    const average = (total * 8) / 1e6 / seconds
    const finalPeak = Math.max(peak, samples.length ? 0 : average)
    setState((s) => ({ ...s, phase: 'done', current: average, average, peak: finalPeak, bytes: total, seconds, stopped, samples: [...samples] }))
    if (seconds >= 2) recordRef.current({ at: Date.now(), mode, average, peak: finalPeak, bytes: total, seconds, server: options.url })
  }

  return { state, start, stop: () => stopRef.current?.() }
}
