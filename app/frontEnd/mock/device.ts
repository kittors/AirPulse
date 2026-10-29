import { createHash, createHmac, randomBytes } from 'node:crypto'

import type { BaseDeviceInfo, BearerPreference, GoformStatus, RawLockedCell, RawNeighborCell } from '../src/api/types'

import { MockFeatures } from './features'
import { between, sleep } from './http'

import {
  DEVICE_INFO_BASE,
  LTE_ALL_BANDS,
  LTE_EMPTY,
  NR_EMPTY,
  NR_SUPPORTED_BANDS,
  SCENARIOS,
  STATUS_BASE,
  type Scenario,
} from './fixtures'

/**
 * 有状态的模拟设备：完整模拟 AirPulse 鉴权 + 中兴官方后台会话（LD / Cookie / RD / AD），
 * 签名与哈希用 Node 自带 crypto 独立实现——前端用 @noble/hashes，两边对得上，
 * 等于在运行时又交叉验证了一次签名算法。
 *
 * 行为尽量贴近真机：切选网改变制式；锁频后协议栈重启约 3 秒再按允许的频段重新驻留；
 * 锁小区后切到被锁小区；速率、信号、温度、流量随时间自然波动。
 */

const SIGN_SECRET = 'minikano_kOyXz0Ciz4V7wR0IeKmJFYFQ20jd'
const sha256 = (input: string | Buffer) => createHash('sha256').update(input).digest('hex')
const SHA = (input: string) => sha256(input).toUpperCase()
const hex = (bytes = 8) => randomBytes(bytes).toString('hex')

export function expectedSign(method: string, path: string, t: string): string {
  const mac = createHmac('md5', SIGN_SECRET).update(`minikano${method.toUpperCase()}${path}${t}`).digest()
  return sha256(Buffer.concat([createHash('sha256').update(mac.subarray(0, 8)).digest(), createHash('sha256').update(mac.subarray(8, 16)).digest()]))
}

const WA_INNER_VERSION = 'BD_ZTE_F50V1.0.0B12'

type Fields = Partial<GoformStatus>

function nrFields(cell: RawNeighborCell, width = '100000'): Fields {
  return {
    Z5g_rsrp: String(cell.rsrp),
    Nr_snr: String(cell.sinr),
    nr_rsrq: String(cell.rsrq),
    nr_rssi: String(Number(cell.rsrp) + 33),
    Nr_bands: String(cell.band),
    Nr_fcn: String(cell.earfcn),
    Nr_bands_widths: width,
    Nr_pci: String(cell.pci),
    Nr_cell_id: String(5_056_786_000 + Number(cell.pci)),
  }
}

function lteFields(cell: RawNeighborCell): Fields {
  return {
    lte_rsrp: String(cell.rsrp),
    Lte_snr: String(cell.sinr),
    lte_rsrq: String(cell.rsrq),
    lte_rssi: String(Number(cell.rsrp) + 27),
    Lte_bands: String(cell.band),
    Lte_fcn: String(cell.earfcn),
    Lte_bands_widths: '20000',
    Lte_pci: String(cell.pci),
    Lte_cell_id: String(35_121_900 + Number(cell.pci)),
  }
}

/** 没有 4G 字段的场景切到「仅 4G」时用的锚点小区 */
const FALLBACK_LTE: RawNeighborCell = { band: '3', earfcn: '1825', pci: '291', rsrp: '-90', rsrq: '-11', sinr: '8' }

/** 短信样例：内容按官方后台的格式存成 UTF-8 Base64，日期是「yy,MM,dd,HH,mm,ss,+32」（UTC+8） */
const SMS_SAMPLES = [
  { id: '58', number: '10086', tag: '1', ago: 3 * 60_000, body: '【中国移动】您的验证码为 482916，5 分钟内有效。如非本人操作，请忽略本短信。' },
  { id: '57', number: '10086', tag: '1', ago: 62 * 60_000, body: '尊敬的客户，截至今日 08:00，您本月套餐内通用流量已使用 60.5GB，剩余 139.5GB。' },
  { id: '56', number: '106980095588', tag: '0', ago: 26 * 3600_000, body: '【顺丰速运】您的快件 SF1408****231 已由前台代收，凭取件码 7-2-1043 领取。' },
  { id: '55', number: '13800138000', tag: '2', ago: 30 * 3600_000, body: '好的，晚上见' },
]

