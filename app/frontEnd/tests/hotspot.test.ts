import { describe, expect, it } from 'vitest'

import { guessDevice, isRandomMac } from '../src/model/device-kind'
import { blacklistForm, decodeBase64Utf8, encodeBase64Utf8, parseClients, parseWifi, validWifiPassword, wifiQrPayload, withBand } from '../src/model/hotspot'

describe('Wi-Fi 热点', () => {
  it('密码按 UTF-8 Base64 读写', () => {
    expect(encodeBase64Utf8('12345678')).toBe('MTIzNDU2Nzg=')
    expect(decodeBase64Utf8('MTIzNDU2Nzg=')).toBe('12345678')
    expect(decodeBase64Utf8(encodeBase64Utf8('密码 pass'))).toBe('密码 pass')
  })

  it('响应键是 WiFiModuleSwitch / ResponseList，取启用的主 AP', () => {
    const info = parseWifi({
      WiFiModuleSwitch: '1',
      ResponseList: [
        { AccessPointIndex: '0', ChipIndex: '0', AccessPointSwitchStatus: '0', SSID: 'A', Password: 'MTIzNDU2Nzg=', AuthMode: 'WPA2PSK', ApBroadcastDisabled: 0, ApMaxStationNumber: '10' },
        { AccessPointIndex: '0', ChipIndex: '1', AccessPointSwitchStatus: '1', SSID: 'B-5G', Password: 'MTIzNDU2Nzg=', AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '1', ApMaxStationNumber: '16' },
      ],
    })
    expect(info.active?.ssid).toBe('B-5G')
    expect(info.active?.chip).toBe('1')
    expect(info.active?.hidden).toBe(true)
    expect(info.active?.password).toBe('12345678')
    expect(parseWifi({ WiFiModuleSwitch: '0', ResponseList: [] }).active).toBeNull()
  })

  it('切换频段的乐观显示：关掉就没有当前网络；切到 5G 启用 5G 主网络、停用 2.4G 主网络，访客网络不动', () => {
    const info = parseWifi({
      WiFiModuleSwitch: '1',
      ResponseList: [
        { AccessPointIndex: '0', ChipIndex: '0', AccessPointSwitchStatus: '1', SSID: 'Home', Password: 'MTIzNDU2Nzg=', AuthMode: 'WPA2PSK' },
        { AccessPointIndex: '1', ChipIndex: '0', AccessPointSwitchStatus: '1', SSID: 'Guest', Password: 'MTIzNDU2Nzg=', AuthMode: 'WPA2PSK' },
        { AccessPointIndex: '0', ChipIndex: '1', AccessPointSwitchStatus: '0', SSID: 'Home-5G', Password: 'MTIzNDU2Nzg=', AuthMode: 'WPA2PSK' },
      ],
    })
    expect(info.active?.ssid).toBe('Home')

    const off = withBand(info, 'off')
    expect(off.moduleOn).toBe(false)
    expect(off.active).toBeNull()
    expect(off.aps).toBe(info.aps)

    const five = withBand(off, 'chip2')
    expect(five.moduleOn).toBe(true)
    expect(five.active?.ssid).toBe('Home-5G')
    expect(five.aps.map((ap) => [ap.ssid, ap.enabled])).toEqual([
      ['Home', false],
      ['Guest', true],
      ['Home-5G', true],
    ])

    // 设备没有对应芯片的主网络：不改
    const only24 = parseWifi({ WiFiModuleSwitch: '1', ResponseList: [{ AccessPointIndex: '0', ChipIndex: '0', AccessPointSwitchStatus: '1', SSID: 'A' }] })
    expect(withBand(only24, 'chip2')).toBe(only24)
  })

  it('密码校验：8–63 个可打印字符或 64 位十六进制', () => {
    expect(validWifiPassword('1234567')).toBe(false)
    expect(validWifiPassword('12345678')).toBe(true)
    expect(validWifiPassword('a'.repeat(64))).toBe(true)
    expect(validWifiPassword('z'.repeat(64))).toBe(false)
    expect(validWifiPassword('密码密码密码密码')).toBe(false)
  })

  it('二维码内容转义特殊字符', () => {
    expect(wifiQrPayload({ ssid: 'My;Net', password: 'a:b"c', authMode: 'WPA2PSK', hidden: false })).toBe('WIFI:T:WPA;S:My\\;Net;P:a\\:b\\"c;;')
    expect(wifiQrPayload({ ssid: 'Open', password: '', authMode: 'OPEN', hidden: true })).toBe('WIFI:T:nopass;S:Open;H:true;;')
  })
})

