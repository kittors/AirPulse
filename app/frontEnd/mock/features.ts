import { createHash } from 'node:crypto'

import { MockAdvanced } from './advanced'
import { createStorage, MockFiles } from './files'
import { MockForward } from './forward'
import { fail, ok, optBoolean, optString, orgJsonError, type ApiRequest, type ApiResult, type Json } from './http'
import { MockNetwork } from './network'
import { MockTools } from './tools'

/**
 * Mock：第二阶段各功能（流量、热点、网络、短信转发、工具……）的状态与接口。
 * 设备主体（mock/device.ts）把自己不认识的 goform 字段 / goformId / /api 路径 / AT 指令转给这里，
 * 这样每个功能的模拟数据都集中在一处，接口格式照 docs/legacy-*.md。
 */

export interface MockHost {
  /** 官方后台统计的本月已用（字节）读写 */
  getUsed(): number
  setUsed(bytes: number): void
  /** 设备管理密码（明文，校验 CHANGE_PASSWORD 用） */
  getAdminPassword(): string
  setAdminPassword(password: string): void
  /** 整机重启：一段时间内断网 */
  reboot(ms: number): void
  /** 协议栈重启 / 数据重拨（切卡、换 APN）：一段时间内断网 */
  restartRadio(ms: number): void
  setNickname(name: string): void
  /** 型号、IMEI、IMSI、固件版本 */
  identity(): { model: string; imei: string; imsi: string; crVersion: string }
  /** 当前有没有数据连接 */
  online(): boolean
  /** 排队执行一条 AT（VoLTE / VoNR 接口在后端也是发 AT）；执行失败为 null */
  runAt(command: string, slot: number): Promise<string | null>
}

const SHA = (text: string) => createHash('sha256').update(text).digest('hex').toUpperCase()
const b64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

/** 重启期间断网的时长 */
const REBOOT_MS = 25_000
/** 整机重启时 App 的 HTTP 服务也跟着没了：发出重启后约 1.5 s 开始、持续 18 s 连不上（真机更久，这里缩短方便调试） */
const HTTP_DOWN_DELAY_MS = 1_500
const HTTP_DOWN_MS = 18_000
/** Wi-Fi 开关 / 换频段：接口回成功后，读到新状态前的延迟（真机录屏约 2–3 s） */
const WIFI_SETTLE_MS = 2_500

export class MockFeatures {
  private readonly host: MockHost
  private readonly storage = createStorage()
  private readonly advanced: MockAdvanced
  private readonly files: MockFiles
  private readonly tools: MockTools
  private readonly forward = new MockForward()
  private readonly network: MockNetwork

  constructor(host: MockHost) {
    this.host = host
    this.network = new MockNetwork({ reboot: () => this.reboot(), redial: (ms) => host.restartRadio(ms) })
    this.advanced = new MockAdvanced({
      storage: this.storage,
      identity: () => host.identity(),
      lanIp: () => this.network.lanIp(),
      sambaOn: () => this.switches.samba_switch === '1',
      reboot: () => this.reboot(),
    })
    this.files = new MockFiles(this.storage, { rootReady: () => this.advanced.rootReady(), adbReady: () => this.advanced.adbReady() })
    this.tools = new MockTools({ online: () => host.online() })
  }

  /** 当前 App 版本（OTA 安装成功后会变） */
  version() {
    return this.files.version()
  }

  /** OTA 安装后 App 进程重启、整机重启：这段时间所有请求直接断开 */
  offline(): boolean {
    const now = Date.now()
    return this.files.offline() || (now >= this.httpDown.from && now < this.httpDown.until)
  }

  private httpDown = { from: 0, until: 0 }

  /** 整机重启：断网一段时间；iptables、root shell、ADB 跟着重来 */
  private reboot() {
    this.host.reboot(REBOOT_MS)
    this.advanced.rebooted(REBOOT_MS)
    const from = Date.now() + HTTP_DOWN_DELAY_MS
    this.httpDown = { from, until: from + HTTP_DOWN_MS }
  }

