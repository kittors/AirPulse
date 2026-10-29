import { describe, expect, it } from 'vitest'

import {
  apnSaveForm,
  copyName,
  findCurrentSlot,
  firstEmptySlot,
  linkOf,
  parseApnConfig,
  parseApnState,
  planIpv6,
  type ApnProfile,
  type ApnState,
} from '../src/model/apn'
import { intToIp, ipToInt, MASKS, poolSize, subnetOf, validateLan, type LanConfig } from '../src/model/lan'
import { parseSwitches } from '../src/model/switches'

describe('APN', () => {
  it('解析 ($) 分隔的配置串', () => {
    expect(parseApnConfig('中国移动($)cmnet($)manual($)*99#($)CHAP($)u($)p($)IPv4v6($)auto($)($)auto($)($)', 3)).toEqual({
      slot: 3,
      name: '中国移动',
      apn: 'cmnet',
      auth: 'chap',
      username: 'u',
      password: 'p',
      pdp: 'IPv4v6',
    })
    expect(parseApnConfig('', 0)).toBeNull()
    expect(parseApnConfig('x($)y', 1)?.pdp).toBe('IP')
  })

  it('新增用第一个空槽，当前配置按名称 + APN 匹配', () => {
    const p = (slot: number, name: string, apn: string): ApnProfile => ({ slot, name, apn, auth: 'none', username: '', password: '', pdp: 'IP' })
    const list = [p(0, 'A', 'a'), p(2, 'B', 'b'), p(5, 'B', 'c')]
    expect(firstEmptySlot(list)).toBe(1)
    expect(findCurrentSlot(list, { name: 'B', apn: 'c', index: '' })).toBe(5)
    expect(findCurrentSlot(list, { name: 'B', apn: '', index: '5' })).toBe(5)
    expect(findCurrentSlot(list, { name: 'Z', apn: 'z', index: '' })).toBeNull()
  })

  it('按 PDP 类型带上 IPv4 / IPv6 两组字段', () => {
    const draft = { name: 'n', apn: 'a', auth: 'pap' as const, username: 'u', password: 'p' }
    const v4 = apnSaveForm({ ...draft, pdp: 'IP' }, 2)
    expect(v4.index).toBe('2')
    expect(v4.wan_apn).toBe('a')
    expect(v4.ipv6_wan_apn).toBeUndefined()
    const both = apnSaveForm({ ...draft, pdp: 'IPv4v6' }, 0)
    expect(both.ppp_auth_mode).toBe('pap')
    expect(both.ipv6_ppp_passwd).toBe('p')
  })
})

/** 真机（F50，联通卡，自动 APN）读回的那一包：只要请求里有 APN_config*，别的字段一概不回 */
const F50_BUNDLE: Record<string, unknown> = {
  APN_config0: 'default($)default($)manual($)($)($)($)($)($)($)($)($)($)',
  APN_config1: '',
  apn_auto_config: 'UNICOM($)3gnet($)manual($)*99#($)pap($)($)($)IPv4v6($)($)($)($)($)',
  apn_mode: 'auto',
  apn_select: 'manual',
  default_APN_size: 1,
  ipv6_pdp_type: 'IPv4v6',
  ipv6_wan_apn: '3gnet',
  m_profile_name: 'UNICOM',
  pdp_type: 'IPv4v6',
  ppp_auth_mode: 'pap',
  profile_name: 'UNICOM',
  wan_apn: '3gnet',
  wan_dial: '*99#',
  Current_index: '',
  ppp_status: 'ipv4_ipv6_connected',
}

