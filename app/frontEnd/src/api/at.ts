import { HIGH_RAIL_QUERY, highRailCommand, parseSynchParam } from '@/model/at'

import { api } from './client'

/**
 * AT 指令：所有调用排成一个队列，同一时刻只发一条——并发调用同一个基带 binder 会互相阻塞，
 * 原版打开 AT 弹窗就并发 5 条，基带忙时整个页面都跟着卡。
 * 后端超时 60 s，前端多给 5 s，免得后端已经回了「没有输出」前端却先报超时。
 */

let queue: Promise<unknown> = Promise.resolve()

export function runAt(command: string, slot = 0, options: { timeout?: number; signal?: AbortSignal } = {}): Promise<string> {
  const task = queue.then(async () => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const res = await api<{ result?: string }>('/AT', { query: { command, slot }, timeout: options.timeout ?? 65_000, signal: options.signal })
    return String(res.result ?? '')
  })
  // 一条失败不能卡住后面的
  queue = task.catch(() => undefined)
  return task
}

export const atApi = {
  run: runAt,
  highRail: async (slot = 0) => parseSynchParam(await runAt(HIGH_RAIL_QUERY, slot, { timeout: 20_000 })),
  setHighRail: (enabled: boolean, slot = 0) => runAt(highRailCommand(enabled), slot, { timeout: 20_000 }),
}
