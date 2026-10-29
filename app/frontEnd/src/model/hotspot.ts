/**
 * Wi-Fi 热点与接入设备的数据整理（纯函数，可在 Node 里单测）。
 * 字段格式见 docs/legacy-network-sms.md §2–§3。
 */

export type AuthMode = 'OPEN' | 'WPA2PSK' | 'WPA3PSK' | 'WPA2PSKWPA3PSK'
export const AUTH_MODES: AuthMode[] = ['WPA2PSK', 'WPA2PSKWPA3PSK', 'WPA3PSK', 'OPEN']

export interface AccessPoint {
  /** AccessPointIndex：0 = 主网络 */
  index: string
  /** ChipIndex："0" = 2.4 GHz，其它 = 5 GHz */
  chip: string
  enabled: boolean
  ssid: string
  /** 明文（设备上存的是 UTF-8 Base64） */
  password: string
  /** 未知取值原样保留（只读显示） */
  authMode: string
  hidden: boolean
  maxStations: number
  /** 读不到时为 null，写回时保持 0（与原版一致） */
  isolate: boolean | null
}

export interface WifiInfo {
  moduleOn: boolean
  aps: AccessPoint[]
  /** 当前启用的主 AP；模块关闭时为 null */
  active: AccessPoint | null
}

export type WifiBand = 'off' | 'chip1' | 'chip2'

const str = (value: unknown) => (value == null ? '' : String(value))

export function decodeBase64Utf8(value: string): string {
  try {
    const padded = value + '='.repeat((4 - (value.length % 4)) % 4)
    return new TextDecoder('utf-8').decode(Uint8Array.from(atob(padded), (ch) => ch.charCodeAt(0)))
  } catch {
    return ''
  }
}

export function encodeBase64Utf8(value: string): string {
  let binary = ''
  for (const byte of new TextEncoder().encode(value)) binary += String.fromCharCode(byte)
  return btoa(binary)
}

export function parseWifi(raw: Record<string, unknown>): WifiInfo {
  const list = Array.isArray(raw.ResponseList) ? (raw.ResponseList as Record<string, unknown>[]) : []
  const aps: AccessPoint[] = list.map((item) => ({
    index: str(item.AccessPointIndex) || '0',
    chip: str(item.ChipIndex) || '0',
    enabled: str(item.AccessPointSwitchStatus) === '1',
    ssid: str(item.SSID),
    password: decodeBase64Utf8(str(item.Password)),
    authMode: str(item.AuthMode) || 'WPA2PSK',
    hidden: str(item.ApBroadcastDisabled) === '1',
    maxStations: Number(item.ApMaxStationNumber) || 10,
    isolate: item.ApIsolate == null || item.ApIsolate === '' ? null : str(item.ApIsolate) === '1',
  }))
  const moduleOn = str(raw.WiFiModuleSwitch) === '1'
  // 有多项启用时原版取最后一项
  const enabled = aps.filter((ap) => ap.enabled && ap.index === '0')
  return { moduleOn, aps, active: moduleOn ? (enabled.at(-1) ?? null) : null }
}

export const bandOf = (info: WifiInfo): WifiBand => (!info.moduleOn || !info.active ? 'off' : info.active.chip === '0' ? 'chip1' : 'chip2')

/**
 * 按目标频段改写 Wi-Fi 状态：切换还没在设备上生效时的乐观显示。
 * Wi-Fi 关着时设备照样返回各 AP 的配置，所以打开时能立刻显示二维码和网络设置。
 */
export function withBand(info: WifiInfo, band: WifiBand): WifiInfo {
  if (band === 'off') return { ...info, moduleOn: false, active: null }
  const chip = band === 'chip1' ? '0' : '1'
  const target = info.aps.find((ap) => ap.index === '0' && (chip === '0' ? ap.chip === '0' : ap.chip !== '0'))
  if (!target) return info
  const aps = info.aps.map((ap) => (ap.index === '0' ? { ...ap, enabled: ap === target } : ap))
  return { moduleOn: true, aps, active: aps[info.aps.indexOf(target)] }
}

