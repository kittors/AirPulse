import { request, type IncomingMessage, type ServerResponse } from 'node:http'
import type { Connect, Logger, Plugin } from 'vite'

import { createMockApi } from './server'

const DEFAULT_DEVICE = 'http://192.168.0.1:2333'
/** 设备上的 Web 终端（ttyd）端口，与 src/api/advanced.ts 的 TTYD_PORT 一致 */
const TTYD_PORT = 1146
/** 设备在线状态每 15 秒复查一次：USB 拔插后不用重启 dev server */
const PROBE_INTERVAL = 15_000
const PROBE_TIMEOUT = 1_500

/**
 * 开发期的 /api 接入层（dev 与 preview 共用）：
 * - 设备在线 → 交给 Vite 内置代理转发到真机；
 * - 设备离线或强制 Mock → 由 mock/ 下的模拟设备应答，响应头带 x-airpulse-mock: 1，
 *   前端据此在顶栏显示「模拟数据」，避免把假数据当真。
 *
 * 另外把 /ttyd/ 代理到设备的 Web 终端（含 WebSocket）：页面开在 localhost 时，浏览器不一定能直连设备
 * （开着代理 / VPN 时常见），终端 iframe 直连 192.168.0.1:1146 就会一直黑屏；走同源代理就没这个问题。
 *
 * 只做 HTTP 访问，不碰本机任何网络配置。
 */
export function airpulseDevApi(options: { forceMock?: boolean } = {}): Plugin {
  const target = (process.env.AIRPULSE_DEVICE || DEFAULT_DEVICE).replace(/\/+$/, '')
  const forceMock = options.forceMock || process.env.AIRPULSE_MOCK === '1'
  const mock = createMockApi()
  let online = false
  let firstProbe: Promise<void> | undefined

  async function probe(logger: Logger) {
    const was = online
    online = await reachable(`${target}/api/version_info`)
    if (online !== was || !firstProbe) {
      logger.info(
        online
          ? `\x1b[32m[airpulse]\x1b[0m 已连接真机 ${target}，/api 走代理`
          : `\x1b[33m[airpulse]\x1b[0m 未探测到设备 ${target}，/api 改用 Mock 数据`,
        { timestamp: true },
      )
    }
  }

  function install(middlewares: Connect.Server, logger: Logger) {
    if (forceMock) {
      logger.info('\x1b[33m[airpulse]\x1b[0m 已强制使用 Mock 数据', { timestamp: true })
    } else {
      firstProbe = probe(logger)
      const timer = setInterval(() => void probe(logger), PROBE_INTERVAL)
      timer.unref()
    }

    middlewares.use(async (req, res, next) => {
      const url = req.url ?? ''
      if (url !== '/api' && !url.startsWith('/api/') && !url.startsWith('/api?')) return next()
      if (!forceMock) {
        await firstProbe
        if (online && LENIENT.test(url)) return forwardLenient(target, req, res, logger)
        if (online) return next()
      }
      try {
        await mock.handle(req, res)
      } catch (error) {
        logger.error(`[airpulse] Mock 处理 ${req.method} ${url} 出错：${String(error)}`)
        if (!res.headersSent) {
          res.statusCode = 500
          res.setHeader('content-type', 'application/json; charset=utf-8')
        }
        res.end(JSON.stringify({ error: String(error) }))
      }
    })
  }

  const terminal = new URL(target)
  terminal.port = String(TTYD_PORT)
  const proxy = {
    '/api': { target, changeOrigin: true },
    // ttyd 按页面路径拼 token / ws 地址：/ttyd/token → /token，/ttyd/ws → /ws
    '^/ttyd(/|$)': { target: terminal.origin, changeOrigin: true, ws: true, rewrite: (path: string) => path.replace(/^\/ttyd/, '') || '/' },
  }

  return {
    name: 'airpulse-dev-api',
    config: () => (forceMock ? undefined : { server: { proxy }, preview: { proxy } }),
    configureServer: (server) => install(server.middlewares, server.config.logger),
    configurePreviewServer: (server) => install(server.middlewares, server.config.logger),
  }
}

/**
 * 设备的 /api/speedtest 同时带 Content-Length 和 Transfer-Encoding: chunked（Ktor 的 respondBytesWriter
 * 本身按 chunked 发，后端又手动加了 Content-Length）。浏览器直连设备时按 chunked 读、没问题；
 * Node 的 HTTP 解析器按规范拒收这种响应，Vite 代理随之回 500。这类接口改用宽松解析自己转发。
 */
const LENIENT = /^\/api\/speedtest(\?|$)/

function forwardLenient(target: string, req: IncomingMessage, res: ServerResponse, logger: Logger) {
  const url = new URL(req.url ?? '/', target)
  const upstream = request(
    url,
    { method: req.method, headers: { ...req.headers, host: url.host }, insecureHTTPParser: true },
    (incoming) => {
      const headers = { ...incoming.headers }
      // 正文已按 chunked 解开；两个长度头都去掉，交给 Node 重新分块发给浏览器
      delete headers['content-length']
      delete headers['transfer-encoding']
      res.writeHead(incoming.statusCode ?? 502, headers)
      incoming.pipe(res)
    },
  )
  upstream.on('error', (error) => {
    logger.error(`[airpulse] 转发 ${req.url} 出错：${String(error)}`)
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end()
  })
  // 浏览器停止测速（取消读取）时，把到设备的连接也断掉
  res.on('close', () => upstream.destroy())
  req.pipe(upstream)
}

async function reachable(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT) })
    return res.ok
  } catch {
    return false
  }
}
