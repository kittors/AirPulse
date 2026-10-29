/**
 * Mock：APN（goformId=APN_PROC_EX）与局域网 / DHCP（goformId=DHCP_SETTING），
 * 格式照 docs/legacy-network-sms.md §4.1、§4.6 与附录 A.4 / A.5。
 *
 * APN_config<i> 每个字段后面都跟一个「($)」：
 *   0 名称 1 APN 2 apn_select 3 拨号号码 4 鉴权 5 用户名 6 密码 7 PDP 8 pdp_select 9 pdp_addr 10 dns_mode 11 首选 DNS 12 备用 DNS
 * 初始：自动模式（运营商配置「中国移动 cmnet」，同真机放在 apn_auto_config），槽 0 是预设，槽 1 空着，槽 2 是一条自定义配置——用来测「下拉序号 ≠ 槽位号」。
 * 读法照真机：请求里只要有 APN_config*，就回一整包 APN 字段（见 bundle）。
 */

export interface NetworkDeps {
  /** 整机重启（DHCP 设置要重启才生效） */
  reboot(): void
  /** 换 APN 后数据连接重拨，协议栈短暂断开 */
  redial(ms: number): void
}

const SLOTS = 20
const pack = (fields: string[]) => fields.map((field) => `${field}($)`).join('')
const isIp = (value: string | undefined) => /^(25[0-5]|2[0-4]\d|1?\d?\d)(\.(25[0-5]|2[0-4]\d|1?\d?\d)){3}$/.test(value ?? '')

const CMNET = pack(['中国移动', 'cmnet', 'auto', '*99#', 'none', '', '', 'IPv4v6', 'auto', '', 'auto', '', ''])
/** 按 SIM 卡匹配到的运营商配置：真机的格式（apn_select 是 manual，后面几段空着） */
const AUTO = pack(['中国移动', 'cmnet', 'manual', '*99#', 'none', '', '', 'IPv4v6', '', '', '', '', ''])
const VPDN = pack(['专网', 'vpdn.example', 'manual', '*99#', 'chap', 'user01', 'pass01', 'IPv4v6', 'auto', '', 'auto', '', ''])

export class MockNetwork {
  private readonly deps: NetworkDeps
  private apnMode: 'auto' | 'manual' = 'auto'
  /** 前 N 个槽位是运营商预设，固件不让改 / 删【推断】 */
  private readonly preset = 1
  private configs = Array.from({ length: SLOTS }, (_, i) => (i === 0 ? CMNET : i === 2 ? VPDN : ''))
  private ipv6Configs = Array.from({ length: SLOTS }, (_, i) => (i === 0 ? CMNET : i === 2 ? VPDN : ''))
  /** 手动模式下正在使用的槽位 */
  private current = 0
  /** 设为默认时设备记下的 IP 类型（官方后台随 set_default 一起提交 pdp_type） */
  private pdpNv = 'IPv4v6'
  private lan = { ip: '192.168.0.1', mask: '255.255.255.0', dhcp: '1', start: '192.168.0.100', end: '192.168.0.200', lease: '24' }

  constructor(deps: NetworkDeps) {
    this.deps = deps
  }

  lanIp(): string {
    return this.lan.ip
  }

  /** 正在使用的 IP 类型 */
  pdpType(): string {
    return this.apnMode === 'auto' ? (AUTO.split('($)')[7] ?? 'IP') : this.pdpNv
  }

  /** 数据连接会不会拿到 IPv6（决定 ppp_status 与 ipv6_wan_ipaddr） */
  hasIpv6(): boolean {
    const pdp = this.pdpType().toLowerCase()
    return pdp === 'ipv6' || pdp === 'ipv4v6'
  }

  /** 真机：请求里只要有 APN_config*，就回这一整包，别的 cmd 一概不回（见 src/model/apn parseApnState） */
  bundle(): Record<string, string | number> {
    const auto = this.apnMode === 'auto'
    const v4 = (auto ? AUTO : (this.configs[this.current] ?? '')).split('($)')
    const at = (i: number) => v4[i] ?? ''
    const v6 = this.hasIpv6()
    const out: Record<string, string | number> = {
      apn_interface_version: '',
      apn_mode: this.apnMode,
      apn_select: 'manual',
      default_APN_size: this.preset,
      apn_auto_config: AUTO,
      ipv6_apn_auto_config: '',
      Current_index: auto ? '' : String(this.current),
      index: '',
      m_profile_name: at(0),
      profile_name: at(0),
      wan_apn: at(1),
      wan_dial: at(3) || '*99#',
      ppp_auth_mode: at(4),
      ppp_username: at(5),
      ppp_passwd: at(6),
      pdp_type: this.pdpType(),
      pdp_select: '',
      pdp_addr: '',
      dns_mode: '',
      prefer_dns_manual: '',
      standby_dns_manual: '',
      ipv6_wan_apn: v6 ? at(1) : '',
      ipv6_pdp_type: this.pdpType(),
      ipv6_ppp_auth_mode: v6 ? at(4) : '',
      ipv6_ppp_username: v6 ? at(5) : '',
      ipv6_ppp_passwd: v6 ? at(6) : '',
      ipv6_dns_mode: '',
      ipv6_prefer_dns_manual: '',
      ipv6_standby_dns_manual: '',
    }
    for (let i = 0; i < SLOTS; i++) {
      out[`APN_config${i}`] = this.configs[i]
      out[`ipv6_APN_config${i}`] = this.ipv6Configs[i]
    }
    return out
  }

