import type { IncomingMessage, ServerResponse } from 'node:http'

import { deviceFor, expectedSign, type MockDevice } from './device'
import { NR_SUPPORTED_BANDS, SCENARIOS } from './fixtures'
import { between, fail, ok, optString, sleep, type ApiRequest, type ApiResult, type Json } from './http'

/**
 * 模拟设备的 HTTP 层：鉴权 → 路由 → 带随机延迟返回。
 *
 * 场景切换：在页面地址后加 ?mock=<场景>（通过请求的 Referer 读取），例如
 *   http://localhost:5173/?mock=nsa      中国电信 5G NSA
 *   http://localhost:5173/?mock=lte      中国联通 4G（原版截图实测值，带电池）
 *   http://localhost:5173/?mock=weak     弱信号边缘
 * 也可以用环境变量 AIRPULSE_MOCK_SCENARIO 指定默认场景。可选值见 fixtures.ts 的 SCENARIOS。
 */

/** 与后端 KanoAuth 一致的免鉴权端点 */
const OPEN_EXACT = new Set(['/api/get_custom_head', '/api/version_info', '/api/need_token', '/api/get_theme', '/api/SELinux'])
const OPEN_PREFIX = ['/api/uploads']

function scenarioOf(req: IncomingMessage): string {
  try {
    const referer = req.headers.referer
    const fromPage = referer ? new URL(referer).searchParams.get('mock') : null
    if (fromPage && fromPage in SCENARIOS) return fromPage
  } catch {
    /* 非法 Referer：用默认场景 */
  }
  const env = process.env.AIRPULSE_MOCK_SCENARIO
  return env && env in SCENARIOS ? env : 'sa'
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of req) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks)
}

/** 请求体按 JSON 对象解析；空体、非法 JSON、不是对象都为 null */
function parseJson(text: string): Json | null {
  try {
    const value: unknown = JSON.parse(text)
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Json) : null
  } catch {
    return null
  }
}

function reply(req: IncomingMessage, res: ServerResponse, result: ApiResult, headers: Record<string, string> = {}) {
  res.setHeader('x-airpulse-mock', '1')
  if ('stream' in result) {
    result.stream(req, res)
    return
  }
  res.statusCode = result.status
  res.setHeader('cache-control', 'no-store')
  for (const [key, value] of Object.entries(headers)) res.setHeader(key, value)
  if ('raw' in result) {
    const data = typeof result.raw === 'string' ? Buffer.from(result.raw, 'utf8') : result.raw
    res.setHeader('content-type', result.contentType)
    res.setHeader('content-length', String(data.length))
    for (const [key, value] of Object.entries(result.headers ?? {})) res.setHeader(key, value)
    res.end(data)
    return
  }
  if (result.status === 401) {
    res.end()
    return
  }
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.end(JSON.stringify(result.body))
}

function authorized(req: IncomingMessage, path: string, device: MockDevice): boolean {
  if (OPEN_EXACT.has(path) || OPEN_PREFIX.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))) return true
  const t = req.headers['kano-t']
  const sign = req.headers['kano-sign']
  const auth = req.headers.authorization
  if (typeof t !== 'string' || typeof sign !== 'string' || typeof auth !== 'string') return false
  if (auth.trim().toLowerCase() !== device.tokenHash()) return false
  return expectedSign(req.method ?? 'GET', path, t) === sign.toLowerCase()
}

export function createMockApi() {
  return {
    async handle(req: IncomingMessage, res: ServerResponse) {
      const url = new URL(req.url ?? '/', 'http://mock.local')
      const path = url.pathname
      const method = (req.method ?? 'GET').toUpperCase()
      const device = deviceFor(scenarioOf(req))
      const { features } = device
      // OTA 安装成功后 App 进程重启：这段时间的请求直接断开连接
      if (features.offline()) {
        req.socket.destroy()
        return
      }
      await sleep(between(40, 160))

      if (!authorized(req, path, device)) return reply(req, res, { status: 401, body: null })

      const raw = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req)
      const contentType = String(req.headers['content-type'] ?? '')
      const text = /^multipart\//i.test(contentType) ? '' : raw.toString('utf8')
      const request: ApiRequest = { path, method, query: url.searchParams, search: url.search, json: parseJson(text), text, raw, contentType }
      const cookie = typeof req.headers['kano-cookie'] === 'string' ? req.headers['kano-cookie'] : undefined

      switch (path) {
        case '/api/version_info': {
          const model = device.scenario.model ?? 'F50'
          // 别名没设置过时等于型号
          return reply(req, res, ok({ ...features.version(), model, nickname: device.nickname || model, accept_terms: true }))
        }
        case '/api/need_token':
          return reply(req, res, ok({ need_token: true }))
        case '/api/is_weak_token':
          return reply(req, res, ok({ is_weak_token: device.token === 'admin' || device.token.length < 8 || !/\d/.test(device.token) || !/[a-z]/i.test(device.token) }))
        case '/api/baseDeviceInfo':
          return reply(req, res, ok(device.deviceInfo()))
        case '/api/get_cookie':
          return reply(req, res, ok({ cookie: device.storedCookie }))
        case '/api/set_cookie':
          device.storedCookie = optString(request.json?.cookie)
          return reply(req, res, ok())
        case '/api/set_token': {
          const next = optString(request.json?.token).trim()
          if (!next) return reply(req, res, fail('请提供 token'))
          if (next.length < 8) return reply(req, res, fail('token 需要至少8位'))
          if (!/^(?=.*[a-zA-Z])(?=.*\d).{8,128}$/.test(next)) return reply(req, res, fail('口令需要至少同时包含数字和字母'))
          device.token = next
          return reply(req, res, ok())
        }
        case '/api/getSupportNrBandList':
          return reply(req, res, ok({ slot: Number(url.searchParams.get('slot') ?? 0), band_list: NR_SUPPORTED_BANDS }))
        case '/api/AT': {
          const command = url.searchParams.get('command')
          if (command === null) return reply(req, res, fail('AT指令执行错误：缺少 query 参数 command'))
          if (!/^AT/i.test(command.trim())) return reply(req, res, fail('AT指令执行错误：解析失败，AT指令需要以 “AT” 开头'))
          // slot 不是整数就用 0
          const slot = /^[+-]?\d+$/.test(url.searchParams.get('slot') ?? '') ? Number(url.searchParams.get('slot')) : 0
          const result = await device.runAt(command.trim(), slot)
          // 基带报 ERROR 也是 HTTP 200；sh 出错或超时才是 500
          return reply(req, res, result === null ? fail('AT指令执行错误：AT 指令没有输出') : ok({ result }))
        }
        case '/api/goform/goform_get_cmd_process': {
          const cmds = (url.searchParams.get('cmd') ?? '').split(',').filter(Boolean)
          return reply(req, res, ok(device.read(cmds, cookie)))
        }
        case '/api/goform/goform_set_cmd_process': {
          const form = Object.fromEntries(new URLSearchParams(text))
          const { body, setCookie } = device.write(form, cookie)
          return reply(req, res, ok(body), setCookie ? { 'kano-cookie': setCookie } : {})
        }
        default: {
          const result = await features.api(request)
          return reply(req, res, result ?? fail(`Mock 未实现：${method} ${path}`, 404))
        }
      }
    },
  }
}
