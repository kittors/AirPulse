/**
 * 设备原始响应类型（详见 docs/legacy-radio-dashboard.md）。
 * goform 的值多为字符串，""表示无值；部分计数器是 number。界面不直接用这些类型，
 * 一律经 src/model/ 下的解析函数转换成干净的数据。
 */
export type NumLike = string | number

/** 主页状态轮询请求的 39 个 cmd（与原版 getUFIData 一致） */
export const STATUS_CMDS = [
  'usb_port_switch',
  'battery_charging',
  'sms_received_flag',
  'sms_unread_num',
  'sms_sim_unread_num',
  'sim_msisdn',
  'dual_sim_support',
  'sim_slot',
  'data_volume_limit_switch',
  'battery_value',
  'battery_vol_percent',
  'network_signalbar',
  'network_rssi',
  'cr_version',
  'iccid',
  'imei',
  'imsi',
  'ipv6_wan_ipaddr',
  'lan_ipaddr',
  'mac_address',
  'msisdn',
  'network_information',
  'Lte_ca_status',
  'rssi',
  'Z5g_rsrp',
  'lte_rsrp',
  'wifi_access_sta_num',
  'loginfo',
  'data_volume_alert_percent',
  'data_volume_limit_size',
  'realtime_rx_thrpt',
  'realtime_tx_thrpt',
  'realtime_time',
  'monthly_tx_bytes',
  'monthly_rx_bytes',
  'monthly_time',
  'network_type',
  'network_provider',
  'ppp_status',
] as const

export type StatusCmd = (typeof STATUS_CMDS)[number]

/** 主页轮询响应：39 个 cmd + 由 network_information 平铺展开的 16 个信号字段（键名大小写原样） */
export type GoformStatus = Partial<Record<StatusCmd, NumLike>> & {
  Nr_snr?: NumLike
  nr_rsrq?: NumLike
  nr_rssi?: NumLike
  Nr_bands?: NumLike
  Nr_fcn?: NumLike
  Nr_bands_widths?: NumLike
  Nr_pci?: NumLike
  Nr_cell_id?: NumLike
  Lte_snr?: NumLike
  lte_rsrq?: NumLike
  lte_rssi?: NumLike
  Lte_bands?: NumLike
  Lte_fcn?: NumLike
  Lte_bands_widths?: NumLike
  Lte_pci?: NumLike
  Lte_cell_id?: NumLike
}

export interface CpuFreqCore {
  cur: number
  max: number
}

export interface MemInfo {
  mem_total_kb?: number
  mem_available_kb?: number
  mem_used_kb?: number
  mem_usage_percent?: NumLike
  swap_total_kb?: number
  swap_free_kb?: number
  swap_used_kb?: number
  swap_usage_percent?: NumLike
}

/** GET /api/baseDeviceInfo（后端用字符串模板拼 JSON：失败时有的是 null，有的是字符串 "null"） */
export interface BaseDeviceInfo {
  app_ver?: string
  app_ver_code?: string
  model?: string
  battery?: string
  daily_data?: number | null
  monthly_data?: number | null
  internal_available_storage?: number | null
  internal_used_storage?: number | null
  internal_total_storage?: number | null
  external_total_storage?: number | null
  external_used_storage?: number | null
  external_available_storage?: number | null
  /** 温度为毫摄氏度 */
  cpu_temp_list?: { type: string; temp: number }[] | null
  cpu_temp?: number | null
  client_ip?: string
  cpu_usage?: number | null
  mem_usage?: number | null
  cpuFreqInfo?: Record<string, CpuFreqCore> | null
  cpuUsageInfo?: Record<string, NumLike> | null
  memInfo?: MemInfo | null
  /** µA */
  current_now?: number | null
  /** µV */
  voltage_now?: number | null
  is_reached_data_flow_limit?: boolean
  /** 开机时长，毫秒 */
  boot_time?: number | null
}

export interface VersionInfo {
  app_ver?: string
  app_ver_code?: string
  model?: string
  nickname?: string
  accept_terms?: boolean
}

export type BearerPreference = 'WL_AND_5G' | 'LTE_AND_5G' | 'Only_5G' | 'WCDMA_AND_LTE' | 'Only_LTE' | 'Only_WCDMA'

export interface RawNeighborCell {
  band?: NumLike
  earfcn?: NumLike
  pci?: NumLike
  rsrp?: NumLike
  rsrq?: NumLike
  sinr?: NumLike
}

export interface RawLockedCell {
  earfcn?: NumLike
  pci?: NumLike
  rat?: NumLike
}

export interface RawCellInfo {
  neighbor_cell_info?: RawNeighborCell[] | ''
  locked_cell_info?: RawLockedCell[] | ''
}

export interface RawBandLock {
  lte_band_lock?: string
  nr_band_lock?: string
}
