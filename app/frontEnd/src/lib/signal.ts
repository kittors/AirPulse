import type { Tone } from './tone'

/**
 * 信号质量四档（极佳 / 良好 / 一般 / 微弱）。
 *
 * 「良好 / 一般 / 微弱」三条边界与原版 kano_parseSignalBar 完全一致（用户已经习惯这套绿橙红），
 * 只在原版绿区内部再分出「极佳」一档。颜色仍是三档状态色：极佳与良好同为绿，
 * 靠信号格数（4 / 3）和文字区分——颜色从不单独承担含义。
 */
export type Quality = 'excellent' | 'good' | 'fair' | 'poor' | 'none'
export type Metric = 'rsrp' | 'sinr' | 'rsrq'

/** [极佳下限, 良好下限, 一般下限]，越大越好 */
export const THRESHOLDS: Record<Metric, readonly [number, number, number]> = {
  rsrp: [-80, -90, -100],
  sinr: [20, 13, 0],
  rsrq: [-6, -9, -12],
}

/** 条形读数的显示量程（与原版信号条的 min / max 接近，RSRP 上限放宽到 -70） */
export const RANGES: Record<Metric, readonly [number, number]> = {
  rsrp: [-125, -70],
  sinr: [-10, 30],
  rsrq: [-20, -3],
}

export const UNITS: Record<Metric, string> = { rsrp: 'dBm', sinr: 'dB', rsrq: 'dB' }

export function qualityOf(metric: Metric, value: number | null | undefined): Quality {
  if (value == null || !Number.isFinite(value)) return 'none'
  const [excellent, good, fair] = THRESHOLDS[metric]
  if (value >= excellent) return 'excellent'
  if (value >= good) return 'good'
  if (value >= fair) return 'fair'
  return 'poor'
}

const RANK: Record<Quality, number> = { none: 0, poor: 1, fair: 2, good: 3, excellent: 4 }

export const qualityBars = (quality: Quality) => RANK[quality]

/** 综合质量：取强度（RSRP）与质量（SINR）里更差的那个——信号再强、干扰大也上不了速 */
export function overallQuality(rsrp: number | null, sinr: number | null): Quality {
  const a = qualityOf('rsrp', rsrp)
  const b = qualityOf('sinr', sinr)
  if (a === 'none') return b
  if (b === 'none') return a
  return RANK[a] <= RANK[b] ? a : b
}

export const QUALITY_TONE: Record<Quality, Tone> = {
  excellent: 'success',
  good: 'success',
  fair: 'warning',
  poor: 'danger',
  none: 'neutral',
}

/** 量程内的位置 0–1（条形读数用） */
export function positionIn(metric: Metric, value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0
  const [min, max] = RANGES[metric]
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}
