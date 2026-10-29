/**
 * 定时任务（纯函数）：把「要做的事」做成表单，由前端生成 action，不让用户手写 JSON。
 * 接口与调度语义见 docs/legacy-tools.md §3：
 * - action 的所有值都按字符串提交（后端 optString）；
 * - 时间必须是两位数的 HH:mm，否则永远不会触发；
 * - action 里有 kano_do_sms_forward_action=1 时是「推送设备信息」，其余整体作为官方后台 goform 表单执行。
 */

export interface TaskInfo {
  /** 创建或最后一次保存时的毫秒时间戳 */
  key: number
  id: string
  time: string
  repeatDaily: boolean
  actionMap?: Record<string, string>
  lastRunTimestamp?: number
  hasTriggered?: boolean
}

export type TaskKind =
  | 'reboot'
  | 'shutdown'
  | 'data'
  | 'wifi'
  | 'networkMode'
  | 'simSlot'
  | 'unlockCells'
  | 'lockCell'
  | 'roaming'
  | 'indicator'
  | 'nfc'
  | 'samba'
  | 'performance'
  | 'usbDebug'
  | 'sendSms'
  | 'forwardInfo'
  | 'custom'

export type WifiTarget = 'off' | 'chip1' | 'chip2'

export interface TaskDraft {
  kind: TaskKind
  /** 开关类动作的目标状态 */
  on: boolean
  wifi: WifiTarget
  mode: string
  simSlot: string
  pci: string
  earfcn: string
  /** 16 = 5G NR，12 = 4G LTE */
  rat: '16' | '12'
  number: string
  body: string
  /** 自定义 goform 表单（JSON 文本） */
  custom: string
}

export const EMPTY_DRAFT: TaskDraft = {
  kind: 'reboot',
  on: true,
  wifi: 'chip2',
  mode: 'WL_AND_5G',
  simSlot: '0',
  pci: '',
  earfcn: '',
  rat: '16',
  number: '',
  body: '',
  custom: '{\n  "goformId": ""\n}',
}

/** 开关类动作：goformId 与字段，以及开 / 关的取值 */
const TOGGLES: Partial<Record<TaskKind, { goformId: string; extra?: Record<string, string>; fields: string[]; on: string; off: string }>> = {
  indicator: { goformId: 'INDICATOR_LIGHT_SETTING', fields: ['indicator_light_switch'], on: '1', off: '0' },
  nfc: { goformId: 'WIFI_NFC_SET', fields: ['web_wifi_nfc_switch'], on: '1', off: '0' },
  samba: { goformId: 'SAMBA_SETTING', fields: ['samba_switch'], on: '1', off: '0' },
  // 原版模板写成了 PERFORMANCE_MODE，快捷开关用的才是 PERFORMANCE_MODE_SETTING
  performance: { goformId: 'PERFORMANCE_MODE_SETTING', fields: ['performance_mode'], on: '1', off: '0' },
  usbDebug: { goformId: 'USB_PORT_SETTING', fields: ['usb_port_switch'], on: '1', off: '0' },
  roaming: {
    goformId: 'SET_CONNECTION_MODE',
    extra: { ConnectionMode: 'auto_dial' },
    fields: ['roam_setting_option', 'dial_roam_setting_option'],
    on: 'on',
    off: 'off',
  },
}

/** UTF-16 码元逐个转 4 位十六进制（与短信发送一致） */
export function encodeUcs2Hex(text: string): string {
  let out = ''
  for (let i = 0; i < text.length; i += 1) out += text.charCodeAt(i).toString(16).padStart(4, '0')
  return out
}

export function decodeUcs2Hex(hex: string): string {
  if (!/^([0-9a-fA-F]{4})*$/.test(hex)) return hex
  let out = ''
  for (let i = 0; i < hex.length; i += 4) out += String.fromCharCode(parseInt(hex.slice(i, i + 4), 16))
  return out
}

export const FORWARD_ACTION_KEY = 'kano_do_sms_forward_action'

export type BuildResult = { ok: true; action: Record<string, string> } | { ok: false; error: 'pci' | 'earfcn' | 'number' | 'body' | 'json' | 'goformId' }

export function buildAction(draft: TaskDraft): BuildResult {
  const toggle = TOGGLES[draft.kind]
  if (toggle) {
    const value = draft.on ? toggle.on : toggle.off
    return { ok: true, action: { goformId: toggle.goformId, ...toggle.extra, ...Object.fromEntries(toggle.fields.map((f) => [f, value])) } }
  }
  switch (draft.kind) {
    case 'reboot':
      return { ok: true, action: { goformId: 'REBOOT_DEVICE' } }
    case 'shutdown':
      return { ok: true, action: { goformId: 'SHUTDOWN_DEVICE' } }
    case 'data':
      return { ok: true, action: { goformId: draft.on ? 'CONNECT_NETWORK' : 'DISCONNECT_NETWORK' } }
    case 'wifi':
      return {
        ok: true,
        action: draft.wifi === 'off' ? { goformId: 'switchWiFiModule', SwitchOption: '0' } : { goformId: 'switchWiFiChip', ChipEnum: draft.wifi, GuestEnable: '0' },
      }
    case 'networkMode':
      return { ok: true, action: { goformId: 'SET_BEARER_PREFERENCE', BearerPreference: draft.mode } }
    case 'simSlot':
      return { ok: true, action: { goformId: 'SET_SIM_SLOT', sim_slot: draft.simSlot } }
    case 'unlockCells':
      return { ok: true, action: { goformId: 'UNLOCK_ALL_CELL' } }
    case 'lockCell':
      if (!/^\d{1,4}$/.test(draft.pci.trim())) return { ok: false, error: 'pci' }
      if (!/^\d{1,7}$/.test(draft.earfcn.trim())) return { ok: false, error: 'earfcn' }
      return { ok: true, action: { goformId: 'CELL_LOCK', pci: draft.pci.trim(), earfcn: draft.earfcn.trim(), rat: draft.rat } }
    case 'sendSms': {
      const number = draft.number.replace(/\s+/g, '')
      if (!/^\+?\d{3,20}$/.test(number)) return { ok: false, error: 'number' }
      if (!draft.body.trim()) return { ok: false, error: 'body' }
      return { ok: true, action: { goformId: 'SEND_SMS', Number: number, MessageBody: encodeUcs2Hex(draft.body) } }
    }
    case 'forwardInfo':
      return { ok: true, action: { [FORWARD_ACTION_KEY]: '1' } }
    case 'custom': {
      let parsed: unknown
      try {
        parsed = JSON.parse(draft.custom)
      } catch {
        return { ok: false, error: 'json' }
      }
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, error: 'json' }
      const action = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
      )
      if (!action.goformId?.trim() && action[FORWARD_ACTION_KEY] !== '1') return { ok: false, error: 'goformId' }
      return { ok: true, action }
    }
    default:
      return { ok: false, error: 'json' }
  }
}

