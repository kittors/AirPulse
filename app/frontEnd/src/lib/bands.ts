/**
 * 频段资料：双工方式、下行频率范围、国内运营商（用代码，由 i18n 翻译）。
 * 运营商只标国内常用频段；其余频段只给制式与频率，避免把不确定的信息写成事实。
 */
export type Carrier = 'cmcc' | 'cucc' | 'ctcc' | 'cbn'
export type Duplex = 'FDD' | 'TDD' | 'SDL' | 'SUL'

export interface BandInfo {
  duplex: Duplex
  /** 下行频率（MHz），TDD 为工作频段 */
  range: string
  carriers: Carrier[]
}

/** 原版锁频表里的 9 个 4G 频段 */
export const LTE_LOCKABLE_BANDS = [1, 3, 5, 8, 34, 38, 39, 40, 41] as const

/** 设备接口取不到 5G 支持列表时的回退（与原版一致） */
export const NR_FALLBACK_BANDS = [1, 5, 8, 28, 41, 78] as const

/** 3GPP 定义过的 5G NR 工作频段（38.101-1 FR1 + 38.101-2 FR2）。NR 没有 n4、n6 这类编号 */
const NR_DEFINED_BANDS: ReadonlySet<number> = new Set([
  1, 2, 3, 5, 7, 8, 12, 13, 14, 18, 20, 24, 25, 26, 28, 29, 30, 31, 34, 38, 39, 40, 41, 46, 47, 48, 50, 51, 53, 54, 65, 66, 67, 70,
  71, 72, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 104, 105, 106,
  109, 257, 258, 259, 260, 261, 262, 263,
])

/**
 * 基带报上来的 5G 支持列表 → 去重、排序后的频段号。F50 实测会多报一个不存在的「6」，
 * 不认识的编号直接丢掉，免得界面上出现锁不了的芯片。一个都不剩时返回 null（界面用回退表）。
 */
export function supportedNrBandList(raw: readonly unknown[] | undefined): number[] | null {
  const list = [...new Set((raw ?? []).map(Number).filter((n) => Number.isInteger(n) && NR_DEFINED_BANDS.has(n)))]
  return list.length ? list.sort((a, b) => a - b) : null
}

export const LTE_BANDS: Record<number, BandInfo> = {
  1: { duplex: 'FDD', range: '2110–2170', carriers: ['cucc', 'ctcc'] },
  3: { duplex: 'FDD', range: '1805–1880', carriers: ['cmcc', 'cucc', 'ctcc'] },
  5: { duplex: 'FDD', range: '869–894', carriers: ['ctcc'] },
  8: { duplex: 'FDD', range: '925–960', carriers: ['cmcc', 'cucc'] },
  34: { duplex: 'TDD', range: '2010–2025', carriers: ['cmcc'] },
  38: { duplex: 'TDD', range: '2570–2620', carriers: ['cmcc'] },
  39: { duplex: 'TDD', range: '1880–1920', carriers: ['cmcc'] },
  40: { duplex: 'TDD', range: '2300–2400', carriers: ['cmcc'] },
  41: { duplex: 'TDD', range: '2496–2690', carriers: ['cmcc'] },
}

export const NR_BANDS: Record<number, BandInfo> = {
  1: { duplex: 'FDD', range: '2110–2170', carriers: ['cucc', 'ctcc'] },
  2: { duplex: 'FDD', range: '1930–1990', carriers: [] },
  3: { duplex: 'FDD', range: '1805–1880', carriers: ['cucc', 'ctcc'] },
  5: { duplex: 'FDD', range: '869–894', carriers: ['ctcc'] },
  7: { duplex: 'FDD', range: '2620–2690', carriers: [] },
  8: { duplex: 'FDD', range: '925–960', carriers: ['cmcc', 'cucc'] },
  12: { duplex: 'FDD', range: '729–746', carriers: [] },
  20: { duplex: 'FDD', range: '791–821', carriers: [] },
  25: { duplex: 'FDD', range: '1930–1995', carriers: [] },
  28: { duplex: 'FDD', range: '758–803', carriers: ['cbn', 'cmcc'] },
  38: { duplex: 'TDD', range: '2570–2620', carriers: [] },
  40: { duplex: 'TDD', range: '2300–2400', carriers: [] },
  41: { duplex: 'TDD', range: '2496–2690', carriers: ['cmcc', 'cbn'] },
  48: { duplex: 'TDD', range: '3550–3700', carriers: [] },
  66: { duplex: 'FDD', range: '2110–2200', carriers: [] },
  71: { duplex: 'FDD', range: '617–652', carriers: [] },
  75: { duplex: 'SDL', range: '1432–1517', carriers: [] },
  77: { duplex: 'TDD', range: '3300–4200', carriers: ['cucc', 'ctcc'] },
  78: { duplex: 'TDD', range: '3300–3800', carriers: ['cucc', 'ctcc', 'cbn'] },
  79: { duplex: 'TDD', range: '4400–5000', carriers: ['cmcc', 'cbn'] },
}

export function bandLabel(tech: 'NR' | 'LTE', band: number): string {
  return tech === 'NR' ? `n${band}` : `B${band}`
}

/**
 * 频点 → 制式：国内常见 5G NR-ARFCN 都在 15 万以上（n28 起步约 151600），
 * 4G EARFCN 都在 4.2 万以下，用 10 万做分界不会误判。锁小区时据此自动带上正确的 rat。
 */
export function techOfEarfcn(earfcn: number): 'NR' | 'LTE' {
  return earfcn >= 100_000 ? 'NR' : 'LTE'
}

/** 锁小区 rat 参数：12 = 4G，16 = 5G */
export const RAT_CODE = { LTE: '12', NR: '16' } as const

export function techOfRat(rat: string | number | undefined): 'NR' | 'LTE' {
  return String(rat) === '12' ? 'LTE' : 'NR'
}

/** NR-ARFCN → 下行频率（MHz），用于邻区表的频率提示 */
export function nrArfcnToMHz(arfcn: number): number | null {
  if (arfcn < 0) return null
  if (arfcn < 600_000) return arfcn * 0.005
  if (arfcn < 2_016_667) return 3000 + 0.015 * (arfcn - 600_000)
  return 24250.08 + 0.06 * (arfcn - 2_016_667)
}

/** LTE EARFCN → 下行频率（MHz），只覆盖锁频表里的频段 */
const LTE_DL: [band: number, fLow: number, nOffs: number, nMax: number][] = [
  [1, 2110, 0, 599],
  [3, 1805, 1200, 1949],
  [5, 869, 2400, 2649],
  [8, 925, 3450, 3799],
  [34, 2010, 36200, 36349],
  [38, 2570, 37750, 38249],
  [39, 1880, 38250, 38649],
  [40, 2300, 38650, 39649],
  [41, 2496, 39650, 41589],
]

export function lteEarfcnToMHz(earfcn: number): number | null {
  const row = LTE_DL.find(([, , offs, max]) => earfcn >= offs && earfcn <= max)
  return row ? row[1] + 0.1 * (earfcn - row[2]) : null
}

export function earfcnToMHz(earfcn: number): number | null {
  return techOfEarfcn(earfcn) === 'NR' ? nrArfcnToMHz(earfcn) : lteEarfcnToMHz(earfcn)
}