  /** goform 读：认识的字段返回值，不认识返回 undefined */
  read(cmd: string): string | number | undefined {
    const apn = this.bundle()
    if (cmd in apn) return apn[cmd]
    const fields: Record<string, string> = {
      lan_ipaddr: this.lan.ip,
      lan_netmask: this.lan.mask,
      dhcpEnabled: this.lan.dhcp,
      dhcpStart: this.lan.start,
      dhcpEnd: this.lan.end,
      dhcpLease_hour: `${this.lan.lease}h`,
      mtu: '1500',
      tcp_mss: '1460',
    }
    return fields[cmd]
  }

  /** goform 写：认识的 goformId 处理并返回 true；固件拒绝时抛错（设备返回 failure） */
  write(id: string, form: Record<string, string>): boolean {
    switch (id) {
      case 'APN_PROC_EX':
        this.apn(form)
        return true
      case 'DHCP_SETTING': {
        const server = form.lanDhcpType === 'SERVER'
        const lease = Number(form.dhcpLease)
        if (!isIp(form.lanIp) || !isIp(form.lanNetmask)) throw new Error('failure')
        if (server && (!isIp(form.dhcpStart) || !isIp(form.dhcpEnd) || !(Number.isInteger(lease) && lease > 0))) throw new Error('failure')
        // DHCP 关闭时表单里地址池和租期是空串：沿用原值【推断】
        this.lan = {
          ip: form.lanIp,
          mask: form.lanNetmask,
          dhcp: server ? '1' : '0',
          start: server ? form.dhcpStart : this.lan.start,
          end: server ? form.dhcpEnd : this.lan.end,
          lease: server ? String(lease) : this.lan.lease,
        }
        if (form.dhcp_reboot_flag === '1') this.deps.reboot()
        return true
      }
      default:
        return false
    }
  }

  private apn(form: Record<string, string>) {
    const action = form.apn_action
    if (!action) {
      // 只带 apn_mode：切自动（按 SIM 用回运营商预设）或切手动
      if (form.apn_mode === 'auto') {
        this.apnMode = 'auto'
        this.deps.redial(3_000)
      } else if (form.apn_mode === 'manual') {
        this.apnMode = 'manual'
      }
      return
    }
    const index = Number(form.index)
    if (!Number.isInteger(index) || index < 0 || index >= SLOTS) throw new Error('failure')
    switch (action) {
      case 'save': {
        if (index < this.preset) throw new Error('failure')
        const name = (form.profile_name ?? '').trim()
        // IPv6 组只在 PDP 为 IPv6 / IPv4v6 时提交；仅 IPv6 时列表里显示 IPv6 组的 APN
        const pdp = form.apn_pdp_type || form.pdp_type || 'IP'
        const v6 = pdp !== 'IP'
        const apn = form.apn_wan_apn ?? form.wan_apn ?? form.apn_ipv6_wan_apn ?? ''
        if (!name || !apn.trim()) throw new Error('failure')
        const common = [form.apn_select ?? 'manual', form.apn_wan_dial ?? form.wan_dial ?? '*99#']
        const tail = [pdp, form.apn_pdp_select ?? 'auto', form.apn_pdp_addr ?? '']
        const v4Auth = [form.apn_ppp_auth_mode ?? form.apn_ipv6_ppp_auth_mode ?? 'none', form.apn_ppp_username ?? form.apn_ipv6_ppp_username ?? '', form.apn_ppp_passwd ?? form.apn_ipv6_ppp_passwd ?? '']
        this.configs[index] = pack([name, apn, ...common, ...v4Auth, ...tail, form.dns_mode ?? 'auto', form.prefer_dns_manual ?? '', form.standby_dns_manual ?? ''])
        this.ipv6Configs[index] = v6
          ? pack([
              name,
              form.apn_ipv6_wan_apn ?? apn,
              ...common,
              form.apn_ipv6_ppp_auth_mode ?? v4Auth[0],
              form.apn_ipv6_ppp_username ?? v4Auth[1],
              form.apn_ipv6_ppp_passwd ?? v4Auth[2],
              ...tail,
              form.ipv6_dns_mode ?? 'auto',
              form.ipv6_prefer_dns_manual ?? '',
              form.ipv6_standby_dns_manual ?? '',
            ])
          : ''
        return
      }
      case 'delete':
        // 预设不能删；手动模式下正在使用的配置也不能删【推断】
        if (index < this.preset || (this.apnMode === 'manual' && index === this.current)) throw new Error('failure')
        this.configs[index] = ''
        this.ipv6Configs[index] = ''
        return
      case 'set_default':
        if (!this.configs[index]) throw new Error('failure')
        this.apnMode = 'manual'
        this.current = index
        // 不带 pdp_type 时设备沿用之前的 IP 类型【推断】
        if (form.pdp_type) this.pdpNv = form.pdp_type
        this.deps.redial(3_000)
        return
      default:
        throw new Error('failure')
    }
  }
}
