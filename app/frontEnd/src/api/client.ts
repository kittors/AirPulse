import { getT } from '@/i18n'
import { ApiError } from '@/lib/errors'
import { createStore } from '@/lib/store'

import { authStatusStore, credentialsStore, signOut } from './auth'
import { kanoSign } from './crypto'

/**
 * 统一请求入口（同源 /api，开发期由 Vite 代理到真机或 Mock）。
 * - 自动附加 kano-t / kano-sign / authorization 三个鉴权头；
 * - 超时、断网、HTTP 错误、设备返回的 {"error": "..."} 都转成 ApiError；
 * - 任何非静默请求收到 401 → 口令失效，清除凭据回登录页；
 * - 响应头 x-airpulse-mock 标记当前是不是 Mock 数据（只有开发服务器会带）。
 */

export const API_BASE = '/api'

/**
 * 修改访问口令期间短暂忽略 401：后端切换口令的瞬间可能还有一次带旧口令的轮询在途，
 * 不能因此把用户踢回登录页。
 */
let ignoreUnauthorizedUntil = 0
export function suspendUnauthorizedRedirect(ms: number) {
  ignoreUnauthorizedUntil = Date.now() + ms
}

/** 当前数据是否来自本地 Mock */
export const mockStore = createStore(false)
/** 最近一次请求是否连得上设备（断网横幅用） */
export const reachableStore = createStore(true)

type QueryValue = string | number | boolean | null | undefined

export interface RequestOptions {
  method?: 'GET' | 'POST'
  query?: Record<string, QueryValue>
  /** JSON 请求体 */
  json?: unknown
  /** application/x-www-form-urlencoded 请求体（goform 写操作） */
  form?: Record<string, string | number | boolean>
  /** 原样发送的请求体（例如 FormData 上传） */
  body?: BodyInit
  headers?: Record<string, string | undefined>
  /** 毫秒，默认 10 秒 */
  timeout?: number
  signal?: AbortSignal
  /** 免鉴权端点（白名单）：不带签名与口令 */
  anonymous?: boolean
  /** 401 由调用方自行处理（登录校验口令时） */
  silent401?: boolean
}

export function buildUrl(path: string, query?: Record<string, QueryValue>): string {
  const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
  if (!query) return url
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null) continue
    params.append(key, String(value))
  }
  const search = params.toString()
  return search ? `${url}?${search}` : url
}

/** 签名用的路径：URL 解析后的 pathname（不含 query），与后端校验方式一致 */
function signPath(url: string): string {
  return new URL(url, window.location.origin).pathname
}

/** 把调用方的 signal 与超时合并（Safari 16 没有 AbortSignal.any，手动合并） */
function withTimeout(timeout: number, external?: AbortSignal) {
  const controller = new AbortController()
  let timedOut = false
  const timer = window.setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeout)
  const onAbort = () => controller.abort()
  if (external) {
    if (external.aborted) controller.abort()
    else external.addEventListener('abort', onAbort, { once: true })
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    dispose: () => {
      window.clearTimeout(timer)
      external?.removeEventListener('abort', onAbort)
    },
  }
}

export async function request(path: string, options: RequestOptions = {}): Promise<Response> {
  const t = getT()
  const method = options.method ?? (options.json !== undefined || options.form || options.body ? 'POST' : 'GET')
  const url = buildUrl(path, options.query)
  const headers = new Headers()
  for (const [key, value] of Object.entries(options.headers ?? {})) if (value) headers.set(key, value)

  if (!options.anonymous) {
    const timestamp = Date.now()
    headers.set('kano-t', String(timestamp))
    headers.set('kano-sign', kanoSign(method, signPath(url), timestamp))
    const token = credentialsStore.get()?.tokenHash
    if (token) headers.set('authorization', token)
  }

  let body: BodyInit | undefined = options.body
  if (options.json !== undefined) {
    body = JSON.stringify(options.json)
    headers.set('content-type', 'application/json')
  } else if (options.form) {
    const form = new URLSearchParams()
    for (const [key, value] of Object.entries(options.form)) form.append(key, String(value))
    body = form
    headers.set('content-type', 'application/x-www-form-urlencoded; charset=UTF-8')
  }

  const guard = withTimeout(options.timeout ?? 10_000, options.signal)
  let response: Response
  try {
    response = await fetch(url, { method, headers, body, signal: guard.signal, cache: 'no-store' })
  } catch (error) {
    if (guard.timedOut()) {
      reachableStore.set(false)
      throw new ApiError('timeout', t.errors.timeout)
    }
    if (options.signal?.aborted) throw error
    reachableStore.set(false)
    throw new ApiError('network', t.errors.network)
  } finally {
    guard.dispose()
  }

  reachableStore.set(true)
  mockStore.set(response.headers.get('x-airpulse-mock') === '1')

  if (response.status === 401 && !options.anonymous) {
    if (!options.silent401 && authStatusStore.get() === 'signed-in' && Date.now() > ignoreUnauthorizedUntil) {
      signOut('expired')
    }
    throw new ApiError('unauthorized', t.errors.unauthorized, 401)
  }
  if (!response.ok) {
    const text = await response.clone().text().catch(() => '')
    throw new ApiError('http', errorFromBody(text) ?? t.errors.http(response.status), response.status)
  }
  return response
}

