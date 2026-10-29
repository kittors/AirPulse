import type { BaseDeviceInfo, GoformStatus } from '@/api/types'

/**
 * 把设备原始响应规整成界面直接可用的数据。
 * 设备字段的各种怪格式都在这里一次处理掉：数字是字符串、"" 表示无值、
 * 后端失败时给字符串 "null"、温度是毫摄氏度、电流是 µA、带宽是 kHz……
 * 界面拿到的只有干净的数字 / null，不再关心原始格式。（不依赖 DOM，可在 Node 里单测）
 */

export type Tech = 'NR' | 'LTE'
/** SA：只驻留 NR；NSA：LTE 锚点 + NR；LTE：只有 4G；LEGACY：3G 及以下；NONE：无服务 */
export type NetworkMode = 'SA' | 'NSA' | 'LTE' | 'LEGACY' | 'NONE'
export type DataState = 'connected' | 'connecting' | 'disconnecting' | 'disconnected' | 'unknown'
export type CarrierCode = 'cmcc' | 'cucc' | 'ctcc' | 'cbn'

export interface ServingCell {
  tech: Tech
  /** 主频段号（无前缀）；载波聚合时为第一个 */
  band: number | null
  /** 全部频段（CA 时多个） */
  bands: number[]
  earfcn: number | null
  pci: number | null
  cellId: string | null
  bandwidthMHz: number | null
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  rssi: number | null
}

export interface CpuCore {
  id: number
  usage: number | null
  curMHz: number
  maxMHz: number
  online: boolean
}

export interface Telemetry {
  at: number
  provider: string
  carrier: CarrierCode | null
  mode: NetworkMode
  rawNetworkType: string
  /** 0–5 格 */
  signalBars: number | null
  dataState: DataState
  nr: ServingCell | null
  lte: ServingCell | null
  /** 界面主显示的小区：有 NR 用 NR，否则 LTE */
  primary: ServingCell | null
  /** 字节 / 秒 */
  rxRate: number
  txRate: number
  /** 本次连接时长（秒） */
  connectedSeconds: number | null
  traffic: {
    /** 官方后台统计的本期已用（字节） */
    used: number | null
    /** 官方后台流量套餐上限（字节），未开启为 null */
    limit: number | null
    alertPercent: number | null
    periodSeconds: number | null
    /** Android 系统统计：当日 / 本月（字节） */
    today: number | null
    month: number | null
    reachedLimit: boolean
  }
  /** 无电池机型（F50 等 USB 供电）为 null */
  battery: { percent: number | null; charging: boolean; currentMA: number | null; voltageV: number | null } | null
  cpu: { usage: number | null; cores: CpuCore[] }
  memory: {
    usage: number | null
    totalKB: number | null
    availableKB: number | null
    swapUsage: number | null
    swapTotalKB: number | null
  }
  thermal: { maxC: number | null; zones: { name: string; celsius: number }[] }
  storage: {
    internal: { used: number; total: number } | null
    external: { used: number; total: number } | null
  }
  uptimeMs: number | null
  device: {
    model: string | null
    firmware: string | null
    appVersion: string | null
    imei: string | null
    iccid: string | null
    imsi: string | null
    msisdn: string | null
    lanIp: string | null
    mac: string | null
    ipv6: string | null
    clientIp: string | null
  }
  wifiClients: number | null
  smsUnread: number | null
  sim: { slot: string; dualSim: boolean }
  /** 官方后台会话是否有效（loginfo == 'ok'） */
  sessionOk: boolean
}

/** 字符串化并去掉后端的 "null" 占位 */
export function text(value: unknown): string {
  if (value == null) return ''
  const s = String(value).trim()
  return s === 'null' || s === 'undefined' ? '' : s
}

