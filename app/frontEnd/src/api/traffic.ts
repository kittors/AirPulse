import { api } from './client'
import { goformGet, goformSet } from './goform'

/**
 * 流量：官方后台的套餐设置（DATA_LIMIT_SETTING + FLOW_CALIBRATION_MANUAL）、
 * AirPulse 自身的流量保护（get/set_data_limit）与逐日用量（cellularUsage）。
 * 字段格式见 docs/legacy-radio-dashboard.md §7.3–7.4。
 */

/** 套餐大小的倍数以 MB 计：1 = MB，1024 = GB，1048576 = TB */
export type SizeUnit = 1 | 1024 | 1048576
export const SIZE_UNITS: { value: SizeUnit; label: string }[] = [
  { value: 1, label: 'MB' },
  { value: 1024, label: 'GB' },
  { value: 1048576, label: 'TB' },
]
const MB = 1024 * 1024

export interface DataPlan {
  enabled: boolean
  /** 套餐大小：数值 × 倍数（MB） */
  size: number
  unit: SizeUnit
  alertPercent: number
  /** 每月清零日 1–31 */
  clearDay: number
  autoClear: boolean
  /** 官方后台统计的本期已用（字节） */
  usedBytes: number
}

type RawPlan = Record<string, string | number | null | undefined>

const PLAN_CMDS = [
  'flux_data_volume_limit_switch',
  'data_volume_limit_switch',
  'data_volume_limit_unit',
  'data_volume_limit_size',
  'flux_data_volume_limit_size',
  'data_volume_alert_percent',
  'flux_data_volume_alert_percent',
  'monthly_tx_bytes',
  'monthly_rx_bytes',
  'wan_auto_clear_flow_data_switch',
  'flux_auto_clear_flow_data_switch',
  'traffic_clear_date',
  'flux_clear_date',
]

/** 非 flux_ 字段为空时回退到 flux_ 版本（原版同样处理） */
const pick = (raw: RawPlan, key: string, flux: string) => {
  const value = raw[key]
  return value == null || value === '' ? raw[flux] : value
}

export function parsePlan(raw: RawPlan): DataPlan {
  const [num, mul] = String(pick(raw, 'data_volume_limit_size', 'flux_data_volume_limit_size') ?? '').split('_')
  const unit = ([1, 1024, 1048576] as const).find((u) => u === Number(mul)) ?? 1024
  return {
    enabled: String(pick(raw, 'data_volume_limit_switch', 'flux_data_volume_limit_switch') ?? '0') === '1',
    size: Number(num) || 0,
    unit,
    alertPercent: Number(pick(raw, 'data_volume_alert_percent', 'flux_data_volume_alert_percent') ?? 0) || 0,
    clearDay: Number(pick(raw, 'traffic_clear_date', 'flux_clear_date') ?? 1) || 1,
    autoClear: String(pick(raw, 'wan_auto_clear_flow_data_switch', 'flux_auto_clear_flow_data_switch') ?? '') === 'on',
    usedBytes: (Number(raw.monthly_tx_bytes) || 0) + (Number(raw.monthly_rx_bytes) || 0),
  }
}

