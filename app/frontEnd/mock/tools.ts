import { randomBytes } from 'node:crypto'
import type { ServerResponse } from 'node:http'

import { DEVICE_TZ, between, fail, ok, optBoolean, optString, orgJsonError, plain, type ApiRequest, type ApiResult, type Json } from './http'

/**
 * Mock：定时任务、内网测速、经设备代理的流量测速、自定义 head 注入、USB 状态、连接数、SELinux，
 * 格式照 docs/legacy-tools.md §3、§4、§8.1、§9.7、§9.8 与附录 C.3 / C.4 / C.9。
 */

export interface ToolsDeps {
  /** 设备能不能上网：断网时代理解析不了域名，后端一律按「禁止访问」处理 */
  online(): boolean
}

interface Task {
  key: number
  id: string
  time: string
  repeatDaily: boolean
  actionMap: Record<string, string>
  lastRunTimestamp: number | null
  hasTriggered: boolean
}

const MINUTE = 60_000
const DAY = 86_400_000
/** 设备本地（UTC+8）当天 0 点 */
const midnight = (at: number) => at - ((at + DEVICE_TZ) % DAY)

/** kotlinx 默认不输出等于默认值的字段：空 actionMap、从未执行的 lastRunTimestamp、false 的 hasTriggered 都省略 */
function view(task: Task) {
  return {
    key: task.key,
    id: task.id,
    time: task.time,
    repeatDaily: task.repeatDaily,
    ...(Object.keys(task.actionMap).length ? { actionMap: task.actionMap } : {}),
    ...(task.lastRunTimestamp !== null ? { lastRunTimestamp: task.lastRunTimestamp } : {}),
    ...(task.hasTriggered ? { hasTriggered: true } : {}),
  }
}

function seedTasks(): Task[] {
  const now = Date.now()
  const at = (days: number, hh: number, mm: number) => midnight(now) + days * DAY + (hh * 60 + mm) * MINUTE
  const rebootedToday = now >= at(0, 3, 0)
  return [
    // 每日重启：今天 3 点已过就是今天执行过；还没到的话昨天执行过、0 点后已清零
    { key: at(-12, 21, 14), id: '每日重启', time: '03:00', repeatDaily: true, actionMap: { goformId: 'REBOOT_DEVICE' }, lastRunTimestamp: at(rebootedToday ? 0 : -1, 3, 0), hasTriggered: rebootedToday },
    // 一次性任务：执行过后一直留在列表里，不再参与调度
    {
      key: at(-3, 22, 41),
      id: '早上恢复 5G',
      time: '07:30',
      repeatDaily: false,
      actionMap: { goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'WL_AND_5G' },
      lastRunTimestamp: at(-2, 7, 30),
      hasTriggered: true,
    },
  ]
}

/** 后端启动时生成的一块 8 MiB 随机数据，测速时重复发送 */
const BLOCK_SIZE = 8 * 1024 * 1024
const block: { data: Buffer | null } = { data: null }

/**
 * 按速率往响应里写随机数据（约每 50 ms 一批，速率上下浮动 ±20%）。
 * 写满 total 正常结束；到 deadline 直接断开连接（上游总超时把下载截断）；客户端断开就停。
 */
function pump(res: ServerResponse, total: number, rate: number, deadline: number | null, done: () => void) {
  const data = (block.data ??= randomBytes(BLOCK_SIZE))
  const state = { sent: 0, budget: 0, last: Date.now(), finished: false, timer: undefined as ReturnType<typeof setTimeout> | undefined }
  // 浏览器不读了也要按时断开
  const cutoff = deadline === null ? undefined : setTimeout(() => res.destroy(), Math.max(0, deadline - Date.now()))
  res.on('close', () => {
    if (state.finished) return
    state.finished = true
    clearTimeout(state.timer)
    clearTimeout(cutoff)
    done()
  })
  const tick = () => {
    if (state.finished) return
    const now = Date.now()
    if (deadline !== null && now >= deadline) {
      res.destroy()
      return
    }
    // 额度最多攒 200 ms：浏览器卡一下之后不会一口气补发一大块
    state.budget = Math.min(state.budget + ((now - state.last) / 1000) * rate * between(0.8, 1.2), rate * 0.2)
    state.last = now
    let writable = true
    while (state.budget >= 1 && state.sent < total && writable) {
      const offset = state.sent % data.length
      const size = Math.min(Math.floor(state.budget), total - state.sent, data.length - offset, 1 << 20)
      writable = res.write(data.subarray(offset, offset + size))
      state.sent += size
      state.budget -= size
    }
    if (state.sent >= total) {
      res.end()
      return
    }
    if (!writable) {
      // 写缓冲满了：等浏览器读走再继续（TCP 背压，读得慢时速率由浏览器决定），等待期间照常攒额度
      res.once('drain', tick)
      return
    }
    state.timer = setTimeout(tick, 50)
  }
  tick()
}