function smsDate(at: number): string {
  const d = new Date(at + 8 * 3_600_000)
  const p = (n: number) => String(n).padStart(2, '0')
  return [d.getUTCFullYear() % 100, d.getUTCMonth() + 1, d.getUTCDate(), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds()].map(p).join(',') + ',+32'
}

export class MockDevice {
  readonly scenario: Scenario
  token = 'admin'
  adminPassword = 'admin'
  netSelect: BearerPreference = 'WL_AND_5G'
  lteLock = LTE_ALL_BANDS
  nrLock = NR_SUPPORTED_BANDS.join(',')
  lockedCells: RawLockedCell[] = []
  storedCookie = ''
  nickname = ''

  private ld = hex()
  private sessions = new Map<string, { rd: string | null }>()
  private failLeft = 5
  private lockUntil = 0
  private stackDownUntil = 0
  /**
   * 锁频 / 锁小区之后覆盖在场景之上的驻留小区：
   * 某个制式的键不存在 = 沿用场景默认；值为 null = 这个制式没有驻留。
   */
  private serving: { nr?: Fields | null; lte?: Fields | null } = {}
  /** 短信：发送 / 删除 / 标为已读都改这份列表 */
  private sms = SMS_SAMPLES.map(({ ago, ...sms }) => ({ ...sms, at: Date.now() - ago }))
  private smsSeq = 100
  private lastTick = Date.now()
  private monthlyRx: number
  private monthlyTx: number
  private connectedAt = Date.now() - 99_000 * 1000
  private readonly seed = Math.random() * 1000

  readonly scenarioKey: string
  readonly features: MockFeatures

  constructor(scenarioKey: string) {
    this.scenarioKey = scenarioKey
    this.scenario = SCENARIOS[scenarioKey] ?? SCENARIOS.sa
    this.monthlyRx = Number(STATUS_BASE.monthly_rx_bytes)
    this.monthlyTx = Number(STATUS_BASE.monthly_tx_bytes)
    this.features = new MockFeatures({
      getUsed: () => this.monthlyRx + this.monthlyTx,
      setUsed: (bytes) => {
        this.monthlyRx = bytes * 0.9
        this.monthlyTx = bytes * 0.1
      },
      getAdminPassword: () => this.adminPassword,
      // 改密码后官方后台要求重新登录：现有会话全部失效
      setAdminPassword: (password) => {
        this.adminPassword = password
        this.sessions.clear()
      },
      reboot: (ms) => this.restartStack(ms),
      restartRadio: (ms) => this.restartStack(ms),
      setNickname: (name) => (this.nickname = name),
      identity: () => {
        const status = { ...STATUS_BASE, ...this.scenario.status }
        return { model: this.scenario.model ?? 'F50', imei: String(status.imei), imsi: String(status.imsi), crVersion: String(status.cr_version) }
      },
      online: () => {
        const radio = this.radio()
        return Boolean(radio.nr || radio.lte)
      },
      runAt: (command, slot) => this.runAt(command, slot),
    })
  }

  /* —— 鉴权 —— */

  tokenHash() {
    return sha256(this.token)
  }

  sessionOf(cookieHeader: string | undefined) {
    if (!cookieHeader) return null
    const key = cookieHeader.split(';')[0].trim()
    return this.sessions.has(key) ? { key, session: this.sessions.get(key)! } : null
  }

  /* —— 动态数据 —— */

  /** 拨号 / 断开要几秒（真机同样），期间 ppp_status 是 ppp_connecting / ppp_disconnecting */
  private connected = true
  private pppTransition: { connect: boolean; until: number } | null = null

  get dataConnected() {
    if (this.pppTransition && Date.now() >= this.pppTransition.until) {
      this.connected = this.pppTransition.connect
      if (this.connected) this.connectedAt = Date.now()
      this.pppTransition = null
    }
    return this.connected
  }

  private get pppStatus() {
    if (this.networkDown) return 'ppp_disconnected'
    const connected = this.dataConnected
    if (this.pppTransition) return this.pppTransition.connect ? 'ppp_connecting' : 'ppp_disconnecting'
    if (!connected) return 'ppp_disconnected'
    return this.features.apnHasIpv6() ? 'ipv4_ipv6_connected' : 'ppp_connected'
  }

  private setData(connect: boolean) {
    if (this.dataConnected === connect && !this.pppTransition) return
    this.pppTransition = { connect, until: Date.now() + (connect ? 3_000 : 2_000) }
  }

  private get networkDown() {
    return Date.now() < this.stackDownUntil
  }