/** 写入的表单：开启时整套字段（含 flux_ 副本），关闭时只提交原版那组固定的清理字段 */
export function planForm(plan: DataPlan): Record<string, string> {
  if (!plan.enabled) {
    return {
      data_volume_limit_switch: '0',
      wan_auto_clear_flow_data_switch: 'on',
      traffic_clear_date: '1',
      notify_deviceui_enable: '0',
      flux_data_volume_limit_switch: '0',
      flux_auto_clear_flow_data_switch: 'on',
      flux_clear_date: '1',
      flux_notify_deviceui_enable: '0',
    }
  }
  const size = `${plan.size}_${plan.unit}`
  return {
    data_volume_limit_switch: '1',
    flux_data_volume_limit_switch: '1',
    // 关闭自动清零时原版实际提交的是 'off'（不是 '0'）
    wan_auto_clear_flow_data_switch: plan.autoClear ? 'on' : 'off',
    flux_auto_clear_flow_data_switch: plan.autoClear ? 'on' : 'off',
    data_volume_limit_unit: 'data',
    flux_data_volume_limit_unit: 'data',
    traffic_clear_date: String(plan.clearDay),
    flux_clear_date: String(plan.clearDay),
    data_volume_alert_percent: String(plan.alertPercent),
    flux_data_volume_alert_percent: String(plan.alertPercent),
    data_volume_limit_size: size,
    flux_data_volume_limit_size: size,
    flux_data_volume_limit_type: `_${plan.unit}`,
    // 已用量原样带上（以 MB 计），只改套餐不会把已用清零；校准走单独的 FLOW_CALIBRATION_MANUAL
    data_volume_used_size: String(Math.round(plan.usedBytes / MB)),
    data_volume_used_type: '1',
    notify_deviceui_enable: '0',
  }
}

export interface DataGuard {
  enabled: boolean
  /** 上限（字节）；-1 表示不限 */
  maxBytes: number
  period: 'daily' | 'monthly'
  notify: boolean
}

export interface DailyUsage {
  /** YYYY-MM-DD */
  date: string
  bytes: number
}

export const trafficApi = {
  async plan(): Promise<DataPlan> {
    return parsePlan(await goformGet<RawPlan>(PLAN_CMDS))
  },

  savePlan: (plan: DataPlan) => goformSet('DATA_LIMIT_SETTING', planForm(plan)),

  /** 把官方统计的已用流量校准成指定字节数 */
  calibrate: (usedBytes: number) =>
    goformSet('FLOW_CALIBRATION_MANUAL', { calibration_way: 'data', time: 0, data: Math.max(0, Math.round(usedBytes)).toFixed(0) }),

  async guard(): Promise<DataGuard> {
    const raw = await api<Record<string, unknown>>('/get_data_limit')
    const max = Number(raw.data_flow_max_limit)
    return {
      enabled: String(raw.data_flow_limit_enabled) === '1' || raw.data_flow_limit_enabled === true,
      maxBytes: Number.isFinite(max) ? max : -1,
      period: raw.data_flow_check_daily_or_monthly === 'daily' ? 'daily' : 'monthly',
      notify: String(raw.data_limit_status_forward_enabled) === '1' || raw.data_limit_status_forward_enabled === true,
    }
  },

  saveGuard: (guard: DataGuard) =>
    api<{ result?: string }>('/set_data_limit', {
      method: 'POST',
      json: {
        data_flow_limit_enabled: guard.enabled ? '1' : '0',
        data_limit_status_forward_enabled: guard.notify ? '1' : '0',
        data_flow_max_limit: guard.enabled ? Math.round(guard.maxBytes) : -1,
        data_flow_check_daily_or_monthly: guard.period,
        data_check_reference: 'android',
      },
    }),

  /** 逐日用量（Android 系统统计） */
  async daily(start: number, end: number): Promise<DailyUsage[]> {
    const res = await api<{ usage?: { date?: string; usage?: string | number }[] }>('/cellularUsage', {
      query: { startTime: start, endTime: end, method: 'date-range' },
      timeout: 15_000,
    })
    return (Array.isArray(res.usage) ? res.usage : []).map((day) => ({ date: String(day.date ?? ''), bytes: Number(day.usage) || 0 }))
  },
}

export const bytesOf = (value: number, unit: SizeUnit) => value * unit * MB

/** 字节 → 最合适的套餐单位（能整除 TB 用 TB，能整除 GB 用 GB，否则 MB） */
export function splitBytes(bytes: number): { value: number; unit: SizeUnit } {
  if (bytes <= 0) return { value: 0, unit: 1024 }
  if (bytes % (1048576 * MB) === 0) return { value: bytes / (1048576 * MB), unit: 1048576 }
  if (bytes % (1024 * MB) === 0) return { value: bytes / (1024 * MB), unit: 1024 }
  return { value: Math.floor(bytes / MB), unit: 1 }
}