export function num(value: unknown): number | null {
  const s = text(value)
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** "41" / "n41" / "B3" / "3,1" → [41] / [41] / [3] / [3, 1] */
export function parseBands(value: unknown): number[] {
  return text(value)
    .split(/[,;\s/]+/)
    .map((part) => Number.parseInt(part.replace(/^[bn]/i, ''), 10))
    .filter((n) => Number.isFinite(n) && n > 0)
}

function servingCell(tech: Tech, raw: GoformStatus): ServingCell | null {
  const f =
    tech === 'NR'
      ? {
          rsrp: raw.Z5g_rsrp,
          sinr: raw.Nr_snr,
          rsrq: raw.nr_rsrq,
          rssi: raw.nr_rssi,
          band: raw.Nr_bands,
          earfcn: raw.Nr_fcn,
          bw: raw.Nr_bands_widths,
          pci: raw.Nr_pci,
          cell: raw.Nr_cell_id,
        }
      : {
          rsrp: raw.lte_rsrp,
          sinr: raw.Lte_snr,
          rsrq: raw.lte_rsrq,
          rssi: raw.lte_rssi,
          band: raw.Lte_bands,
          earfcn: raw.Lte_fcn,
          bw: raw.Lte_bands_widths,
          pci: raw.Lte_pci,
          cell: raw.Lte_cell_id,
        }
  const rsrp = num(f.rsrp)
  const pci = num(f.pci)
  const earfcn = num(f.earfcn)
  if (rsrp == null && pci == null && earfcn == null) return null
  const bands = parseBands(f.band)
  const bw = num(f.bw)
  return {
    tech,
    band: bands[0] ?? null,
    bands,
    earfcn,
    pci,
    cellId: text(f.cell) || null,
    // 设备给的是 kHz（"10000" = 10 MHz）；万一是 MHz（小于 1000）就原样用
    bandwidthMHz: bw == null || bw <= 0 ? null : bw >= 1000 ? bw / 1000 : bw,
    rsrp,
    rsrq: num(f.rsrq),
    sinr: num(f.sinr),
    rssi: num(f.rssi),
  }
}

function modeOf(nr: ServingCell | null, lte: ServingCell | null, rawType: string): NetworkMode {
  const t = rawType.toUpperCase()
  if (nr && lte) return 'NSA'
  if (nr) return t === 'NSA' || t === 'ENDC' ? 'NSA' : 'SA'
  if (lte) return 'LTE'
  if (['20', 'NR', 'SA', 'NR5G', '5G'].includes(t)) return 'SA'
  if (['13', 'LTE', '4G', 'LTE-A', 'LTE_A'].includes(t)) return 'LTE'
  if (/WCDMA|HSPA|UMTS|TD-?SCDMA|GSM|EDGE|GPRS|CDMA|EVDO|^3G|^2G/.test(t)) return 'LEGACY'
  return 'NONE'
}

const PLMN: Record<string, CarrierCode> = {
  '46000': 'cmcc',
  '46002': 'cmcc',
  '46004': 'cmcc',
  '46007': 'cmcc',
  '46008': 'cmcc',
  '46001': 'cucc',
  '46006': 'cucc',
  '46009': 'cucc',
  '46003': 'ctcc',
  '46005': 'ctcc',
  '46011': 'ctcc',
  '46015': 'cbn',
}

function carrierOf(provider: string, imsi: string): CarrierCode | null {
  if (/移动|mobile|cmcc/i.test(provider)) return 'cmcc'
  if (/联通|unicom|cucc/i.test(provider)) return 'cucc'
  if (/电信|telecom|ctcc/i.test(provider)) return 'ctcc'
  if (/广电|broadnet|cbn/i.test(provider)) return 'cbn'
  return PLMN[imsi.slice(0, 5)] ?? null
}

export function dataStateOf(ppp: string): DataState {
  if (!ppp) return 'unknown'
  if (ppp === 'ppp_disconnected') return 'disconnected'
  if (ppp.includes('disconnecting')) return 'disconnecting'
  if (ppp.includes('connecting')) return 'connecting'
  return 'connected'
}

/** "200_1024" → 200 × 1024 MB；倍数以 MB 计（1 = MB，1024 = GB，1048576 = TB） */
export function parseLimitSize(value: unknown): number | null {
  const [amount, multiplier] = text(value).split('_').map(Number)
  if (!Number.isFinite(amount) || !Number.isFinite(multiplier) || amount <= 0 || multiplier <= 0) return null
  return amount * multiplier * 1024 * 1024
}

function positive(value: number | null | undefined): number | null {
  return value == null || !Number.isFinite(value) || value < 0 ? null : value
}

/** `cat /proc/uptime` 的输出（「开机秒数 空闲秒数」）→ 开机秒数；读不出来返回 null */
export function parseProcUptime(output: string): number | null {
  const seconds = Number.parseFloat(output.trim().split(/\s+/)[0] ?? '')
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null
}

export function parseTelemetry(raw: GoformStatus, info: BaseDeviceInfo | null, at = Date.now()): Telemetry {
  const nr = servingCell('NR', raw)
  const lte = servingCell('LTE', raw)
  const rawType = text(raw.network_type)
  const provider = text(raw.network_provider)
  const imsi = text(raw.imsi)

  const used = (() => {
    const tx = num(raw.monthly_tx_bytes)
    const rx = num(raw.monthly_rx_bytes)
    return tx == null && rx == null ? null : (tx ?? 0) + (rx ?? 0)
  })()
  const limitEnabled = text(raw.data_volume_limit_switch) === '1'

  const hasBattery = text(raw.battery_value) !== '' || text(raw.battery_vol_percent) !== ''
  const batteryPercent = num(raw.battery_value) ?? num(raw.battery_vol_percent) ?? num(info?.battery)

  const usageInfo = info?.cpuUsageInfo ?? {}
  const freqInfo = info?.cpuFreqInfo ?? {}
  const cores: CpuCore[] = []
  for (let id = 0; `cpu${id}` in freqInfo; id += 1) {
    const freq = freqInfo[`cpu${id}`]
    const usage = num(usageInfo[`cpu${id}`])
    cores.push({
      id,
      usage,
      curMHz: freq?.cur ?? 0,
      maxMHz: freq?.max ?? 0,
      online: `cpu${id}` in usageInfo,
    })
  }

  const memInfo = info?.memInfo ?? null
  const zones = (info?.cpu_temp_list ?? [])
    .filter((zone) => zone && Number.isFinite(zone.temp) && zone.temp > 0)
    .map((zone) => ({ name: String(zone.type).replace(/-thmzone$/i, ''), celsius: zone.temp / 1000 }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const maxTemp = positive(info?.cpu_temp)

  const internalTotal = positive(info?.internal_total_storage)
  const externalTotal = positive(info?.external_total_storage)

  return {
    at,
    provider,
    carrier: carrierOf(provider, imsi),
    mode: modeOf(nr, lte, rawType),
    rawNetworkType: rawType,
    signalBars: num(raw.rssi) ?? num(raw.network_signalbar),
    dataState: dataStateOf(text(raw.ppp_status)),
    nr,
    lte,
    primary: nr ?? lte,
    rxRate: Math.max(0, num(raw.realtime_rx_thrpt) ?? 0),
    txRate: Math.max(0, num(raw.realtime_tx_thrpt) ?? 0),
    connectedSeconds: num(raw.realtime_time),
    traffic: {
      used,
      limit: limitEnabled ? parseLimitSize(raw.data_volume_limit_size) : null,
      alertPercent: num(raw.data_volume_alert_percent),
      periodSeconds: num(raw.monthly_time),
      today: positive(info?.daily_data),
      month: positive(info?.monthly_data),
      reachedLimit: info?.is_reached_data_flow_limit === true,
    },
    battery: hasBattery
      ? {
          percent: batteryPercent,
          charging: text(raw.battery_charging) === '1',
          currentMA: info?.current_now == null || info.current_now === -1 ? null : info.current_now / 1000,
          voltageV: info?.voltage_now == null || info.voltage_now <= 0 ? null : info.voltage_now / 1_000_000,
        }
      : null,
    cpu: { usage: positive(info?.cpu_usage), cores },
    memory: {
      usage: positive(info?.mem_usage) ?? num(memInfo?.mem_usage_percent),
      totalKB: positive(memInfo?.mem_total_kb),
      availableKB: positive(memInfo?.mem_available_kb),
      swapUsage: num(memInfo?.swap_usage_percent),
      swapTotalKB: positive(memInfo?.swap_total_kb),
    },
    thermal: { maxC: maxTemp == null ? null : maxTemp / 1000, zones },
    storage: {
      internal: internalTotal ? { used: positive(info?.internal_used_storage) ?? 0, total: internalTotal } : null,
      external: externalTotal ? { used: positive(info?.external_used_storage) ?? 0, total: externalTotal } : null,
    },
    uptimeMs: positive(info?.boot_time),
    device: {
      model: text(info?.model) || null,
      firmware: text(raw.cr_version) || null,
      appVersion: text(info?.app_ver) || null,
      imei: text(raw.imei) || null,
      iccid: text(raw.iccid) || null,
      imsi: imsi || null,
      msisdn: text(raw.msisdn) || text(raw.sim_msisdn) || null,
      lanIp: text(raw.lan_ipaddr) || null,
      mac: text(raw.mac_address) || null,
      ipv6: text(raw.ipv6_wan_ipaddr) || null,
      clientIp: text(info?.client_ip) || null,
    },
    wifiClients: num(raw.wifi_access_sta_num),
    smsUnread: num(raw.sms_unread_num),
    sim: { slot: text(raw.sim_slot), dualSim: text(raw.dual_sim_support) === '1' },
    sessionOk: text(raw.loginfo) === 'ok',
  }
}

/**
 * AT+CGEQOSRDP=1 → QCI 与签约速率（AMBR，kbps）。
 * 例：「+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK」→ { qci: 9, downKbps: 1000000, upKbps: 200000 }
 */
export function parseQos(result: string): { qci: number; downKbps: number; upKbps: number } | null {
  const match = /\+CGEQOSRDP:\s*([^O]+?)\s*OK/i.exec(result.replace(/\s+/g, ' '))
  if (!match) return null
  const parts = match[1].split(',').map((p) => Number(p.trim()))
  if (parts.length < 8 || parts.some((p) => !Number.isFinite(p))) return null
  return { qci: parts[1], downKbps: parts[6], upKbps: parts[7] }
}