  /* —— 流量 —— */
  private plan: Record<string, string> = {
    data_volume_limit_switch: '1',
    data_volume_limit_unit: 'data',
    data_volume_limit_size: '200_1024',
    data_volume_alert_percent: '80',
    traffic_clear_date: '1',
    wan_auto_clear_flow_data_switch: 'on',
  }
  private guard: Json = {
    data_flow_limit_enabled: '0',
    data_flow_max_limit: -1,
    data_flow_check_daily_or_monthly: 'monthly',
    data_check_reference: 'android',
    data_limit_status_forward_enabled: '0',
  }
  /** 逐日用量：按日期固定生成，刷新不变 */
  private dailyUsage(start: number, end: number) {
    const out: { date: string; usage: string }[] = []
    const day = new Date(start)
    day.setHours(0, 0, 0, 0)
    while (day.getTime() <= end) {
      // 伪随机但按日期固定：工作日多一些，周末少一些
      const noise = Math.abs(Math.sin(day.getDate() * 12.9898 + day.getMonth() * 78.233) * 43758.5453) % 1
      const weekend = day.getDay() === 0 || day.getDay() === 6
      const gb = (weekend ? 0.8 : 1.6) + noise * 2.6
      const isToday = new Date().toDateString() === day.toDateString()
      const bytes = Math.round(gb * 1024 ** 3 * (isToday ? 0.4 : 1))
      const pad = (n: number) => String(n).padStart(2, '0')
      out.push({ date: `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`, usage: String(bytes) })
      day.setDate(day.getDate() + 1)
    }
    return out
  }

  /* —— 设备与网络开关 —— */
  private switches: Record<string, string> = {
    performance_mode: '0',
    usb_network_protocal: '1',
    usb_port_switch: '0',
    sim_slot: '0',
    samba_switch: '0',
    roam_setting_option: 'off',
    dial_roam_setting_option: 'off',
    indicator_light_switch: '1',
    restart_schedule_switch: '0',
    restart_time: '03:00',
    sleep_sysIdleTimeToSleep: '-1',
    is_support_nfc_functions: '0',
    web_wifi_nfc_switch: '0',
  }
  /** 后端调试日志开关，读回来是字符串 "true" / "false"；唤醒锁只有写接口，没有读取接口 */
  private debugLog = 'false'

