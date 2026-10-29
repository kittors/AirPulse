import { parseSwitches, type DeviceSwitches, type RawSwitches } from '@/model/switches'

import { api } from './client'
import { sha256HexUpper } from './crypto'
import { goformGet, goformSet } from './goform'

/**
 * 设备与网络的各类开关（官方后台 goform + AirPulse 后端），读字段见 API_Doc §3.13「快捷开关状态」。
 * 一次读回全部开关，界面上各项即点即生效。
 */

const SWITCH_CMDS = [
  'performance_mode',
  'usb_network_protocal',
  'samba_switch',
  'roam_setting_option',
  'dial_roam_setting_option',
  'indicator_light_switch',
  'restart_schedule_switch',
  'restart_time',
  'sleep_sysIdleTimeToSleep',
  'is_support_nfc_functions',
  'web_wifi_nfc_switch',
  'sim_slot',
  'dual_sim_support',
  'ppp_status',
  'usb_port_switch',
]

export { parseSwitches, type DeviceSwitches }

export const systemApi = {
  async switches(): Promise<DeviceSwitches> {
    return parseSwitches(await goformGet<RawSwitches>(SWITCH_CMDS))
  },

  setData: (connected: boolean) => goformSet(connected ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK'),
  setRoaming: (enabled: boolean) =>
    goformSet('SET_CONNECTION_MODE', {
      ConnectionMode: 'auto_dial',
      roam_setting_option: enabled ? 'on' : 'off',
      dial_roam_setting_option: enabled ? 'on' : 'off',
    }),
  setSimSlot: (slot: string) => goformSet('SET_SIM_SLOT', { sim_slot: slot }),
  setPerformanceMode: (enabled: boolean) => goformSet('PERFORMANCE_MODE_SETTING', { performance_mode: enabled ? '1' : '0' }),
  setIndicatorLight: (enabled: boolean) => goformSet('INDICATOR_LIGHT_SETTING', { indicator_light_switch: enabled ? '1' : '0' }),
  setRestartSchedule: (enabled: boolean, time: string) =>
    goformSet('RESTART_SCHEDULE_SETTING', { restart_schedule_switch: enabled ? '1' : '0', restart_time: time }),
  setWifiSleep: (minutes: number) => goformSet('SET_WIFI_SLEEP_INFO', { sleep_sysIdleTimeToSleep: String(minutes) }),
  setNfc: (enabled: boolean) => goformSet('WIFI_NFC_SET', { web_wifi_nfc_switch: enabled ? '1' : '0' }),
  setUsbProtocol: (value: string) => goformSet('SET_USB_NETWORK_PROTOCAL', { usb_network_protocal: value }),
  setSamba: (enabled: boolean) => goformSet('SAMBA_SETTING', { samba_switch: enabled ? '1' : '0' }),
  setUsbDebug: (enabled: boolean) => goformSet('USB_PORT_SETTING', { usb_port_switch: enabled ? '1' : '0' }),

  reboot: () => goformSet('REBOOT_DEVICE'),
  shutdown: () => goformSet('SHUTDOWN_DEVICE'),

  /** 改设备自带后台的密码：新旧密码都传大写 SHA256（与原版一致），成功后同步给 AirPulse 后端（定时任务自动登录要用） */
  async changeAdminPassword(oldPassword: string, newPassword: string) {
    await goformSet('CHANGE_PASSWORD', { oldPassword: sha256HexUpper(oldPassword), newPassword: sha256HexUpper(newPassword) })
    await api('/update_admin_pwd', { method: 'POST', json: { password: newPassword } }).catch(() => undefined)
  },

  /* —— VoLTE / VoNR（AirPulse 后端，slot 必须放在 body 里） —— */
  volte: (slot = 0) => api<{ enabled?: boolean | string }>('/volte_status', { query: { slot } }),
  setVolte: (enabled: boolean, slot = 0) =>
    api('/volte_status', { method: 'POST', json: { enabled: enabled ? '1' : '0', slot: String(slot) } }),
  vonr: (slot = 0) => api<{ enabled?: boolean | string }>('/vonr_status', { query: { slot } }),
  setVonr: (enabled: boolean, slot = 0) => api('/vonr_status', { method: 'POST', json: { enabled: enabled ? '1' : '0', slot: String(slot) } }),

  /* —— AirPulse 后端的其它开关 —— */
  setNickname: (nickname: string) => api('/set_nickname', { method: 'POST', json: { nickname } }),
  logStatus: () => api<{ debug_log_enabled?: boolean | string }>('/get_log_status'),
  setLogStatus: (enabled: boolean) => api('/set_log_status', { method: 'POST', json: { debug_log_enabled: enabled } }),
  /** 唤醒锁只有写接口，没有读取接口（get_log_status 不带它） */
  setWakelock: (enabled: boolean) => api('/set_wakelock_status', { method: 'POST', json: { wakelock_enabled: enabled } }),
  disableFota: () => api<{ result?: string }>('/disable_fota'),
}

export const truthy = (value: unknown) => value === true || value === 'true' || value === '1' || value === 1