  private wave(period: number, offset = 0) {
    return Math.sin((Date.now() / 1000 + this.seed + offset) / period)
  }

  /** 当前驻留：按选网模式、锁频、锁小区从场景推导 */
  private radio(): { nr: Fields | null; lte: Fields | null; type: string } {
    if (this.networkDown || !this.dataConnected) return { nr: null, lte: null, type: this.networkDown ? '' : '20' }
    const base = { ...STATUS_BASE, ...this.scenario.status }
    const hasNr = base.Nr_pci !== '' && base.Nr_pci !== undefined
    const hasLte = base.Lte_pci !== '' && base.Lte_pci !== undefined
    const pick = (prefix: 'Nr' | 'Lte'): Fields =>
      Object.fromEntries(
        Object.entries(base).filter(([key]) =>
          prefix === 'Nr' ? /^(Z5g_|Nr_|nr_)/.test(key) : /^(lte_|Lte_)/.test(key),
        ),
      )
    const nr = this.serving.nr === undefined ? (hasNr ? pick('Nr') : null) : this.serving.nr
    let lte = this.serving.lte === undefined ? (hasLte ? pick('Lte') : null) : this.serving.lte

    switch (this.netSelect) {
      case 'Only_LTE':
      case 'WCDMA_AND_LTE':
        return { nr: null, lte: lte ?? lteFields(FALLBACK_LTE), type: 'LTE' }
      case 'Only_5G':
        // 场景本来就没有 5G 覆盖：纯 SA 会直接无服务——这就是切换前要确认的原因
        return { nr, lte: null, type: nr ? '20' : '' }
      case 'LTE_AND_5G':
        return { nr, lte: nr ? (lte ?? lteFields(FALLBACK_LTE)) : lte, type: nr ? '13' : 'LTE' }
      case 'Only_WCDMA':
        return { nr: null, lte: null, type: 'WCDMA' }
      default:
        if (!nr && !lte) lte = lteFields(FALLBACK_LTE)
        return { nr, lte, type: nr && !lte ? '20' : base.network_type === 'LTE' ? 'LTE' : nr ? '13' : 'LTE' }
    }
  }

  /** 速率：后台小流量 + 周期性的下载突发；单位字节 / 秒 */
  private speed(mode: 'nr' | 'lte' | 'none') {
    if (mode === 'none') return { rx: 0, tx: 0 }
    const t = Date.now() / 1000 + this.seed
    const phase = t % 41
    const burst = phase < 14 ? Math.sin((Math.PI * phase) / 14) ** 0.6 : 0
    const jitter = (k: number) => 1 + 0.18 * Math.sin(t * k) * Math.cos(t * k * 0.61)
    const peak = mode === 'nr' ? 72e6 : 11e6
    return {
      rx: Math.round(48_000 * jitter(1.3) + burst * peak * jitter(2.3)),
      tx: Math.round(14_000 * jitter(0.9) + burst * peak * 0.07 * jitter(1.7)),
    }
  }

  status(): GoformStatus {
    const now = Date.now()
    const dt = Math.min(5, (now - this.lastTick) / 1000)
    this.lastTick = now
    const radio = this.radio()
    const speed = this.speed(radio.nr ? 'nr' : radio.lte ? 'lte' : 'none')
    this.monthlyRx += speed.rx * dt
    this.monthlyTx += speed.tx * dt

    const jitter = (value: unknown, amp: number, offset: number) =>
      value === '' || value === undefined ? value : String(Math.round(Number(value) + amp * this.wave(4.3, offset)))
    const nr = radio.nr
      ? {
          ...radio.nr,
          Z5g_rsrp: jitter(radio.nr.Z5g_rsrp, 2, 1),
          Nr_snr: jitter(radio.nr.Nr_snr, 2, 2),
          nr_rsrq: jitter(radio.nr.nr_rsrq, 1, 3),
        }
      : NR_EMPTY
    const lte = radio.lte
      ? {
          ...radio.lte,
          lte_rsrp: jitter(radio.lte.lte_rsrp, 2, 4),
          Lte_snr: jitter(radio.lte.Lte_snr, 2, 5),
          lte_rsrq: jitter(radio.lte.lte_rsrq, 1, 6),
        }
      : LTE_EMPTY
    const rsrp = Number((radio.nr ?? {}).Z5g_rsrp ?? (radio.lte ?? {}).lte_rsrp ?? -140)
    const bars = radio.nr || radio.lte ? String(rsrp >= -85 ? 5 : rsrp >= -95 ? 4 : rsrp >= -105 ? 3 : rsrp >= -112 ? 2 : 1) : '0'

    return {
      ...STATUS_BASE,
      ...this.scenario.status,
      ...nr,
      ...lte,
      network_type: radio.type,
      rssi: bars,
      network_signalbar: bars,
      realtime_rx_thrpt: String(speed.rx),
      realtime_tx_thrpt: String(speed.tx),
      realtime_time: String(Math.round((now - this.connectedAt) / 1000)),
      monthly_rx_bytes: Math.round(this.monthlyRx),
      monthly_tx_bytes: Math.round(this.monthlyTx),
      ppp_status: this.pppStatus,
      // APN 改成仅 IPv4 后拿不到 IPv6 地址
      ipv6_wan_ipaddr: this.features.apnHasIpv6() ? STATUS_BASE.ipv6_wan_ipaddr : '',
      sms_unread_num: String(this.sms.filter((sms) => sms.tag === '1').length),
    }
  }