  /* —— Wi-Fi 与接入设备 —— */
  private wifiOn = '1'
  private aps = [
    { AccessPointIndex: '0', ChipIndex: '0', AccessPointSwitchStatus: '0', SSID: 'ZTE-F50-2.4G', Password: b64('12345678'), AuthMode: 'WPA2PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '10', ApIsolate: '0' },
    { AccessPointIndex: '0', ChipIndex: '1', AccessPointSwitchStatus: '1', SSID: 'AirPulse-5G', Password: b64('pulse2026'), AuthMode: 'WPA2PSKWPA3PSK', ApBroadcastDisabled: '0', ApMaxStationNumber: '16', ApIsolate: '0' },
  ]
  private stations = [
    { hostname: 'iPhone', ip_addr: '192.168.0.101', mac_addr: 'A4:83:E7:12:34:01' },
    { hostname: 'MacBook-Air', ip_addr: '192.168.0.102', mac_addr: 'F0:18:98:56:78:02' },
    { hostname: 'android-5f3a9c', ip_addr: '192.168.0.105', mac_addr: '3C:28:6D:9A:BC:03' },
  ]
  private lanStations = [{ hostname: 'kittors-mac', ip_addr: '192.168.0.253', mac_addr: '02:00:00:00:00:fe' }]
  private hostNames: { mac: string; hostname: string }[] = [{ mac: 'a4:83:e7:12:34:01', hostname: '我的 iPhone' }]
  private acl = { AclMode: '2', WhiteMacList: '', WhiteNameList: '', BlackMacList: '9c:2e:a1:00:11:22', BlackNameList: 'Redmi-Pad' }

  /** 有些 cmd 的响应键不是 cmd 名（例如 Wi-Fi 是 WiFiModuleSwitch + ResponseList），直接写进 out；处理了返回 true */
  /** 当前 APN 的 IP 类型带不带 IPv6（数据连接的 ppp_status、ipv6_wan_ipaddr 跟着变） */
  apnHasIpv6(): boolean {
    return this.network.hasIpv6()
  }

  readInto(cmd: string, out: Record<string, unknown>): boolean {
    // 真机：请求里有 APN_config* 就回一整包 APN 字段
    if (/^(ipv6_)?APN_config\d+$/.test(cmd)) {
      Object.assign(out, this.network.bundle())
      return true
    }
    switch (cmd) {
      case 'queryWiFiModuleSwitch':
        out.WiFiModuleSwitch = this.wifiOn
        return true
      case 'queryAccessPointInfo':
        out.ResponseList = this.aps.map((ap) => ({ ...ap, QrImageUrl: '/img/qrcode.png' }))
        return true
      case 'station_list': {
        const blocked = this.acl.BlackMacList.toLowerCase().split(';')
        out.station_list = this.wifiOn === '1' ? this.stations.filter((st) => !blocked.includes(st.mac_addr.toLowerCase())) : []
        return true
      }
      case 'lan_station_list':
        out.lan_station_list = this.lanStations
        return true
      case 'queryDeviceAccessControlList':
        Object.assign(out, this.acl)
        return true
      case 'hostNameList':
        out.devices = this.hostNames
        return true
      default:
        return false
    }
  }

  /* —— IMS 与高铁模式（按卡槽，经 AT 读写） —— */
  private ims = { volte: [true, true], vonr: [false, false] }
  /** AT+SP5GCMDS="set nr param",35：重启生效，读回的是已保存的值 */
  private highRail = [false, false]

  /** 设备主体不处理的 AT（已转大写）：串号、IMSI、基带版本、IMS、高铁模式；不认识的返回 null */
  at(cmd: string, slot: number): string | null {
    const index = slot === 1 ? 1 : 0
    const { imei, imsi, crVersion } = this.host.identity()
    if (cmd === 'AT+CGSN') return `${index ? imei.replace(/\d$/, (d) => String((Number(d) + 1) % 10)) : imei} OK`
    // 单卡机型：卡槽 1 没有卡
    if (cmd === 'AT+CIMI') return index ? '+CME ERROR: 10' : `${imsi} OK`
    // 基带版本的真实格式未知（文档 C.1 也是占位）【推断】
    if (cmd === 'AT+CGMR') return `T760_${crVersion} OK`
    if (cmd === 'AT+CAVIMS?') return `+CAVIMS: ${Number(this.ims.volte[index])} OK`
    const cavims = /^AT\+CAVIMS=([01])$/.exec(cmd)
    if (cavims) {
      this.ims.volte[index] = cavims[1] === '1'
      return ' OK'
    }
    // 42 = VoNR、44 = 高铁模式；响应里带引号，第 3 段是取值
    const get = /^AT\+SP5GCMDS="GET NR SYNCH_PARAM",(42|44)$/.exec(cmd)
    if (get) return `+SP5GCMDS: "get nr synch_param",${get[1]},${Number(get[1] === '42' ? this.ims.vonr[index] : this.highRail[index])} OK`
    const set = /^AT\+SP5GCMDS="SET NR PARAM",(45|35),([01])$/.exec(cmd)
    if (set) {
      const target = set[1] === '45' ? this.ims.vonr : this.highRail
      target[index] = set[2] === '1'
      return ' OK'
    }
    return null
  }

  /** goform 读：认识的字段返回值，不认识返回 undefined */
  read(cmd: string): unknown {
    if (cmd in this.switches) return this.switches[cmd]
    if (cmd in this.plan) return this.plan[cmd]
    const network = this.network.read(cmd)
    if (network !== undefined) return network
    if (cmd.startsWith('flux_')) {
      const map: Record<string, string> = {
        flux_data_volume_limit_switch: 'data_volume_limit_switch',
        flux_data_volume_limit_size: 'data_volume_limit_size',
        flux_data_volume_alert_percent: 'data_volume_alert_percent',
        flux_auto_clear_flow_data_switch: 'wan_auto_clear_flow_data_switch',
        flux_clear_date: 'traffic_clear_date',
      }
      if (map[cmd]) return this.plan[map[cmd]]
    }
    return undefined
  }

  /** goform 写：认识的 goformId 处理并返回 true；固件拒绝时抛错（设备返回 failure） */
  write(id: string, form: Record<string, string>): boolean {
    switch (id) {
      case 'DATA_LIMIT_SETTING':
        for (const key of Object.keys(this.plan)) if (form[key] !== undefined) this.plan[key] = form[key]
        return true
      case 'FLOW_CALIBRATION_MANUAL':
        this.host.setUsed(Number(form.data) || 0)
        return true
      // 真机的 Wi-Fi 切换是异步的：接口先回成功，读回来的状态要再过两三秒才变
      case 'switchWiFiModule': {
        const on = form.SwitchOption === '1' ? '1' : '0'
        setTimeout(() => (this.wifiOn = on), WIFI_SETTLE_MS)
        return true
      }
      case 'switchWiFiChip': {
        const chip = form.ChipEnum === 'chip1' ? '0' : '1'
        setTimeout(() => {
          this.wifiOn = '1'
          for (const ap of this.aps) ap.AccessPointSwitchStatus = ap.ChipIndex === chip ? '1' : '0'
        }, WIFI_SETTLE_MS)
        return true
      }
      case 'setAccessPointInfo': {
        const ap = this.aps.find((item) => item.ChipIndex === String(form.ChipIndex ?? '0') && item.AccessPointIndex === String(form.AccessPointIndex ?? '0'))
        if (!ap) return true
        ap.SSID = form.SSID ?? ap.SSID
        ap.AuthMode = form.AuthMode ?? ap.AuthMode
        if (form.Password !== undefined) ap.Password = form.Password
        ap.ApBroadcastDisabled = form.ApBroadcastDisabled ?? ap.ApBroadcastDisabled
        ap.ApMaxStationNumber = form.ApMaxStationNumber ?? ap.ApMaxStationNumber
        ap.ApIsolate = form.ApIsolate ?? ap.ApIsolate
        return true
      }
      case 'EDIT_HOSTNAME': {
        const mac = String(form.mac ?? '').toLowerCase()
        this.hostNames = [...this.hostNames.filter((item) => item.mac !== mac), { mac, hostname: form.hostname ?? '' }]
        return true
      }
      case 'setDeviceAccessControlList':
        this.acl = {
          AclMode: form.AclMode ?? this.acl.AclMode,
          WhiteMacList: form.WhiteMacList ?? '',
          WhiteNameList: form.WhiteNameList ?? '',
          BlackMacList: form.BlackMacList ?? '',
          BlackNameList: form.BlackNameList ?? '',
        }
        return true
      case 'PERFORMANCE_MODE_SETTING':
        this.switches.performance_mode = form.performance_mode ?? '0'
        return true
      case 'INDICATOR_LIGHT_SETTING':
        this.switches.indicator_light_switch = form.indicator_light_switch ?? '1'
        return true
      case 'RESTART_SCHEDULE_SETTING':
        this.switches.restart_schedule_switch = form.restart_schedule_switch ?? '0'
        if (form.restart_time) this.switches.restart_time = form.restart_time
        return true
      case 'SET_WIFI_SLEEP_INFO':
        this.switches.sleep_sysIdleTimeToSleep = form.sleep_sysIdleTimeToSleep ?? '-1'
        return true
      case 'WIFI_NFC_SET':
        this.switches.web_wifi_nfc_switch = form.web_wifi_nfc_switch ?? '0'
        return true
      case 'SET_USB_NETWORK_PROTOCAL':
        // 0 自动、1 RNDIS、2 CDC-ECM；重启后才生效，这里只存值
        this.switches.usb_network_protocal = form.usb_network_protocal ?? '1'
        return true
      case 'USB_PORT_SETTING':
        this.switches.usb_port_switch = form.usb_port_switch ?? '0'
        return true
      case 'SET_SIM_SLOT':
        // 切卡后重新注册网络，短暂无服务【推断】
        this.switches.sim_slot = form.sim_slot ?? '0'
        this.host.restartRadio(8_000)
        return true
      case 'SAMBA_SETTING':
        this.switches.samba_switch = form.samba_switch ?? '0'
        return true
      case 'SET_CONNECTION_MODE':
        this.switches.roam_setting_option = form.roam_setting_option ?? 'off'
        this.switches.dial_roam_setting_option = form.dial_roam_setting_option ?? form.roam_setting_option ?? 'off'
        return true
      case 'CHANGE_PASSWORD':
        if (form.oldPassword !== SHA(this.host.getAdminPassword())) throw new Error('wrong-password')
        // 新密码只拿得到哈希：模拟设备上接受任何新密码，统一记成 admin2
        this.host.setAdminPassword('admin2')
        return true
      case 'REBOOT_DEVICE':
      case 'SHUTDOWN_DEVICE':
        this.reboot()
        return true
      default:
        // APN_PROC_EX、DHCP_SETTING
        return this.network.write(id, form)
    }
  }

  /** /api 路径：认识的返回结果，不认识返回 null */
  async api(req: ApiRequest): Promise<ApiResult | null> {
    const body = req.json ?? {}
    switch (req.path) {
      case '/api/set_nickname':
        // 空串恢复为型号（version_info 里体现）
        this.host.setNickname(optString(body.nickname).trim().slice(0, 255))
        return ok()
      case '/api/get_log_status':
        return ok({ debug_log_enabled: this.debugLog })
      case '/api/set_log_status':
      case '/api/set_wakelock_status':
        // body 不是 JSON 对象时 500，error 是 org.json 的异常文本
        if (!req.json) return fail(orgJsonError(req.text))
        if (req.path === '/api/set_log_status') this.debugLog = String(optBoolean(req.json.debug_log_enabled, false))
        return ok()
      case '/api/volte_status':
      case '/api/vonr_status':
        return this.imsStatus(req)
      case '/api/get_data_limit':
        return ok(this.guard)
      case '/api/set_data_limit': {
        const max = Number(body.data_flow_max_limit)
        this.guard = { ...this.guard, ...body, data_flow_max_limit: max > 0 ? max : -1 }
        return ok()
      }
      case '/api/cellularUsage': {
        const start = Number(req.query.get('startTime'))
        const end = Number(req.query.get('endTime'))
        if (!start || !end) return fail('缺少参数')
        if (req.query.get('method') === 'mills-range') {
          const total = this.dailyUsage(start, end).reduce((sum, day) => sum + Number(day.usage), 0)
          return ok({ result: 'success', usage: String(total) })
        }
        return ok({ result: 'success', usage: this.dailyUsage(start, end) })
      }
      default:
        for (const part of [this.advanced, this.files, this.tools, this.forward]) {
          const result = await part.api(req)
          if (result) return result
        }
        return null
    }
  }

  /**
   * VoLTE：AT+CAVIMS? / AT+CAVIMS=<0|1>；VoNR：AT+SP5GCMDS="get nr synch_param",42 / "set nr param",45,<0|1>。
   * 读：删掉引号后取冒号后、OK 前的部分按逗号拆分（VoLTE 第 1 段、VoNR 第 3 段）；写：AT 输出含 OK 即成功。
   */
  private async imsStatus(req: ApiRequest): Promise<ApiResult> {
    const kind = req.path === '/api/volte_status' ? 'volte' : 'vonr'
    if (req.method === 'POST') {
      if (!req.json) return fail(`设置${kind}状态出错`)
      // 后端用 optString 读：enabled 不是 "0" 都当 1，slot 不是 "0" 都当 1
      const on = optString(req.json.enabled) === '0' ? 0 : 1
      const slot = optString(req.json.slot) === '0' ? 0 : 1
      const out = await this.host.runAt(kind === 'volte' ? `AT+CAVIMS=${on}` : `AT+SP5GCMDS="set nr param",45,${on}`, slot)
      return out?.includes('OK') ? ok() : fail(`设置${kind}状态出错`)
    }
    const slot = req.query.get('slot') === '1' ? 1 : 0
    const out = await this.host.runAt(kind === 'volte' ? 'AT+CAVIMS?' : 'AT+SP5GCMDS="get nr synch_param",42', slot)
    const fields = (out ?? '').replace(/"/g, '').replace(/^[^:]*:/, '').replace(/OK\s*$/, '').split(',')
    const value = (kind === 'volte' ? fields[0] : fields[2])?.trim()
    if (value !== '0' && value !== '1') return fail(`获取${kind}_status信息出错`)
    return ok({ enabled: value === '1' })
  }
}