describe('APN 状态与 IPv6 开关', () => {
  it('按真机的字段读出当前 APN、预设条数和运营商配置', () => {
    const state = parseApnState(F50_BUNDLE)
    expect(state.mode).toBe('auto')
    expect(state.current).toEqual({ name: 'UNICOM', apn: '3gnet' })
    expect(state.presetCount).toBe(1)
    expect(state.auto).toEqual({ name: 'UNICOM', apn: '3gnet', auth: 'pap', username: '', password: '', pdp: 'IPv4v6' })
    expect(state.pdp).toBe('IPv4v6')
    expect(state.link).toBe('dual')
    expect(state.profiles.map((p) => p.slot)).toEqual([0])
  })

  it('apn_interface_version ≥ 2 时读 *_ui 字段', () => {
    const state = parseApnState({ apn_interface_version: '2', apn_mode: 'auto', profile_name_ui: 'CMCC', wan_apn_ui: 'cmnet', pdp_type_ui: 'IP' })
    expect(state.current).toEqual({ name: 'CMCC', apn: 'cmnet' })
    expect(state.pdp).toBe('IP')
  })

  it('ppp_status 换算成实际拿到的地址', () => {
    expect(linkOf('ipv4_ipv6_connected')).toBe('dual')
    expect(linkOf('ppp_connected')).toBe('ipv4')
    expect(linkOf('ipv6_connected')).toBe('ipv6')
    expect(linkOf('ppp_connecting')).toBe('busy')
    expect(linkOf('ppp_disconnecting')).toBe('busy')
    expect(linkOf('ppp_disconnected')).toBe('down')
    expect(linkOf('')).toBe('down')
  })

  it('自动模式下关 IPv6：照着运营商配置新建一条仅 IPv4 的配置', () => {
    const state = parseApnState(F50_BUNDLE)
    expect(planIpv6(state, false)).toEqual({
      kind: 'save',
      slot: 1,
      created: true,
      draft: { name: 'UNICOM IPv4', apn: '3gnet', auth: 'pap', username: '', password: '', pdp: 'IP' },
    })
  })

  it('已经有一样的仅 IPv4 配置时直接改用它，不重复新建', () => {
    const state = parseApnState({ ...F50_BUNDLE, APN_config3: '联通 v4($)3gnet($)manual($)*99#($)pap($)($)($)IP($)($)($)($)($)' })
    expect(planIpv6(state, false)).toMatchObject({ kind: 'use', slot: 3 })
  })

  it('用着复制出来的那条时开 IPv6：回到自动选择', () => {
    const state: ApnState = parseApnState({
      ...F50_BUNDLE,
      apn_mode: 'manual',
      APN_config1: 'UNICOM IPv4($)3gnet($)manual($)*99#($)pap($)($)($)IP($)($)($)($)($)',
      m_profile_name: 'UNICOM IPv4',
      profile_name: 'UNICOM IPv4',
      Current_index: '1',
      pdp_type: 'IP',
    })
    expect(state.currentSlot).toBe(1)
    expect(state.pdp).toBe('IP')
    expect(planIpv6(state, true)).toEqual({ kind: 'auto' })
  })

  it('手动模式下用自己的配置：直接改它的 IP 类型', () => {
    const state = parseApnState({
      ...F50_BUNDLE,
      apn_mode: 'manual',
      APN_config2: '公司($)vpdn.example($)manual($)*99#($)chap($)u($)p($)IPv4v6($)($)($)($)($)',
      m_profile_name: '公司',
      profile_name: '公司',
      wan_apn: 'vpdn.example',
      Current_index: '2',
    })
    expect(planIpv6(state, false)).toEqual({
      kind: 'save',
      slot: 2,
      created: false,
      draft: { name: '公司', apn: 'vpdn.example', auth: 'chap', username: 'u', password: 'p', pdp: 'IP' },
    })
  })

  it('配置位满了、读不到当前配置时给出原因', () => {
    const full = Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`APN_config${i}`, `p${i}($)apn${i}($)`]))
    expect(planIpv6(parseApnState({ ...F50_BUNDLE, ...full }), false)).toEqual({ kind: 'full' })
    expect(planIpv6(parseApnState({ apn_mode: 'auto' }), false)).toEqual({ kind: 'unknown' })
  })

  it('复制品名称超长时截断原名', () => {
    expect(copyName('一'.repeat(40), 'IP')).toHaveLength(32)
    expect(copyName('UNICOM', 'IPv4v6')).toBe('UNICOM IPv4v6')
  })
})

describe('局域网', () => {
  const base: LanConfig = { ip: '192.168.0.1', mask: '255.255.255.0', dhcp: true, start: '192.168.0.100', end: '192.168.0.200', lease: '24' }

  it('地址换算用无符号整数', () => {
    expect(ipToInt('255.255.255.255')).toBe(4294967295)
    expect(intToIp(ipToInt('200.1.2.3')!)).toBe('200.1.2.3')
    expect(ipToInt('192.168.01.1')).toBeNull()
    expect(ipToInt('256.0.0.1')).toBeNull()
    expect(MASKS[0]).toEqual({ bits: 8, mask: '255.0.0.0' })
    expect(MASKS.at(-1)).toEqual({ bits: 30, mask: '255.255.255.252' })
    expect(subnetOf('10.1.2.3', '255.255.0.0')).toEqual({ network: ipToInt('10.1.0.0'), broadcast: ipToInt('10.1.255.255'), hosts: 65534, prefix: 16 })
  })

  it('合法配置没有错误，网关在 .254 而地址池在前面也合法', () => {
    expect(validateLan(base)).toEqual({})
    expect(validateLan({ ...base, ip: '192.168.0.254', start: '192.168.0.2', end: '192.168.0.200' })).toEqual({})
    expect(validateLan({ ...base, dhcp: false, start: '', end: '', lease: '' })).toEqual({})
  })

  it('逐项报错', () => {
    expect(validateLan({ ...base, ip: '192.168.0.0' }).ip).toBe('ipEdge')
    expect(validateLan({ ...base, mask: '255.255.255.1' }).mask).toBe('mask')
    expect(validateLan({ ...base, start: '192.168.1.10' }).start).toBe('startSubnet')
    expect(validateLan({ ...base, end: '192.168.0.255' }).end).toBe('endEdge')
    expect(validateLan({ ...base, start: '192.168.0.200', end: '192.168.0.100' }).end).toBe('order')
    expect(validateLan({ ...base, ip: '192.168.0.150' }).start).toBe('gatewayInPool')
    expect(validateLan({ ...base, lease: '0' }).lease).toBe('lease')
    expect(poolSize('192.168.0.100', '192.168.0.200')).toBe(101)
  })
})

describe('移动数据状态', () => {
  const ppp = (value: string) => parseSwitches({ ppp_status: value })
  it('只有已断开才算关；过渡态按正在去的方向算', () => {
    expect(ppp('ppp_connected')).toMatchObject({ dataConnected: true, dataTransition: null })
    expect(ppp('ipv4_ipv6_connected')).toMatchObject({ dataConnected: true, dataTransition: null })
    expect(ppp('ppp_disconnected')).toMatchObject({ dataConnected: false, dataTransition: null })
    expect(ppp('ppp_connecting')).toMatchObject({ dataConnected: true, dataTransition: 'connecting' })
    expect(ppp('ppp_disconnecting')).toMatchObject({ dataConnected: false, dataTransition: 'disconnecting' })
    expect(ppp('')).toMatchObject({ dataConnected: false, dataTransition: null })
  })
})
