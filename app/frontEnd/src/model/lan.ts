/**
 * 局域网 / DHCP 的地址计算与校验（纯函数）。见 docs/legacy-network-sms.md §4.6：
 * - 用无符号运算（原版用有符号 <<，128.0.0.0 以上会变负数）；
 * - 去掉原版过严的「起始地址必须大于网关」——网关在 .254、地址池 .2–.200 是合法的，只要网关不在池内即可。
 */

export function ipToInt(ip: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip.trim())
  if (!m) return null
  const parts = m.slice(1).map(Number)
  // 不接受 192.168.01.1 这类前导零（有的实现会按八进制解析）
  if (parts.some((n, i) => n > 255 || (m[i + 1].length > 1 && m[i + 1].startsWith('0')))) return null
  return ((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]
}

export const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

/** 可选的子网掩码：/8 – /30（/31、/32 没有可分配的主机地址） */
export const MASKS = Array.from({ length: 23 }, (_, i) => {
  const bits = 8 + i
  return { bits, mask: intToIp((0xffffffff << (32 - bits)) >>> 0) }
})

export const prefixOf = (mask: string) => MASKS.find((m) => m.mask === mask.trim())?.bits ?? null

export interface Subnet {
  network: number
  broadcast: number
  /** 可用主机地址数 */
  hosts: number
  prefix: number
}

export function subnetOf(ip: string, mask: string): Subnet | null {
  const addr = ipToInt(ip)
  const prefix = prefixOf(mask)
  if (addr == null || prefix == null) return null
  const maskInt = (0xffffffff << (32 - prefix)) >>> 0
  const network = (addr & maskInt) >>> 0
  const broadcast = (network | (~maskInt >>> 0)) >>> 0
  return { network, broadcast, hosts: broadcast - network - 1, prefix }
}

export interface LanConfig {
  ip: string
  mask: string
  dhcp: boolean
  start: string
  end: string
  /** 小时 */
  lease: string
}

export type LanError =
  | 'ip'
  | 'ipEdge'
  | 'mask'
  | 'start'
  | 'startSubnet'
  | 'startEdge'
  | 'end'
  | 'endSubnet'
  | 'endEdge'
  | 'order'
  | 'gatewayInPool'
  | 'lease'

export type LanErrors = Partial<Record<'ip' | 'mask' | 'start' | 'end' | 'lease', LanError>>

export const MAX_LEASE_HOURS = 8760

export function validateLan(config: LanConfig): LanErrors {
  const errors: LanErrors = {}
  const ip = ipToInt(config.ip)
  if (ip == null) errors.ip = 'ip'
  if (prefixOf(config.mask) == null) errors.mask = 'mask'
  const subnet = subnetOf(config.ip, config.mask)
  const isEdge = (n: number) => subnet != null && (n === subnet.network || n === subnet.broadcast)
  if (ip != null && isEdge(ip)) errors.ip = 'ipEdge'
  if (!config.dhcp) return errors

  const check = (value: string, key: 'start' | 'end'): number | null => {
    const n = ipToInt(value)
    if (n == null) {
      errors[key] = key
      return null
    }
    if (subnet && (n < subnet.network || n > subnet.broadcast)) {
      errors[key] = key === 'start' ? 'startSubnet' : 'endSubnet'
      return null
    }
    if (isEdge(n)) {
      errors[key] = key === 'start' ? 'startEdge' : 'endEdge'
      return null
    }
    return n
  }
  const start = check(config.start, 'start')
  const end = check(config.end, 'end')
  if (start != null && end != null) {
    if (start >= end) errors.end = 'order'
    else if (ip != null && ip >= start && ip <= end) errors.start = 'gatewayInPool'
  }
  const lease = Number(config.lease)
  if (!/^\d+$/.test(config.lease.trim()) || lease < 1 || lease > MAX_LEASE_HOURS) errors.lease = 'lease'
  return errors
}

/** 地址池大小 */
export function poolSize(start: string, end: string): number | null {
  const a = ipToInt(start)
  const b = ipToInt(end)
  return a != null && b != null && b >= a ? b - a + 1 : null
}