  deviceInfo(): BaseDeviceInfo {
    const busy = Math.max(0, this.wave(6.5, 7))
    const cpu = Math.round((3 + busy * 22 + 2 * this.wave(1.7, 8)) * 10) / 10
    const temp = Math.round(39_200 + busy * 4_300 + 300 * this.wave(9, 9))
    const usage: Record<string, string> = { cpu: cpu.toFixed(1) }
    for (let i = 0; i < 7; i += 1) usage[`cpu${i}`] = Math.max(0, cpu + 6 * this.wave(2 + i, i)).toFixed(1)
    const battery = this.scenario.battery
    return {
      ...DEVICE_INFO_BASE,
      // OTA 安装成功后版本号随之变化
      ...this.features.version(),
      model: this.scenario.model ?? 'F50',
      battery: battery ? String(this.scenario.status.battery_value ?? '80') : 'null',
      cpu_usage: cpu,
      cpuUsageInfo: usage,
      mem_usage: Math.round((59.7 + 1.5 * this.wave(11, 10)) * 10) / 10,
      cpu_temp: temp,
      cpu_temp_list: (DEVICE_INFO_BASE.cpu_temp_list ?? []).map((zone, i) => ({
        ...zone,
        temp: zone.type.startsWith('soc') ? temp : Math.round(temp - 400 - i * 120),
      })),
      daily_data: Math.round(267_774_853 + (this.monthlyRx - Number(STATUS_BASE.monthly_rx_bytes))),
      monthly_data: Math.round(this.monthlyRx + this.monthlyTx - 800_000_000),
      current_now: battery ? 412_000 : -1,
      voltage_now: battery ? 4_023_000 : -1,
      boot_time: 275_112_000 + Math.round(process.uptime() * 1000),
    }
  }

  neighbors(): RawNeighborCell[] {
    if (this.networkDown) return []
    return this.scenario.neighbors.map((cell, i) => ({
      ...cell,
      rsrp: String(Math.round(Number(cell.rsrp) + 2 * this.wave(5, 20 + i))),
      sinr: String(Math.round(Number(cell.sinr) + 2 * this.wave(3.7, 30 + i))),
    }))
  }

  /* —— 官方后台读 —— */

