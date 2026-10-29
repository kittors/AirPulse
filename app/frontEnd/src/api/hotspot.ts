import {
  blacklistForm,
  encodeBase64Utf8,
  parseClients,
  parseWifi,
  type AccessControl,
  type AccessPoint,
  type BlockedClient,
  type WifiBand,
} from '@/model/hotspot'

import { goformGet, goformSet } from './goform'

export * from '@/model/hotspot'

export const hotspotApi = {
  async wifi() {
    return parseWifi(await goformGet<Record<string, unknown>>(['queryWiFiModuleSwitch', 'queryAccessPointInfo']))
  },

  /** 关闭整个 Wi-Fi，或切到 2.4G / 5G（切频段会顺带打开模块，原版从不单独发 SwitchOption=1） */
  setBand: (band: WifiBand) =>
    band === 'off'
      ? goformSet('switchWiFiModule', { SwitchOption: '0' }, { timeout: 20_000 })
      : goformSet('switchWiFiChip', { ChipEnum: band, GuestEnable: '0' }, { timeout: 20_000 }),

  /** 保存热点参数：密码按 UTF-8 Base64；开放网络不带密码、EncrypType=NONE */
  save(ap: AccessPoint) {
    const open = ap.authMode === 'OPEN'
    return goformSet(
      'setAccessPointInfo',
      {
        SSID: ap.ssid,
        AuthMode: ap.authMode,
        EncrypType: open ? 'NONE' : 'CCMP',
        ...(open ? {} : { Password: encodeBase64Utf8(ap.password) }),
        ApMaxStationNumber: String(ap.maxStations),
        ApBroadcastDisabled: ap.hidden ? '1' : '0',
        ApIsolate: ap.isolate ? '1' : '0',
        ChipIndex: ap.chip,
        AccessPointIndex: ap.index,
      },
      { timeout: 20_000 },
    )
  },

  async clients() {
    return parseClients(
      await goformGet<Record<string, unknown>>(['station_list', 'lan_station_list', 'queryDeviceAccessControlList', 'hostNameList']),
    )
  },

  rename: (mac: string, hostname: string) => goformSet('EDIT_HOSTNAME', { mac, hostname: hostname.trim() }),

  setBlocked: (acl: AccessControl, blocked: BlockedClient[]) => goformSet('setDeviceAccessControlList', blacklistForm(acl, blocked)),
}