/** SSID 1–32 字节（UTF-8） */
export function validSsid(ssid: string): boolean {
  const bytes = new TextEncoder().encode(ssid).length
  return bytes >= 1 && bytes <= 32
}

/** WPA 密码：8–63 个可打印 ASCII 字符，或 64 位十六进制 */
export function validWifiPassword(password: string): boolean {
  if (/^[0-9a-fA-F]{64}$/.test(password)) return true
  return /^[\x20-\x7e]{8,63}$/.test(password)
}

/** Wi-Fi 二维码内容：WIFI:T:WPA;S:<SSID>;P:<密码>;H:<是否隐藏>;; —— \ ; , : " 前加反斜杠 */
export function wifiQrPayload(ap: Pick<AccessPoint, 'ssid' | 'password' | 'authMode' | 'hidden'>): string {
  const escape = (value: string) => value.replace(/([\\;,:"])/g, '\\$1')
  const open = ap.authMode === 'OPEN'
  const type = open ? 'nopass' : ap.authMode === 'WPA3PSK' ? 'SAE' : 'WPA'
  return `WIFI:T:${type};S:${escape(ap.ssid)};${open ? '' : `P:${escape(ap.password)};`}${ap.hidden ? 'H:true;' : ''};`
}

/* —— 接入设备与黑名单 —— */

export interface Client {
  mac: string
  ip: string
  /** 改过名就用改过的名字，否则用设备上报的主机名 */
  name: string
  reportedName: string
  via: 'wifi' | 'usb'
}

export interface BlockedClient {
  mac: string
  name: string
}

export interface AccessControl {
  mode: string
  blocked: BlockedClient[]
  whiteMacList: string
  whiteNameList: string
}

const splitList = (value: unknown) => str(value).split(';')

export function parseClients(raw: Record<string, unknown>): { clients: Client[]; acl: AccessControl } {
  const renamed = new Map<string, string>()
  if (Array.isArray(raw.devices)) {
    for (const device of raw.devices as Record<string, unknown>[]) {
      const mac = str(device.mac).toLowerCase()
      if (mac && str(device.hostname)) renamed.set(mac, str(device.hostname))
    }
  }
  const pick = (list: unknown, via: Client['via']): Client[] =>
    (Array.isArray(list) ? (list as Record<string, unknown>[]) : []).map((item) => {
      const mac = str(item.mac_addr).toLowerCase()
      const reported = str(item.hostname)
      return { mac, ip: str(item.ip_addr), name: renamed.get(mac) || reported || mac, reportedName: reported, via }
    })
  // 黑名单两串按下标对应；以 MAC 为主键，跳过空项
  const macs = splitList(raw.BlackMacList)
  const names = splitList(raw.BlackNameList)
  const blocked: BlockedClient[] = []
  macs.forEach((mac, i) => {
    const key = mac.trim().toLowerCase()
    if (key) blocked.push({ mac: key, name: names[i]?.trim() || renamed.get(key) || key })
  })
  return {
    clients: [...pick(raw.station_list, 'wifi'), ...pick(raw.lan_station_list, 'usb')],
    acl: { mode: str(raw.AclMode), blocked, whiteMacList: str(raw.WhiteMacList), whiteNameList: str(raw.WhiteNameList) },
  }
}

/** 提交黑名单：两串按同一顺序生成；名称里的 ; 换成空格，避免两列错位 */
export function blacklistForm(acl: AccessControl, blocked: BlockedClient[]): Record<string, string> {
  return {
    AclMode: acl.mode,
    WhiteMacList: acl.whiteMacList,
    WhiteNameList: acl.whiteNameList,
    BlackMacList: blocked.map((item) => item.mac).join(';'),
    BlackNameList: blocked.map((item) => item.name.replace(/;/g, ' ')).join(';'),
  }
}
