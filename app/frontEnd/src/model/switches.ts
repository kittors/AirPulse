/**
 * 设备与网络各类开关的读回解析（官方后台 goform 字段见 API_Doc §3.13「快捷开关状态」）。
 */

export interface DeviceSwitches {
  performanceMode: boolean
  usbProtocol: string
  samba: boolean
  roaming: boolean
  indicatorLight: boolean
  restartSchedule: boolean
  /** HH:mm */
  restartTime: string
  /** 分钟；-1 = 永不休眠 */
  wifiSleepMinutes: number | null
  nfcSupported: boolean
  nfc: boolean
  simSlot: string
  dualSim: boolean
  dataConnected: boolean
  /** 拨号 / 断开要几秒，期间 ppp_status 是过渡态 */
  dataTransition: 'connecting' | 'disconnecting' | null
  /** 有线 adb（USB 调试） */
  usbDebug: boolean
}

export type RawSwitches = Record<string, string | number | null | undefined>
const on = (value: unknown) => String(value ?? '') === '1'

export function parseSwitches(raw: RawSwitches): DeviceSwitches {
  const roam = String(raw.dial_roam_setting_option || raw.roam_setting_option || '')
  const sleep = Number(raw.sleep_sysIdleTimeToSleep)
  const ppp = String(raw.ppp_status ?? '')
  const transition = ppp.includes('disconnecting') ? 'disconnecting' : ppp.includes('connecting') ? 'connecting' : null
  return {
    performanceMode: on(raw.performance_mode),
    usbProtocol: String(raw.usb_network_protocal ?? ''),
    samba: on(raw.samba_switch),
    roaming: roam === 'on',
    indicatorLight: on(raw.indicator_light_switch),
    restartSchedule: on(raw.restart_schedule_switch),
    restartTime: String(raw.restart_time || '03:00'),
    wifiSleepMinutes: Number.isFinite(sleep) && String(raw.sleep_sysIdleTimeToSleep ?? '') !== '' ? sleep : null,
    nfcSupported: on(raw.is_support_nfc_functions),
    nfc: on(raw.web_wifi_nfc_switch),
    simSlot: String(raw.sim_slot ?? ''),
    dualSim: on(raw.dual_sim_support),
    // 过渡态按正在去的方向算，免得开关在「连接中」时弹回关
    dataConnected: transition ? transition === 'connecting' : ppp.includes('connected') && !ppp.includes('disconnected'),
    dataTransition: transition,
    usbDebug: on(raw.usb_port_switch),
  }
}