/**
 * 代理目标是否被拒：解析到 0.0.0.0、环回、链路本地、私网（含 IPv6 的 fe80::/10、fec0::/10）一律 403，
 * 域名解析失败也是 403。Mock 不做 DNS 查询：IP 字面量照规则判断，localhost、单段主机名、.local / .lan 视为解析到内网或解析失败。
 */
function forbidden(host: string): boolean {
  const name = host.replace(/^\[|\]$/g, '').toLowerCase()
  if (!name || name === 'ufi.ztedevice.com' || name === 'localhost' || /\.(localhost|local|lan)$/.test(name)) return true
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(name)
  const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(mapped ? mapped[1] : name)
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])]
    return a === 0 || a === 127 || a === 10 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  }
  if (name.includes(':')) return name === '::' || name === '::1' || /^fe[89a-f]/.test(name)
  return !name.includes('.')
}

/** 上游文件大小：地址里带 100MB、1G 之类的字样就按它，否则当成 1 GiB 的大文件（30 s 内下不完） */
function sizeHint(url: string): number {
  const match = /(\d+(?:\.\d+)?)\s*([kmg])(?:i?b)?(?![a-z])/i.exec(url.split('?')[0])
  if (!match) return 1024 ** 3
  const unit = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[match[2].toLowerCase() as 'k' | 'm' | 'g']
  return Math.min(10 * 1024 ** 3, Math.max(1024, Math.round(Number(match[1]) * unit)))
}

/** 原版插件块格式：块之间空 4 行；停用的块整体包成 [kano_disabled] 注释。示例只放不影响界面的样式 */
const CUSTOM_HEAD = [
  '<!-- [KANO_PLUGIN_START] 示例：调试描边 -->\n<style>.kano-debug-outline{outline:1px dashed currentColor}</style>\n<!-- [KANO_PLUGIN_END] 示例：调试描边 -->',
  '<!-- [KANO_PLUGIN_START] 示例：隐藏滚动条 -->\n<!-- [kano_disabled]\n<style>.kano-hide-scrollbar::-webkit-scrollbar{display:none}</style>\n[kano_disabled] -->\n<!-- [KANO_PLUGIN_END] 示例：隐藏滚动条 -->',
].join('\n\n\n\n')
const HEAD_LIMIT = 5 * 1024 * 1024

export class MockTools {
  private readonly deps: ToolsDeps
  private tasks = seedTasks()
  private speedtests = 0
  private head = CUSTOM_HEAD

  constructor(deps: ToolsDeps) {
    this.deps = deps
  }

  async api(req: ApiRequest): Promise<ApiResult | null> {
    if (req.path.startsWith('/api/proxy/')) return this.proxy(req)
    switch (req.path) {
      case '/api/list_tasks':
        this.refresh()
        return ok({ tasks: [...this.tasks].sort((a, b) => a.key - b.key).map(view) })
      case '/api/get_task': {
        const id = req.query.get('id')
        if (!id) return fail('缺少任务ID', 400)
        this.refresh()
        const task = this.tasks.find((item) => item.id === id)
        return task ? ok(view(task)) : fail('任务不存在', 404)
      }
      case '/api/add_task':
        return this.addTask(req)
      case '/api/remove_task': {
        if (!req.json) return fail(`删除任务失败: ${orgJsonError(req.text)}`)
        const id = optString(req.json.id).trim()
        if (!id) return fail('删除任务失败: 参数id不能为空')
        // id 不存在也返回 removed
        this.tasks = this.tasks.filter((task) => task.id !== id)
        return ok({ result: 'removed' })
      }
      case '/api/clear_task':
        this.tasks = []
        return ok()
      case '/api/speedtest':
        return this.speedtest(req)
      case '/api/get_custom_head':
        return ok({ text: this.head })
      case '/api/set_custom_head': {
        // 错误文本没有转义，原样拼进 JSON（org.json 的异常里带引号时整个响应不是合法 JSON）
        const error = (message: string): ApiResult => ({ status: 500, raw: `{"error":"配置出错: ${message}"}`, contentType: 'application/json; charset=utf-8' })
        if (req.raw.length > HEAD_LIMIT) return error(`插件总容量超出限制: ${Math.floor(req.raw.length / 1024)}KB/${HEAD_LIMIT / 1024}KB`)
        if (!req.json) return error(orgJsonError(req.text))
        this.head = optString(req.json.text).trim()
        return ok()
      }
      case '/api/usb_status':
        // F50 经 USB 接电脑共享网络：设备是 gadget 端
        return ok({ maxSpeed: 0, details: { typec_mode: 'gadget', gadget_speed: 'USB 2.0 (480Mbps)', devices: [] } })
      case '/api/connInfo': {
        const tcp = 18 + Math.floor(Math.random() * 10)
        const active = Math.round(tcp * between(0.3, 0.5))
        const count = (min: number, max: number) => String(min + Math.floor(Math.random() * (max - min + 1)))
        return ok({
          result: 'success',
          data: { tcp: String(tcp), tcp_active: String(active), tcp_other: String(tcp - active), tcp6: count(2, 6), udp: count(10, 15), udp6: count(2, 4), unix: count(175, 190) },
        })
      }
      case '/api/SELinux':
        return ok({ selinux: 'Permissive' })
      default:
        return null
    }
  }