describe('接入设备与黑名单', () => {
  const raw = {
    station_list: [{ hostname: 'iPhone', ip_addr: '192.168.0.101', mac_addr: 'AA:BB:CC:00:00:01' }],
    lan_station_list: [{ hostname: '', ip_addr: '192.168.0.120', mac_addr: 'aa:bb:cc:00:00:02' }],
    devices: [{ mac: 'aa:bb:cc:00:00:01', hostname: '小明的手机' }],
    AclMode: '2',
    BlackMacList: 'aa:bb:cc:00:00:09;aa:bb:cc:00:00:08;',
    BlackNameList: 'Pad;TV;',
    WhiteMacList: '',
    WhiteNameList: '',
  }

  it('改过的名字优先，MAC 统一小写，USB 接入单独标出', () => {
    const { clients } = parseClients(raw)
    expect(clients[0]).toMatchObject({ mac: 'aa:bb:cc:00:00:01', name: '小明的手机', via: 'wifi' })
    expect(clients[1]).toMatchObject({ name: 'aa:bb:cc:00:00:02', via: 'usb' })
  })

  it('解除拉黑时两串按同一顺序生成（修掉原版把 MAC 写进名称列的 bug）', () => {
    const { acl } = parseClients(raw)
    expect(acl.blocked).toEqual([
      { mac: 'aa:bb:cc:00:00:09', name: 'Pad' },
      { mac: 'aa:bb:cc:00:00:08', name: 'TV' },
    ])
    const form = blacklistForm(acl, acl.blocked.filter((item) => item.mac !== 'aa:bb:cc:00:00:09'))
    expect(form).toMatchObject({ AclMode: '2', BlackMacList: 'aa:bb:cc:00:00:08', BlackNameList: 'TV' })
  })
})

describe('guessDevice：按主机名 / MAC / 接入方式配图标', () => {
  const g = (name: string, mac = '54:1f:8d:00:00:01', via: 'wifi' | 'usb' = 'wifi') => {
    const r = guessDevice([name], mac, via)
    return `${r.kind}/${r.platform ?? '-'}`
  }
  it('Apple 家族', () => {
    expect(g('iPhone')).toBe('phone/apple')
    expect(g('zhangsandeiPhone')).toBe('phone/apple')
    expect(g('我的 iPhone')).toBe('phone/apple')
    expect(g('iPad-Air')).toBe('tablet/apple')
    expect(g('MacBook-Air')).toBe('laptop/apple')
    expect(g('KittorsdeAir', '54:1f:8d:0c:86:d7', 'usb')).toBe('laptop/apple')
    expect(g('kittors-mac')).toBe('laptop/apple')
    expect(g('Mac-mini')).toBe('desktop/apple')
    expect(g('Apple-TV')).toBe('tv/apple')
  })
  it('Windows 默认主机名与常见笔记本', () => {
    expect(g('DESKTOP-7Q3K2LM')).toBe('desktop/windows')
    expect(g('LAPTOP-AB12CD34')).toBe('laptop/windows')
    expect(g('ThinkPad-X1')).toBe('laptop/windows')
    expect(g('RedmiBook-Pro')).toBe('laptop/windows')
  })
  it('Android：平板先于手机，华为不标 Android', () => {
    expect(g('android-5f3a0c9e')).toBe('phone/android')
    expect(g('Redmi-K70')).toBe('phone/android')
    expect(g('SM-G9910')).toBe('phone/android')
    expect(g('Redmi-Pad')).toBe('tablet/android')
    expect(g('MatePad-11')).toBe('tablet/android')
    expect(g('HUAWEI-Mate-60')).toBe('phone/-')
  })
  it('电视、游戏机、手表、改过的中文名', () => {
    expect(g('MiTV-4A')).toBe('tv/-')
    expect(g('Living-Room-TV')).toBe('tv/-')
    expect(g('客厅电视')).toBe('tv/-')
    expect(g('PS5-123')).toBe('console/-')
    expect(g('Nintendo-Switch')).toBe('console/-')
    expect(g('Galaxy-Watch6')).toBe('watch/-')
  })
  it('认不出来：USB → 电脑，随机 MAC → 手机，其余未知', () => {
    expect(g('host-1', '54:1f:8d:00:00:02', 'usb')).toBe('laptop/-')
    expect(g('', 'da:a1:19:00:00:01')).toBe('phone/-')
    expect(isRandomMac('da:a1:19:00:00:01')).toBe(true)
    expect(isRandomMac('54:1f:8d:00:00:01')).toBe(false)
    expect(g('host-1')).toBe('unknown/-')
  })
  it('改过的名字和上报的主机名都参与，按规则顺序取第一个命中', () => {
    expect(guessDevice(['爸爸的平板', 'android-1234'], '54:1f:8d:00:00:03', 'wifi')).toEqual({ kind: 'tablet', platform: 'android' })
  })
})
