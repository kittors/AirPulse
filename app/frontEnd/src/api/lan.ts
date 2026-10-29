import type { LanConfig } from '@/model/lan'

import { goformGet, goformSet } from './goform'

export * from '@/model/lan'

export interface LanState extends LanConfig {
  mac: string
}

type Raw = Record<string, string | undefined>

export const lanApi = {
  async get(): Promise<LanState> {
    const raw = await goformGet<Raw>(['lan_ipaddr', 'lan_netmask', 'mac_address', 'dhcpEnabled', 'dhcpStart', 'dhcpEnd', 'dhcpLease_hour'])
    return {
      ip: raw.lan_ipaddr ?? '',
      mask: raw.lan_netmask ?? '',
      dhcp: String(raw.dhcpEnabled ?? '') === '1',
      start: raw.dhcpStart ?? '',
      end: raw.dhcpEnd ?? '',
      // 设备返回 "24h"
      lease: String(raw.dhcpLease_hour ?? '').replace(/\D/g, '') || '24',
      mac: raw.mac_address ?? '',
    }
  },
  /** 保存后设备会重启；网关地址变了的话要用新地址访问 */
  save: (config: LanConfig, onSend?: () => void) =>
    goformSet(
      'DHCP_SETTING',
      {
        lanIp: config.ip.trim(),
        lanNetmask: config.mask.trim(),
        lanDhcpType: config.dhcp ? 'SERVER' : 'DISABLE',
        dhcpStart: config.dhcp ? config.start.trim() : '',
        dhcpEnd: config.dhcp ? config.end.trim() : '',
        dhcpLease: config.dhcp ? config.lease.trim() : '',
        dhcp_reboot_flag: '1',
        mac_ip_reset: config.dhcp ? '1' : '0',
      },
      { timeout: 20_000, onSend },
    ),
}
