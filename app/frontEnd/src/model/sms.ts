/**
 * 短信（官方后台 sms_data_total）。
 * 内容是 UTF-8 的 Base64；日期是「yy,MM,dd,HH,mm,ss,+时区」，时区以 15 分钟为单位（+32 = UTC+8）。
 * tag：0 已读、1 未读、2 已发送、3 发送失败、4 草稿。
 */

export interface RawSms {
  id?: string
  number?: string
  content?: string
  tag?: string
  date?: string
}

export interface SmsMessage {
  id: string
  number: string
  body: string
  unread: boolean
  outgoing: boolean
  failed: boolean
  /** 毫秒时间戳；解析不了时为 null */
  time: number | null
}

export function decodeSmsBody(base64: string): string {
  try {
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = Uint8Array.from(binary, (ch) => ch.charCodeAt(0))
    return new TextDecoder('utf-8').decode(bytes)
  } catch {
    return ''
  }
}

export function parseSmsDate(value: string | undefined): number | null {
  const parts = (value ?? '').split(',').map((part) => part.trim())
  if (parts.length < 6) return null
  const [yy, MM, dd, HH, mm, ss] = parts.slice(0, 6).map(Number)
  if ([yy, MM, dd, HH, mm, ss].some((n) => !Number.isFinite(n))) return null
  const zone = Number.parseInt(parts[6] ?? '+32', 10)
  const offsetMin = Number.isFinite(zone) ? zone * 15 : 480
  const year = yy < 100 ? 2000 + yy : yy
  return Date.UTC(year, MM - 1, dd, HH, mm, ss) - offsetMin * 60_000
}

/**
 * 从短信里认出验证码：优先找「验证码 / 校验码 / 动态码 / code」附近的 4–8 位数字，
 * 再试「123456 是您的验证码」这种倒装；没有关键词的短信不猜，免得把金额、单号当成验证码。
 */
export function extractCode(body: string): string | null {
  const keyword = '(?:验证码|校验码|动态码|动态密码|确认码|激活码|安全码|登录码|verification code|code|otp)'
  const after = new RegExp(`${keyword}[^0-9]{0,16}?([0-9]{4,8})(?![0-9])`, 'i').exec(body)
  if (after) return after[1]
  const before = new RegExp(`(?<![0-9])([0-9]{4,8})[^0-9]{0,8}(?:是|为)?(?:您|你)?的?${keyword}`, 'i').exec(body)
  return before ? before[1] : null
}

export function parseSms(raw: RawSms): SmsMessage | null {
  if (!raw.id) return null
  const tag = String(raw.tag ?? '')
  return {
    id: String(raw.id),
    number: String(raw.number ?? ''),
    body: decodeSmsBody(String(raw.content ?? '')),
    unread: tag === '1',
    outgoing: tag === '2' || tag === '3' || tag === '4',
    failed: tag === '3',
    time: parseSmsDate(raw.date),
  }
}

/**
 * 发送用的正文编码：UTF-16BE 十六进制（与原版 gsmEncode 一致，设备 SEND_SMS 的 MessageBody 要这个格式）。
 * JS 字符串本身就是 UTF-16，逐个码元取高低字节即可，emoji 的代理对自然拆成两个码元。
 */
export function encodeSmsBody(text: string): string {
  let hex = ''
  for (let i = 0; i < text.length; i += 1) hex += text.charCodeAt(i).toString(16).padStart(4, '0')
  return hex
}

/** 按 UCS-2 计条数：单条 70 个字，超过后每条 67 个字（长短信要留出拼接头） */
export function smsSegments(text: string): number {
  const units = text.length
  if (units === 0) return 0
  return units <= 70 ? 1 : Math.ceil(units / 67)
}

/** 号码归一：去掉空格、横线，+86 / 86 开头的 11 位手机号去掉国家码，方便把同一个人的短信归到一起 */
export function normalizeNumber(number: string): string {
  const compact = number.replace(/[\s-]/g, '')
  const match = /^(?:\+?86)(1\d{10})$/.exec(compact)
  return match ? match[1] : compact
}

export interface Conversation {
  number: string
  /** 时间正序（旧的在上） */
  messages: SmsMessage[]
  last: SmsMessage
  unread: number
}

/** 按号码分组成会话，最近有消息的会话排在前面 */
export function groupConversations(messages: SmsMessage[]): Conversation[] {
  const map = new Map<string, SmsMessage[]>()
  for (const message of messages) {
    const key = normalizeNumber(message.number)
    const list = map.get(key)
    if (list) list.push(message)
    else map.set(key, [message])
  }
  return [...map.entries()]
    .map(([number, list]) => {
      const sorted = [...list].sort((a, b) => (a.time ?? 0) - (b.time ?? 0) || Number(a.id) - Number(b.id))
      return { number, messages: sorted, last: sorted[sorted.length - 1], unread: sorted.filter((m) => m.unread).length }
    })
    .sort((a, b) => (b.last.time ?? 0) - (a.last.time ?? 0))
}