/** 反解已有任务：认得的动作回填成表单，认不得的落到「自定义」并保留原文 */
export function parseAction(action: Record<string, string> | undefined): TaskDraft {
  const map = action ?? {}
  const base: TaskDraft = { ...EMPTY_DRAFT, custom: JSON.stringify(map, null, 2) }
  if (Object.values(map).includes('1') && FORWARD_ACTION_KEY in map) return { ...base, kind: 'forwardInfo' }
  const id = map.goformId
  const keys = Object.keys(map).sort().join(',')
  const only = (...expected: string[]) => keys === ['goformId', ...expected].sort().join(',')
  for (const [kind, toggle] of Object.entries(TOGGLES) as [TaskKind, NonNullable<(typeof TOGGLES)[TaskKind]>][]) {
    if (id !== toggle.goformId || !only(...Object.keys(toggle.extra ?? {}), ...toggle.fields)) continue
    const values = toggle.fields.map((f) => map[f])
    if (values.every((v) => v === toggle.on)) return { ...base, kind, on: true }
    if (values.every((v) => v === toggle.off)) return { ...base, kind, on: false }
  }
  switch (id) {
    case 'REBOOT_DEVICE':
      if (only()) return { ...base, kind: 'reboot' }
      break
    case 'SHUTDOWN_DEVICE':
      if (only()) return { ...base, kind: 'shutdown' }
      break
    case 'CONNECT_NETWORK':
    case 'DISCONNECT_NETWORK':
      if (only()) return { ...base, kind: 'data', on: id === 'CONNECT_NETWORK' }
      break
    case 'switchWiFiModule':
      if (only('SwitchOption') && map.SwitchOption === '0') return { ...base, kind: 'wifi', wifi: 'off' }
      break
    case 'switchWiFiChip':
      if ((map.ChipEnum === 'chip1' || map.ChipEnum === 'chip2') && (only('ChipEnum') || only('ChipEnum', 'GuestEnable')))
        return { ...base, kind: 'wifi', wifi: map.ChipEnum }
      break
    case 'SET_BEARER_PREFERENCE':
      if (only('BearerPreference')) return { ...base, kind: 'networkMode', mode: map.BearerPreference }
      break
    case 'SET_SIM_SLOT':
      if (only('sim_slot')) return { ...base, kind: 'simSlot', simSlot: map.sim_slot }
      break
    case 'UNLOCK_ALL_CELL':
      if (only()) return { ...base, kind: 'unlockCells' }
      break
    case 'CELL_LOCK':
      if (only('pci', 'earfcn', 'rat') && (map.rat === '16' || map.rat === '12'))
        return { ...base, kind: 'lockCell', pci: map.pci, earfcn: map.earfcn, rat: map.rat }
      break
    case 'SEND_SMS':
      if (only('Number', 'MessageBody')) return { ...base, kind: 'sendSms', number: map.Number, body: decodeUcs2Hex(map.MessageBody) }
      break
  }
  return { ...base, kind: 'custom' }
}

/** 手机的数字键盘没有冒号：只输了 3–4 位数字时自动补成「HH:mm」，键入时用 */
export function formatTimeInput(raw: string): string {
  const value = raw.replace(/[^\d:]/g, '').slice(0, 5)
  return /^\d{3,4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : value
}

/** 「3:5」「0305」→「03:05」；不合法返回 null */
export function normalizeTime(input: string): string | null {
  const trimmed = input.trim()
  const match = /^(\d{1,2}):?(\d{2})$/.exec(trimmed) ?? /^(\d{1,2}):(\d{1})$/.exec(trimmed)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return null
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

/** 列表排序：下一次触发时间最近的在前；一次性且已执行过的沉到最后 */
export function sortTasks(tasks: TaskInfo[], now = new Date()): TaskInfo[] {
  const minutesNow = now.getHours() * 60 + now.getMinutes()
  const until = (task: TaskInfo) => {
    const [h, m] = task.time.split(':').map(Number)
    const at = (h || 0) * 60 + (m || 0)
    return (at - minutesNow + 1440) % 1440
  }
  const done = (task: TaskInfo) => !task.repeatDaily && Boolean(task.hasTriggered)
  return [...tasks].sort((a, b) => Number(done(a)) - Number(done(b)) || until(a) - until(b) || a.id.localeCompare(b.id))
}
