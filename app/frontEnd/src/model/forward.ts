/**
 * 短信转发的推送服务预设（纯函数）。后端的 curl 渠道执行用户给的 curl 命令，见 docs/legacy-network-sms.md §6.4：
 * - 必须同时包含 {{sms-body}}、{{sms-time}}、{{sms-from}} 三个占位符，否则保存失败；
 * - {{sms-body}} 只做 JSON 字符串转义（换行变 \n、" 变 \"），不做 shell / URL 编码；
 * - 参数按引号切分、不经过 shell，引号内的反斜杠原样保留。
 * 所以请求体统一用单引号包住的 JSON：换行和双引号都能正确送达；代价是短信里出现英文单引号时这条会推送失败。
 *
 * 预设只负责「填几个参数 → 生成命令」；读回已保存的命令时，按同一个模板反解参数，
 * 重新生成后与原文完全一致才认作该预设，否则一律当自定义命令展示，绝不改动用户的原文。
 */

export const SMS_PLACEHOLDERS = ['{{sms-body}}', '{{sms-time}}', '{{sms-from}}'] as const
export const DEVICE_PLACEHOLDERS = [
  '{{nickname}}',
  '{{model}}',
  '{{battery-level}}',
  '{{cpu-temp}}',
  '{{cpu-usage}}',
  '{{mem-usage}}',
  '{{daily-flow}}',
  '{{monthly-flow-sum}}',
  '{{boot-time}}',
  '{{app-ver}}',
] as const

export type PresetId = 'bark' | 'telegram' | 'wecom' | 'feishu' | 'pushplus' | 'serverchan' | 'ntfy' | 'gotify' | 'webhook'

export interface PresetField {
  key: string
  kind: 'url' | 'token'
  default?: string
  placeholder: string
}

export interface Preset {
  id: PresetId
  fields: PresetField[]
  build: (params: Record<string, string>) => string
}

const JSON_HEADER = `-H 'Content-Type: application/json; charset=utf-8'`
const LINES = '{{sms-from}}\\n{{sms-body}}\\n{{sms-time}}'
const LABELLED = '【号码】{{sms-from}}\\n【内容】{{sms-body}}\\n【时间】{{sms-time}}'
const trimSlash = (url: string) => url.replace(/\/+$/, '')

export const PRESETS: Preset[] = [
  {
    id: 'bark',
    fields: [
      { key: 'server', kind: 'url', default: 'https://api.day.app', placeholder: 'https://api.day.app' },
      { key: 'key', kind: 'token', placeholder: 'Bark Key' },
    ],
    build: (p) =>
      `curl -s -X POST "${trimSlash(p.server)}/${p.key}" ${JSON_HEADER} -d '{"title":"{{sms-from}}","body":"{{sms-body}}\\n{{sms-time}}","group":"AirPulse","isArchive":1}'`,
  },
  {
    id: 'telegram',
    fields: [
      { key: 'token', kind: 'token', placeholder: '123456:ABC-DEF…' },
      { key: 'chat', kind: 'token', placeholder: 'Chat ID' },
    ],
    build: (p) => `curl -s -X POST "https://api.telegram.org/bot${p.token}/sendMessage" ${JSON_HEADER} -d '{"chat_id":"${p.chat}","text":"${LINES}"}'`,
  },
  {
    id: 'wecom',
    fields: [{ key: 'key', kind: 'token', placeholder: 'Webhook key' }],
    build: (p) =>
      `curl -s -X POST "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=${p.key}" ${JSON_HEADER} -d '{"msgtype":"text","text":{"content":"${LABELLED}"}}'`,
  },
  {
    id: 'feishu',
    fields: [{ key: 'token', kind: 'token', placeholder: 'Webhook token' }],
    build: (p) =>
      `curl -s -X POST "https://open.feishu.cn/open-apis/bot/v2/hook/${p.token}" ${JSON_HEADER} -d '{"msg_type":"text","content":{"text":"${LABELLED}"}}'`,
  },
  {
    id: 'pushplus',
    fields: [{ key: 'token', kind: 'token', placeholder: 'Token' }],
    build: (p) =>
      `curl -s -X POST "https://www.pushplus.plus/send" ${JSON_HEADER} -d '{"token":"${p.token}","title":"{{sms-from}}","content":"{{sms-body}}\\n\\n{{sms-time}}","template":"txt"}'`,
  },
  {
    id: 'serverchan',
    fields: [{ key: 'key', kind: 'token', placeholder: 'SendKey' }],
    build: (p) => `curl -s -X POST "https://sctapi.ftqq.com/${p.key}.send" ${JSON_HEADER} -d '{"title":"{{sms-from}}","desp":"{{sms-body}}\\n\\n{{sms-time}}"}'`,
  },
  {
    id: 'ntfy',
    fields: [
      { key: 'server', kind: 'url', default: 'https://ntfy.sh', placeholder: 'https://ntfy.sh' },
      { key: 'topic', kind: 'token', placeholder: 'topic' },
    ],
    build: (p) => `curl -s -X POST "${trimSlash(p.server)}" ${JSON_HEADER} -d '{"topic":"${p.topic}","title":"{{sms-from}}","message":"{{sms-body}}\\n{{sms-time}}"}'`,
  },
  {
    id: 'gotify',
    fields: [
      { key: 'server', kind: 'url', placeholder: 'https://gotify.example.com' },
      { key: 'token', kind: 'token', placeholder: 'App token' },
    ],
    build: (p) =>
      `curl -s -X POST "${trimSlash(p.server)}/message?token=${p.token}" ${JSON_HEADER} -d '{"title":"{{sms-from}}","message":"{{sms-body}}\\n{{sms-time}}","priority":5}'`,
  },
  {
    id: 'webhook',
    fields: [{ key: 'url', kind: 'url', placeholder: 'https://example.com/hook' }],
    build: (p) => `curl -s -X POST "${p.url}" ${JSON_HEADER} -d '{"from":"{{sms-from}}","body":"{{sms-body}}","time":"{{sms-time}}"}'`,
  },
]