  read(cmds: string[], cookie: string | undefined): Record<string, unknown> {
    const session = this.sessionOf(cookie)
    const status = this.status() as Record<string, unknown>
    const out: Record<string, unknown> = {}
    const wantsStatus = cmds.includes('network_information')
    for (const cmd of cmds) {
      switch (cmd) {
        case 'LD':
          out.LD = this.ld
          break
        case 'RD': {
          const rd = hex()
          if (session) session.session.rd = rd
          out.RD = rd
          break
        }
        case 'loginfo':
          out.loginfo = session ? 'ok' : ''
          break
        case 'Language':
          out.Language = 'zh-cn'
          break
        case 'wa_inner_version':
          out.wa_inner_version = WA_INNER_VERSION
          break
        case 'psw_fail_num_str':
          out.psw_fail_num_str = String(this.failLeft)
          break
        case 'login_lock_time':
          out.login_lock_time = Date.now() < this.lockUntil ? String(Math.ceil((this.lockUntil - Date.now()) / 1000)) : '0'
          break
        case 'net_select':
          out.net_select = this.netSelect
          break
        case 'lte_band_lock':
          out.lte_band_lock = this.lteLock
          break
        case 'nr_band_lock':
          out.nr_band_lock = this.nrLock
          break
        case 'neighbor_cell_info':
          out.neighbor_cell_info = this.neighbors()
          break
        case 'locked_cell_info':
          out.locked_cell_info = this.lockedCells
          break
        case 'sms_data_total':
          out.messages = session
            ? [...this.sms]
                .sort((a, b) => Number(b.id) - Number(a.id))
                .map(({ at, body, ...sms }) => ({ ...sms, content: Buffer.from(body, 'utf8').toString('base64'), date: smsDate(at) }))
            : []
          break
        default: {
          if (this.features.readInto(cmd, out)) break
          const feature = this.features.read(cmd)
          out[cmd] = feature !== undefined ? feature : cmd in status ? status[cmd] : ''
        }
      }
    }
    if (wantsStatus) {
      // network_information 推断为复合 cmd：展开的 16 个信号字段平铺在顶层
      for (const key of Object.keys(status)) if (/^(Nr_|nr_|Lte_|lte_|Z5g_)/.test(key)) out[key] = status[key]
    }
    // 没有会话时，需要登录态的标识类字段为空（贴近官方后台行为）
    if (!session) for (const key of ['imei', 'imsi', 'iccid', 'msisdn']) if (key in out) out[key] = ''
    return out
  }

  /* —— 官方后台写 —— */

  write(form: Record<string, string>, cookie: string | undefined): { body: Record<string, unknown>; setCookie?: string } {
    const id = form.goformId
    if (id === 'LOGIN' || id === 'LOGIN_MULTI_USER') return this.login(form.password)

    const session = this.sessionOf(cookie)
    const rd = session?.session.rd
    const crVersion = String(this.scenario.status.cr_version ?? STATUS_BASE.cr_version)
    if (!session || !rd || form.AD !== SHA(SHA(WA_INNER_VERSION + crVersion) + rd)) {
      return { body: { result: 'failure' } }
    }
    session.session.rd = null

    switch (id) {
      case 'LOGOUT':
        this.sessions.delete(session.key)
        break
      case 'SET_BEARER_PREFERENCE':
        this.netSelect = form.BearerPreference as BearerPreference
        this.serving = {}
        this.restartStack(2_000)
        break
      case 'LTE_BAND_LOCK':
        this.lteLock = form.lte_band_lock ?? ''
        break
      case 'NR_BAND_LOCK':
        this.nrLock = form.nr_band_lock ?? ''
        break
      case 'CELL_LOCK': {
        const cell = { pci: form.pci, earfcn: form.earfcn, rat: form.rat }
        this.lockedCells = [...this.lockedCells.filter((c) => !(c.pci === cell.pci && c.earfcn === cell.earfcn)), cell]
        const target = this.scenario.neighbors.find((n) => String(n.pci) === cell.pci && String(n.earfcn) === cell.earfcn)
        if (target) {
          // 锁定后重新驻留到目标小区（另一个制式保持不变，NSA 锚点仍在）
          setTimeout(() => {
            this.serving = form.rat === '12' ? { ...this.serving, lte: lteFields(target) } : { ...this.serving, nr: nrFields(target) }
          }, 2_000)
        }
        break
      }
      case 'UNLOCK_ALL_CELL':
        this.lockedCells = []
        this.serving = {}
        break
      case 'SEND_SMS': {
        // MessageBody 是 UTF-16BE 十六进制
        const hex = form.MessageBody ?? ''
        let body = ''
        for (let i = 0; i + 4 <= hex.length; i += 4) body += String.fromCharCode(Number.parseInt(hex.slice(i, i + 4), 16))
        const failed = /fail|失败/i.test(body)
        this.sms.push({ id: String(++this.smsSeq), number: form.Number ?? '', tag: failed ? '3' : '2', at: Date.now(), body })
        break
      }
      case 'DELETE_SMS': {
        const ids = String(form.msg_id ?? '').split(';').filter(Boolean)
        this.sms = this.sms.filter((sms) => !ids.includes(sms.id))
        break
      }
      case 'SET_MSG_READ': {
        const ids = String(form.msg_id ?? '').split(';').filter(Boolean)
        for (const sms of this.sms) if (ids.includes(sms.id) && sms.tag === '1') sms.tag = '0'
        break
      }
      case 'CONNECT_NETWORK':
        this.setData(true)
        break
      case 'DISCONNECT_NETWORK':
        this.setData(false)
        break
      default:
        try {
          this.features.write(id, form)
        } catch {
          return { body: { result: 'failure' } }
        }
        break
    }
    return { body: { result: 'success' } }
  }