  private addTask(req: ApiRequest): ApiResult {
    if (!req.json) return fail(`添加任务失败: ${orgJsonError(req.text)}`)
    const id = optString(req.json.id).trim()
    let time = optString(req.json.time).trim()
    if (!id || !time) return fail('添加任务失败: 参数不完整')
    const action = req.json.action
    if (!action || typeof action !== 'object' || Array.isArray(action)) return fail('添加任务失败: 请传入action')
    // HH:mm:ss 截成 HH:mm；其它格式原样保存（但永远不会触发）
    if (/^\d{2}:\d{2}:\d{2}$/.test(time)) time = time.slice(0, 5)
    const actionMap = Object.fromEntries(Object.entries(action as Json).map(([key, value]) => [key, optString(value)]))
    // 同 id 覆盖：key 刷新，执行记录清空
    this.tasks = [
      ...this.tasks.filter((task) => task.id !== id),
      { key: Date.now(), id, time, repeatDaily: optBoolean(req.json.repeatDaily, true), actionMap, lastRunTimestamp: null, hasTriggered: false },
    ]
    return ok()
  }

  /** 惰性推进调度：每日任务过了 0 点清零；到点的任务记为执行过（Mock 不真的执行动作） */
  private refresh() {
    const now = Date.now()
    const today = midnight(now)
    for (const task of this.tasks) {
      if (task.repeatDaily && task.lastRunTimestamp !== null && task.lastRunTimestamp < today) task.hasTriggered = false
      // 触发时按字符串比较「HH:mm」，格式不对的永远不会触发
      const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(task.time)
      if (!match || task.hasTriggered) continue
      const offset = (Number(match[1]) * 60 + Number(match[2])) * MINUTE
      // 每日任务看今天的这个时刻；一次性任务是保存之后的第一个这个时刻（今天已过就是明天）
      let fire = today + offset
      if (!task.repeatDaily) {
        fire = midnight(task.key) + offset
        if (fire <= task.key) fire += DAY
      }
      if (fire > task.key && fire <= now) {
        task.lastRunTimestamp = fire
        task.hasTriggered = true
      }
    }
  }

  /** GET /api/speedtest?ckSize=<n>[&cors]：n × 8 MiB 随机数据，300–600 Mbit/s；同时最多 3 个连接 */
  private speedtest(req: ApiRequest): ApiResult {
    if (this.speedtests >= 3) return plain(429, '测速请求过多，请稍后再试')
    const raw = req.query.get('ckSize') ?? ''
    const n = /^[+-]?\d{1,10}$/.test(raw) ? Number(raw) : Number.NaN
    const chunks = !(n > 0) || n > 2 ** 31 - 1 ? 4 : Math.min(n, 1024)
    const total = chunks * BLOCK_SIZE
    const cors = req.query.has('cors')
    return {
      stream: (_req, res) => {
        this.speedtests += 1
        res.writeHead(200, {
          'content-type': 'application/octet-stream',
          'content-length': String(total),
          'content-disposition': 'attachment; filename=random.dat',
          'cache-control': 'no-store',
          pragma: 'no-cache',
          ...(cors ? { 'access-control-allow-origin': '*' } : {}),
        })
        // 响应头先发出去，浏览器从这一刻开始计速
        res.flushHeaders()
        pump(res, total, between(300, 600) * 125_000, null, () => (this.speedtests -= 1))
      },
    }
  }

  /**
   * /api/proxy/--<目标 URL>（任意方法）：路径里 /api/proxy/ 之后的全部内容（含查询串）就是目标，-- 可省略。
   * Mock 不访问外网：公网目标按 40–180 Mbit/s 流式返回随机数据（分块传输，不带 Content-Length），总时长到 30 s 截断。
   */
  private proxy(req: ApiRequest): ApiResult {
    const target = `${req.path.slice('/api/proxy/'.length)}${req.search}`.replace(/^--/, '')
    let host = ''
    try {
      host = new URL(target).hostname
    } catch {
      host = ''
    }
    if (forbidden(host) || !this.deps.online()) return plain(403, 'Access to target address is not allowed.')
    const started = Date.now()
    const total = sizeHint(target)
    return {
      stream: (_req, res) => {
        // 连接与首字节耗时
        setTimeout(() => {
          if (res.destroyed) return
          res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store' })
          res.flushHeaders()
          pump(res, total, between(40, 180) * 125_000, started + 30_000, () => undefined)
        }, between(150, 600))
      },
    }
  }
}
