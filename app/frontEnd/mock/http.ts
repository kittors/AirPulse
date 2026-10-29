import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Mock 各功能模块共用的请求 / 响应类型与小工具。
 * 真机后端多数接口：成功 HTTP 200 + JSON，失败 HTTP 500 + {"error":"…"}；例外见 docs/legacy-tools.md §1.1。
 */

export type Json = Record<string, unknown>

export interface ApiRequest {
  path: string
  method: string
  query: URLSearchParams
  /** 原始查询串（含「?」）：代理要把它原样拼进目标地址 */
  search: string
  /** 请求体按 JSON 对象解析的结果；空体、非法 JSON 或不是对象时为 null（真机这时多半报 org.json 的异常） */
  json: Json | null
  /** 请求体文本（multipart 时为空串） */
  text: string
  /** 请求体原始字节（上传用） */
  raw: Buffer
  contentType: string
}

/** 三种返回：JSON；原始文本 / 二进制（自动带 Content-Length）；自己接管响应（流式输出） */
export type ApiResult =
  | { status: number; body: unknown }
  | { status: number; raw: string | Buffer; contentType: string; headers?: Record<string, string> }
  | { stream: (req: IncomingMessage, res: ServerResponse) => void }

export const ok = (body: unknown = { result: 'success' }): ApiResult => ({ status: 200, body })
export const fail = (error: string, status = 500): ApiResult => ({ status, body: { error } })
export const plain = (status: number, text: string): ApiResult => ({ status, raw: text, contentType: 'text/plain; charset=utf-8' })

export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))
/** [min, max) 之间的随机数 */
export const between = (min: number, max: number) => min + Math.random() * (max - min)

/** 请求体不是 JSON 对象时 org.json 的异常文本（真机会原样拼进 error） */
export function orgJsonError(text: string): string {
  const body = text.trim()
  if (!body) return 'End of input at character 0 of '
  const shown = body.length > 80 ? `${body.slice(0, 80)}…` : body
  if (body.startsWith('{')) return `Unterminated object at character ${body.length} of ${shown}`
  return `Value ${shown} of type ${body.startsWith('[') ? 'org.json.JSONArray' : 'java.lang.String'} cannot be converted to JSONObject`
}

/** org.json 的 optString：数字 / 布尔转字符串，对象转 JSON 文本，null 为 "null"，缺失用默认值 */
export function optString(value: unknown, fallback = ''): string {
  if (value === undefined) return fallback
  if (typeof value === 'string') return value
  if (value === null) return 'null'
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** org.json 的 optBoolean：布尔或 "true" / "false"（不区分大小写），其它用默认值 */
export function optBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string' && /^(true|false)$/i.test(value)) return value.toLowerCase() === 'true'
  return fallback
}

/** 设备时区固定 UTC+8 */
export const DEVICE_TZ = 8 * 3_600_000

const pad = (n: number, width = 2, fill = '0') => String(n).padStart(width, fill)

/** 设备 shell 的 date 格式：Thu Oct 29 03:12:08 CST 2026（日期不足两位时前面补空格） */
export function shellDate(at = Date.now()): string {
  const d = new Date(at + DEVICE_TZ)
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getUTCDay()]
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()]
  const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  return `${day} ${month} ${pad(d.getUTCDate(), 2, ' ')} ${time} CST ${d.getUTCFullYear()}`
}

/** 设备时间 yyyy-MM-dd HH:mm（ls -l 用）；dateOnly 时为 yyyyMMdd */
export function deviceStamp(at = Date.now(), dateOnly = false): string {
  const d = new Date(at + DEVICE_TZ)
  const date = [d.getUTCFullYear(), pad(d.getUTCMonth() + 1), pad(d.getUTCDate())]
  return dateOnly ? date.join('') : `${date.join('-')} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
}
