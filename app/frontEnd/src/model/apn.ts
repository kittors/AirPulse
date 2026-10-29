/**
 * APN 配置（官方后台 APN_PROC_EX）。见 docs/legacy-network-sms.md §4.1：
 * - APN_config0…19 是 20 个槽位，用 ($) 分隔字段：0 名称、1 APN、4 鉴权、5 用户名、6 密码、7 PDP 类型；
 * - 修改 / 删除 / 设为默认都按「槽位号」提交（原版误用了下拉序号，中间有空槽时会改错配置）；
 * - IPv4、IPv6 两组共用同一套 APN、鉴权与账号，DNS 固定自动；
 * - 设为默认时带上这条配置的 pdp_type（同官方后台），否则设备沿用之前的 IP 类型。
 */

export type ApnAuth = 'none' | 'pap' | 'chap'
export type PdpType = 'IP' | 'IPv6' | 'IPv4v6'

export interface ApnProfile {
  slot: number
  name: string
  apn: string
  auth: ApnAuth
  username: string
  password: string
  pdp: PdpType
}

export type ApnDraft = Omit<ApnProfile, 'slot'>

export const APN_SLOTS = 20
const SEPARATOR = '($)'

export function normalizePdp(value: string | undefined): PdpType {
  const v = (value ?? '').trim().toLowerCase()
  if (v === 'ipv4v6') return 'IPv4v6'
  if (v === 'ipv6') return 'IPv6'
  return 'IP'
}

export function parseApnConfig(raw: string | undefined, slot: number): ApnProfile | null {
  if (!raw || !raw.trim()) return null
  const parts = raw.split(SEPARATOR)
  const name = (parts[0] ?? '').trim()
  const apn = (parts[1] ?? '').trim()
  if (!name && !apn) return null
  const auth = (parts[4] ?? '').trim().toLowerCase()
  return {
    slot,
    name,
    apn,
    auth: auth === 'pap' || auth === 'chap' ? auth : 'none',
    username: parts[5] ?? '',
    password: parts[6] ?? '',
    pdp: normalizePdp(parts[7]),
  }
}

/** 新增用第一个空槽；20 个都满了返回 null */
export function firstEmptySlot(profiles: ApnProfile[]): number | null {
  for (let slot = 0; slot < APN_SLOTS; slot++) if (!profiles.some((p) => p.slot === slot)) return slot
  return null
}

/** 名称、APN、账号里出现 ($) 会破坏设备的存储格式 */
export const validApnText = (value: string) => !value.includes(SEPARATOR)

/**
 * 当前使用的配置：优先按「名称 + APN」匹配（原版只按名称，重名时不准），
 * 匹配到多个时用 apn_Current_index 区分。
 */
export function findCurrentSlot(profiles: ApnProfile[], current: { name: string; apn: string; index: string }): number | null {
  const index = current.index.trim() === '' ? NaN : Number(current.index)
  const byName = profiles.filter((p) => p.name === current.name)
  const candidates = current.apn ? byName.filter((p) => p.apn === current.apn) : byName
  const pool = candidates.length ? candidates : byName
  if (pool.length === 1) return pool[0].slot
  if (pool.length > 1) return pool.find((p) => p.slot === index)?.slot ?? pool[0].slot
  return profiles.find((p) => p.slot === index)?.slot ?? null
}

/** 保存（新增 / 修改）的表单字段，与原版 getAPNEditFormData 一致 */
export function apnSaveForm(draft: ApnDraft, slot: number): Record<string, string> {
  const { name, apn, auth, username, password, pdp } = draft
  const form: Record<string, string> = {
    apn_mode: 'manual',
    apn_action: 'save',
    index: String(slot),
    profile_name: name,
    wan_dial: '*99#',
    apn_wan_dial: '*99#',
    apn_select: 'manual',
    apn_pdp_type: pdp,
    pdp_type: pdp,
    apn_pdp_select: 'auto',
    apn_pdp_addr: '',
    pdp_select: 'auto',
    pdp_addr: '',
  }
  if (pdp === 'IP' || pdp === 'IPv4v6') {
    Object.assign(form, {
      apn_wan_apn: apn,
      wan_apn: apn,
      apn_ppp_auth_mode: auth,
      ppp_auth_mode: auth,
      apn_ppp_username: username,
      ppp_username: username,
      apn_ppp_passwd: password,
      ppp_passwd: password,
      dns_mode: 'auto',
      prefer_dns_manual: '',
      standby_dns_manual: '',
    })
  }
  if (pdp === 'IPv6' || pdp === 'IPv4v6') {
    Object.assign(form, {
      apn_ipv6_wan_apn: apn,
      ipv6_wan_apn: apn,
      apn_ipv6_ppp_auth_mode: auth,
      ipv6_ppp_auth_mode: auth,
      apn_ipv6_ppp_username: username,
      ipv6_ppp_username: username,
      apn_ipv6_ppp_passwd: password,
      ipv6_ppp_passwd: password,
      ipv6_dns_mode: 'auto',
      ipv6_prefer_dns_manual: '',
      ipv6_standby_dns_manual: '',
    })
  }
  return form
}