/**
 * 从错误响应体里取出说明。后端很多错误是字符串模板拼的、没有转义，
 * 内容带引号或换行时整体不是合法 JSON——先按 JSON 解析，不行再按 "error":"…" 的形状硬取，
 * 再不行且是短的纯文本（如测速 429、代理 403）就原样显示。
 */
export function errorFromBody(text: string): string | null {
  try {
    const data = JSON.parse(text) as { error?: unknown }
    if (data && typeof data.error === 'string' && data.error.trim()) return stripTags(data.error)
  } catch {
    const match = /"error"\s*:\s*"([\s\S]*)"\s*}\s*$/.exec(text)
    if (match?.[1].trim()) return stripTags(match[1])
    const plain = text.trim()
    if (plain && plain.length <= 200 && !plain.startsWith('<')) return plain
  }
  return null
}

/** 后端文案里夹着 <br> 和中英双语：只取第一段，去掉标签 */
export function stripTags(text: string): string {
  return text.split(/<br\s*\/?>/i)[0].replace(/<[^>]+>/g, '').trim()
}

/** 请求并解析 JSON；设备返回 {"error": "..."}（即使 HTTP 200）也视为失败 */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await request(path, options)
  const text = await response.text()
  let data: unknown
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    // 不合法的 JSON：多半是带了未转义字符的错误文案（install_apk 这类流式接口错误也是 HTTP 200）
    const error = errorFromBody(text)
    throw new ApiError('device', error && /"error"/.test(text) ? error : `${getT().errors.unknown}：${text.slice(0, 120)}`)
  }
  // 有些接口成功时也带空的 error 字段（如 download_apk_status），只把非空字符串当错误
  const error = data && typeof data === 'object' ? (data as { error?: unknown }).error : undefined
  if (typeof error === 'string' && error.trim()) throw new ApiError('device', stripTags(error))
  return data as T
}

/**
 * 上传文件（multipart，字段名 file）：fetch 拿不到上传进度，改用 XMLHttpRequest，签名头手动加。
 * 成功返回后端的 JSON（upload_img 为 {"url":"/uploads/<uuid>.<ext>"}）。
 */
export function uploadFile<T = { url?: string }>(
  path: string,
  file: Blob,
  options: { filename?: string; onProgress?: (loaded: number, total: number) => void; signal?: AbortSignal; timeout?: number } = {},
): Promise<T> {
  const t = getT()
  return new Promise<T>((resolve, reject) => {
    const url = buildUrl(path)
    const xhr = new XMLHttpRequest()
    xhr.open('POST', url)
    const timestamp = Date.now()
    xhr.setRequestHeader('kano-t', String(timestamp))
    xhr.setRequestHeader('kano-sign', kanoSign('POST', signPath(url), timestamp))
    const token = credentialsStore.get()?.tokenHash
    if (token) xhr.setRequestHeader('authorization', token)
    xhr.timeout = options.timeout ?? 15 * 60_000
    xhr.upload.onprogress = (event) => options.onProgress?.(event.loaded, event.lengthComputable ? event.total : file.size)
    xhr.onload = () => {
      reachableStore.set(true)
      if (xhr.status === 401) {
        if (authStatusStore.get() === 'signed-in') signOut('expired')
        return reject(new ApiError('unauthorized', t.errors.unauthorized, 401))
      }
      const text = xhr.responseText
      if (xhr.status < 200 || xhr.status >= 300) return reject(new ApiError('http', errorFromBody(text) ?? t.errors.http(xhr.status), xhr.status))
      try {
        const data = JSON.parse(text) as T & { error?: unknown }
        if (typeof data.error === 'string' && data.error.trim()) return reject(new ApiError('device', stripTags(data.error)))
        resolve(data)
      } catch {
        reject(new ApiError('device', errorFromBody(text) ?? t.errors.unknown))
      }
    }
    xhr.onerror = () => {
      reachableStore.set(false)
      reject(new ApiError('network', t.errors.network))
    }
    xhr.ontimeout = () => reject(new ApiError('timeout', t.errors.timeout))
    xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'))
    if (options.signal?.aborted) return xhr.abort()
    options.signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    const form = new FormData()
    form.append('file', file, options.filename ?? (file instanceof File ? file.name : 'file'))
    xhr.send(form)
  })
}