export const presetById = (id: PresetId) => PRESETS.find((preset) => preset.id === id)!

/** 参数里不能有空白、引号和反斜杠（会破坏命令的切分） */
export function validParam(field: PresetField, value: string): boolean {
  const v = value.trim()
  if (!v || /[\s'"\\]/.test(v)) return false
  return field.kind === 'url' ? /^https?:\/\/[^/]+/i.test(v) : !v.includes('/')
}

/** 按模板反解参数：模板里的参数位换成捕获组，其余部分按字面量匹配；重新生成后必须与原文一致 */
export function detectPreset(text: string): { id: PresetId; params: Record<string, string> } | null {
  const source = text.trim()
  if (!source) return null
  for (const preset of PRESETS) {
    const keys = preset.fields.map((f) => f.key)
    const sentinel = (i: number) => `\u0000${i}\u0000`
    const skeleton = preset.build(Object.fromEntries(keys.map((key, i) => [key, sentinel(i)])))
    const order: string[] = []
    const pattern = skeleton
      .split(/(\u0000\d+\u0000)/)
      .map((part) => {
        const m = /^\u0000(\d+)\u0000$/.exec(part)
        if (!m) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const field = preset.fields[Number(m[1])]
        order.push(field.key)
        // 令牌类参数不含 /，这样「服务器地址/令牌」能唯一切开
        return field.kind === 'url' ? '([^\\s\'"\\\\]+?)' : '([^\\s\'"\\\\/]+)'
      })
      .join('')
    const match = new RegExp(`^${pattern}$`).exec(source)
    if (!match) continue
    const params = Object.fromEntries(order.map((key, i) => [key, match[i + 1]]))
    if (preset.build(params) === source) return { id: preset.id, params }
  }
  return null
}

/** 自定义命令：去掉行尾续行符、把换行并成空格（后端要求「一口气」的单行命令） */
export function normalizeCurl(text: string): string {
  return text
    .replace(/\\\r?\n/g, ' ')
    .replace(/\r?\n/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

export function missingPlaceholders(text: string): string[] {
  return SMS_PLACEHOLDERS.filter((p) => !text.includes(p))
}

/** 号码黑名单：只允许数字，每行一个（后端会拒绝其它字符） */
export const validPhoneList = (text: string) => /^[0-9\n\r ]*$/.test(text)
export const cleanLines = (text: string) =>
  text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')

/**
 * 粘贴整条链接时自动拆出参数（例如 Bark App 里复制的推送链接、企业微信的 Webhook 地址），
 * 用户不用自己找「key= 后面那一段」。认不出来就原样返回。
 */
export function smartFill(id: PresetId, key: string, raw: string): Record<string, string> {
  const value = raw.trim()
  if (!/^https?:\/\//i.test(value)) return { [key]: raw }
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { [key]: raw }
  }
  const segments = url.pathname.split('/').filter(Boolean)
  const pick = (found: string | null | undefined, extra: Record<string, string> = {}) => (found ? { ...extra, [key]: found } : { [key]: raw })
  switch (`${id}.${key}`) {
    case 'bark.key':
      return pick(segments[0], { server: url.origin })
    case 'wecom.key':
      return pick(url.searchParams.get('key'))
    case 'feishu.token':
      return pick(segments.at(-1))
    case 'serverchan.key':
      return pick(segments[0]?.replace(/\.send$/, ''))
    case 'gotify.token':
      return pick(url.searchParams.get('token'), { server: url.origin })
    case 'telegram.token':
      return pick(segments[0]?.replace(/^bot/, ''))
    default:
      return { [key]: raw }
  }
}

/** 邮件端口决定加密方式（后端：这些端口走隐式 SSL，其余 STARTTLS） */
export const SSL_PORTS = ['465', '2465', '8465', '443', '588']
export const validEmail = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