/* —— 读回整体状态 —— */

export interface ApnState {
  mode: 'auto' | 'manual'
  profiles: ApnProfile[]
  /** 正在使用的 APN（自动模式下也有） */
  current: { name: string; apn: string }
  /** 手动模式下当前配置所在槽位 */
  currentSlot: number | null
  /** 前 N 个槽位是运营商预设，官方后台不允许修改 / 删除 */
  presetCount: number
  /** 自动模式下按 SIM 卡匹配到的运营商配置（apn_auto_config）；没有为 null */
  auto: ApnDraft | null
  /** 正在使用的 IP 类型；读不到为 null */
  pdp: PdpType | null
  /** 数据连接的实际状态（ppp_status） */
  link: LinkState
}

/** 数据连接：拿到了哪些地址；拨号 / 断开中为 busy */
export type LinkState = 'ipv4' | 'ipv6' | 'dual' | 'busy' | 'down'

export function linkOf(pppStatus: string): LinkState {
  const s = pppStatus.toLowerCase()
  if (s.includes('connecting')) return 'busy'
  if (!s.includes('connected') || s.includes('disconnected')) return 'down'
  if (s.includes('ipv4') && s.includes('ipv6')) return 'dual'
  return s.includes('ipv6') ? 'ipv6' : 'ipv4'
}

export type RawApnState = Record<string, unknown>

const text = (value: unknown) => (value == null ? '' : String(value).trim())

/** 自动配置可能有好几条（|| 分隔，同官方后台）：优先取名称和当前一致的那条 */
export function parseAutoConfig(raw: string, preferName = ''): ApnDraft | null {
  const entries = raw
    .split('||')
    .map((entry) => parseApnConfig(entry, -1))
    .filter((p): p is ApnProfile => p != null)
  const hit = entries.find((p) => preferName && p.name === preferName) ?? entries[0]
  if (!hit) return null
  const { slot: _slot, ...draft } = hit
  return draft
}

/**
 * 读回解析。真机（F50）只要请求里有 APN_config*，就固定回一整包 APN 字段（70 多个），别的 cmd 一概不回：
 * 名称在 m_profile_name / profile_name、APN 在 wan_apn、IP 类型在 pdp_type、当前槽位在 Current_index、
 * 预设条数在 default_APN_size。apn_interface_version ≥ 2 的固件改用 *_ui 字段（同官方后台）；
 * 原版前端用的 apn_* 字段名留作兜底。
 */
export function parseApnState(raw: RawApnState): ApnState {
  const pick = (...keys: string[]) => keys.map((key) => text(raw[key])).find(Boolean) ?? ''
  const v2 = Number(text(raw.apn_interface_version)) >= 2
  const profiles = Array.from({ length: APN_SLOTS }, (_, slot) => parseApnConfig(text(raw[`APN_config${slot}`]), slot)).filter(
    (p): p is ApnProfile => p != null,
  )
  const mode = text(raw.apn_mode) === 'manual' ? 'manual' : 'auto'
  const name = v2 ? pick('profile_name_ui', 'm_profile_name', 'profile_name') : pick('m_profile_name', 'profile_name', 'apn_m_profile_name', 'profile_name_ui')
  const apn = v2 ? pick('wan_apn_ui', 'wan_apn') : pick('wan_apn', 'apn_wan_apn', 'wan_apn_ui')
  const preset = Number(pick('apn_num_preset', 'default_APN_size'))
  const currentSlot = mode === 'manual' ? findCurrentSlot(profiles, { name, apn, index: pick('Current_index', 'apn_Current_index', 'index') }) : null
  const auto = parseAutoConfig(text(raw.apn_auto_config), name)
  const pdpField = v2 ? pick('pdp_type_ui', 'pdp_type') : pick('pdp_type', 'apn_pdp_type', 'pdp_type_ui')
  // 手动模式以正在用的那条配置为准；自动模式以运营商配置为准；都没有再看设备记下的 pdp_type
  const pdp =
    (mode === 'manual' ? profiles.find((p) => p.slot === currentSlot)?.pdp : auto?.pdp) ?? (pdpField ? normalizePdp(pdpField) : null)
  return {
    mode,
    profiles,
    current: { name, apn },
    currentSlot,
    presetCount: Number.isInteger(preset) && preset > 0 ? preset : 0,
    auto,
    pdp,
    link: linkOf(text(raw.ppp_status)),
  }
}

