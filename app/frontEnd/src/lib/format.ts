/**
 * 数值格式化：返回「数」与「单位」两段，界面把单位小一号、颜色退一档。
 * 流量用 1024 进制（与运营商计费、设备官方后台一致）；速率用 1000 进制的 bit/s。
 */
export interface Quantity {
  value: string
  unit: string
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB']
const BIT_UNITS = ['bps', 'Kbps', 'Mbps', 'Gbps']

/** 有效数字控制：≥100 不带小数，≥10 一位，<10 两位，保证宽度稳定 */
function significant(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const abs = Math.abs(value)
  if (abs >= 100) return value.toFixed(0)
  if (abs >= 10) return value.toFixed(1)
  return value.toFixed(2)
}

export function formatBytes(bytes: number | null | undefined): Quantity {
  if (bytes == null || !Number.isFinite(bytes)) return { value: '—', unit: '' }
  let value = Math.max(0, bytes)
  let index = 0
  while (value >= 1024 && index < BYTE_UNITS.length - 1) {
    value /= 1024
    index += 1
  }
  return { value: index === 0 ? value.toFixed(0) : significant(value), unit: BYTE_UNITS[index] }
}

/** 字节/秒 → bit/s 文案 */
export function formatRate(bytesPerSecond: number | null | undefined): Quantity {
  if (bytesPerSecond == null || !Number.isFinite(bytesPerSecond)) return { value: '—', unit: '' }
  let value = Math.max(0, bytesPerSecond) * 8
  let index = 0
  while (value >= 1000 && index < BIT_UNITS.length - 1) {
    value /= 1000
    index += 1
  }
  return { value: index === 0 ? value.toFixed(0) : significant(value), unit: BIT_UNITS[index] }
}

export function joinQuantity(q: Quantity): string {
  return q.unit ? `${q.value} ${q.unit}` : q.value
}

/** 运行时长：最多两段，例如「3 天 4 小时」「12 分钟 5 秒」 */
export function formatDuration(
  seconds: number | null | undefined,
  units: { days: string; hours: string; minutes: string; seconds: string },
): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—'
  const s = Math.floor(seconds)
  const parts: [number, string][] = [
    [Math.floor(s / 86400), units.days],
    [Math.floor((s % 86400) / 3600), units.hours],
    [Math.floor((s % 3600) / 60), units.minutes],
    [s % 60, units.seconds],
  ]
  const first = parts.findIndex(([n]) => n > 0)
  if (first === -1) return `0 ${units.seconds}`
  return parts
    .slice(first, first + 2)
    .filter(([n], i) => i === 0 || n > 0)
    .map(([n, unit]) => `${n} ${unit}`)
    .join(' ')
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return '—'
  return value.toFixed(digits)
}

/** 解析设备返回的数字字段（常是字符串，可能为空串） */
export function toNumber(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = typeof value === 'number' ? value : Number(String(value).trim())
  return Number.isFinite(n) ? n : null
}

/** 取一个「好看的」刻度上限：1、2、5 × 10ⁿ */
export function niceCeil(value: number): number {
  if (!(value > 0)) return 1
  const exponent = Math.floor(Math.log10(value))
  const base = 10 ** exponent
  const fraction = value / base
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10
  return nice * base
}