  private login(password: string | undefined) {
    if (Date.now() < this.lockUntil) return { body: { result: '3' } }
    if (password !== SHA(SHA(this.adminPassword) + this.ld)) {
      this.failLeft = Math.max(0, this.failLeft - 1)
      if (this.failLeft === 0) {
        this.lockUntil = Date.now() + 60_000
        setTimeout(() => (this.failLeft = 5), 60_000)
      }
      this.ld = hex()
      return { body: { result: '3' } }
    }
    this.failLeft = 5
    this.ld = hex()
    const key = `stok="${hex(12)}"`
    this.sessions.set(key, { rd: null })
    return { body: { result: '0' }, setCookie: `${key}; path=/; HttpOnly` }
  }

  /* —— AT 指令 —— */

  private atQueue: Promise<unknown> = Promise.resolve()

  /** 后端经 sendat 发 AT：同一时刻只处理一条，每条 0.3–1.5 s */
  runAt(command: string, slot = 0): Promise<string | null> {
    const run = this.atQueue.then(async () => {
      await sleep(between(300, 1_500))
      return this.at(command, slot)
    })
    this.atQueue = run.catch(() => undefined)
    return run
  }

  /**
   * 基带的回答（已按后端规则规范化：去掉换行，结尾 OK 前留一个空格）。
   * 基带拒绝返回 ERROR（HTTP 仍是 200）；执行失败（sh 报错、超时）返回 null。
   */
  at(command: string, slot = 0): string | null {
    // 后端用单引号把指令拼进 sh -c：指令里的单引号会截断引用，sh 报错 → 没有输出
    if (command.includes("'")) return null
    const cmd = command.trim().toUpperCase()
    if (cmd === 'AT') return ' OK'
    if (cmd === 'AT+CFUN=1,1') {
      // 重启基带：断网十几秒
      this.restartStack(15_000)
      return ' OK'
    }
    if (cmd === 'AT+SFUN=5') {
      this.stackDownUntil = Date.now() + 60_000
      return ' OK'
    }
    if (cmd === 'AT+SFUN=4') {
      this.restartStack(3_000)
      this.applyBandLock()
      return ' OK'
    }
    if (cmd === 'AT+CGEQOSRDP=1') {
      const radio = this.radio()
      if (!radio.nr && !radio.lte) return 'ERROR'
      return radio.nr ? '+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK' : '+CGEQOSRDP: 1,9,0,0,0,0,300000,50000 OK'
    }
    if (cmd === 'AT+CSQ') return '+CSQ: 25,99 OK'
    if (cmd === 'AT+CFUN?') return '+CFUN: 1 OK'
    return this.features.at(cmd, slot) ?? 'ERROR'
  }

  private restartStack(ms: number) {
    this.stackDownUntil = Date.now() + ms
    this.connectedAt = Date.now() + ms
  }

  /** 协议栈重启后按锁频结果重新驻留：当前频段被排除时，挑一个允许频段里信号最好的邻区，没有就无服务 */
  private applyBandLock() {
    const allowed = { nr: new Set(this.nrLock.split(',').filter(Boolean)), lte: new Set(this.lteLock.split(',').filter(Boolean)) }
    const base = { ...STATUS_BASE, ...this.scenario.status }
    const best = (set: Set<string>, nr: boolean) =>
      this.scenario.neighbors
        .filter((n) => set.has(String(n.band)) && Number(n.earfcn) >= 100_000 === nr)
        .sort((a, b) => Number(b.rsrp) - Number(a.rsrp))[0]
    const next: { nr?: Fields | null; lte?: Fields | null } = {}
    if (base.Nr_bands && !allowed.nr.has(String(base.Nr_bands))) {
      const cell = best(allowed.nr, true)
      next.nr = cell ? nrFields(cell) : null
    }
    if (base.Lte_bands && !allowed.lte.has(String(base.Lte_bands))) {
      const cell = best(allowed.lte, false)
      next.lte = cell ? lteFields(cell) : null
    }
    this.serving = next
  }
}

const devices = new Map<string, MockDevice>()

export function deviceFor(scenario: string): MockDevice {
  const key = scenario in SCENARIOS ? scenario : 'sa'
  let device = devices.get(key)
  if (!device) {
    device = new MockDevice(key)
    devices.set(key, device)
  }
  return device
}