/* —— IPv6 开关 ——
 * 中兴固件没有单独的 IPv6 开关，官方后台关 IPv6 的办法就是把 APN 的 IP 类型改成 IPv4：
 * 设备不再向运营商申请 IPv6，系统的网络共享也就不会给终端下发 IPv6 前缀，重启、重新拨号后依然有效。
 * 自动 APN 不能改 IP 类型，所以照着运营商配置复制一条（名称加「IPv4」后缀）改用它；重新打开时认出这条，直接回到自动。
 */

export const supportsIpv6 = (pdp: PdpType) => pdp !== 'IP'

const PDP_SUFFIX: Record<PdpType, string> = { IP: 'IPv4', IPv6: 'IPv6', IPv4v6: 'IPv4v6' }
const NAME_MAX = 32

/** 复制出来的配置名称：原名 + 空格 + IP 类型，超长时截断原名 */
export function copyName(base: string, pdp: PdpType): string {
  const suffix = ` ${PDP_SUFFIX[pdp]}`
  return `${base.slice(0, NAME_MAX - suffix.length).trimEnd()}${suffix}`
}

export type Ipv6Plan =
  /** 回到自动选择（当初关 IPv6 时照着运营商配置复制出来的那条正在用） */
  | { kind: 'auto' }
  /** 改这一条的 IP 类型（created：新建的复制品）后使用 */
  | { kind: 'save'; slot: number; draft: ApnDraft; created: boolean }
  /** 已经有一条一样的配置：直接使用 */
  | { kind: 'use'; slot: number; draft: ApnDraft }
  /** 需要新建，但 20 个配置位都满了 */
  | { kind: 'full' }
  /** 读不到正在用的配置（比如没插 SIM 卡） */
  | { kind: 'unknown' }

const sameAccess = (a: ApnDraft, b: ApnDraft) => a.apn === b.apn && a.auth === b.auth && a.username === b.username && a.password === b.password
const draftOf = ({ slot: _slot, ...draft }: ApnProfile): ApnDraft => draft

export function planIpv6(state: ApnState, enable: boolean): Ipv6Plan {
  const target: PdpType = enable ? 'IPv4v6' : 'IP'
  const current = state.mode === 'manual' ? state.profiles.find((p) => p.slot === state.currentSlot) : undefined
  const auto = state.auto
  if (enable && current && auto && supportsIpv6(auto.pdp) && sameAccess(current, auto) && current.name === copyName(auto.name || auto.apn, 'IP')) {
    return { kind: 'auto' }
  }
  // 手动模式下用的是自己加的配置：直接改它的 IP 类型
  if (current && current.slot >= state.presetCount) {
    return { kind: 'save', slot: current.slot, draft: { ...draftOf(current), pdp: target }, created: false }
  }
  // 自动模式，或正在用不能改的运营商预设：照着它复制一条
  const base = current ? draftOf(current) : state.mode === 'auto' ? auto : null
  if (!base?.apn) return { kind: 'unknown' }
  const draft: ApnDraft = { ...base, name: copyName(base.name || base.apn, target), pdp: target }
  const existing = state.profiles.find((p) => p.slot >= state.presetCount && p.pdp === target && sameAccess(p, draft))
  if (existing) return { kind: 'use', slot: existing.slot, draft: draftOf(existing) }
  const slot = firstEmptySlot(state.profiles)
  return slot == null ? { kind: 'full' } : { kind: 'save', slot, draft, created: true }
}
