import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import { isSettling, patched, settle, waitFor } from '../src/app/pending'

/** 模拟一个「接口先回成功、状态过一会儿才变」的设备开关 */
function device(initial: boolean, delayReads: number) {
  const state = { on: initial, target: initial, readsLeft: 0, reads: 0 }
  return {
    state,
    write: async (on: boolean) => {
      state.target = on
      state.readsLeft = delayReads
    },
    read: async () => {
      state.reads++
      if (state.readsLeft > 0) state.readsLeft--
      else state.on = state.target
      return { on: state.on }
    },
  }
}

const FAST = { interval: 5, timeout: 400 }

describe('等设备生效（app/pending）', () => {
  it('waitFor：读到目标就返回；单次读失败接着等；超时返回 null', async () => {
    let n = 0
    const read = async () => {
      n++
      if (n === 2) throw new Error('设备切换中')
      return n
    }
    expect(await waitFor(read, (v) => v >= 4, FAST)).toBe(4)
    expect(await waitFor(async () => 0, (v) => v > 0, { interval: 5, timeout: 30 })).toBeNull()
  })

  it('settle：先乐观显示目标状态；等待期间刷新读到旧状态也不会闪回；生效后用真实数据收尾', async () => {
    const client = new QueryClient()
    const key = ['test', 'switch'] as const
    const dev = device(false, 3)
    const query = { queryKey: key, queryFn: patched(key, dev.read) }
    await client.fetchQuery(query)
    expect(client.getQueryData(key)).toEqual({ on: false })

    const done = settle(client, key, { patch: (s: { on: boolean }) => ({ ...s, on: true }), write: () => dev.write(true), read: dev.read, reached: (s) => s.on, ...FAST })
    // 写入刚发出（先取消进行中的读取，下一轮事件循环就更新）：缓存已是目标状态
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(client.getQueryData(key)).toEqual({ on: true })
    expect(isSettling(key)).toBe(true)
    // 等待期间别处触发的刷新：设备还是旧状态，但读回来的数据叠了补丁
    await client.refetchQueries({ queryKey: key })
    expect(client.getQueryData(key)).toEqual({ on: true })

    expect(await done).toBe(true)
    expect(isSettling(key)).toBe(false)
    expect(dev.state.on).toBe(true)
    expect(client.getQueryData(key)).toEqual({ on: true })
  })

  it('settle：超时没等到就返回 false，撤掉补丁、按设备真实状态刷新', async () => {
    const client = new QueryClient()
    const key = ['test', 'stuck'] as const
    const dev = device(false, 1_000)
    const query = { queryKey: key, queryFn: patched(key, dev.read) }
    await client.fetchQuery(query)
    client.getQueryCache().find({ queryKey: key })?.setOptions(query)
    const settled = await settle(client, key, { patch: (s: { on: boolean }) => ({ ...s, on: true }), write: () => dev.write(true), read: dev.read, reached: (s) => s.on, interval: 5, timeout: 30 })
    expect(settled).toBe(false)
    expect(isSettling(key)).toBe(false)
    await client.refetchQueries({ queryKey: key })
    expect(client.getQueryData(key)).toEqual({ on: false })
  })

  it('settle：写入失败照常抛错，补丁不会留下', async () => {
    const client = new QueryClient()
    const key = ['test', 'fail'] as const
    client.setQueryData(key, { on: false })
    await expect(
      settle(client, key, {
        patch: (s: { on: boolean }) => ({ ...s, on: true }),
        write: async () => {
          throw new Error('设备拒绝')
        },
        read: async () => ({ on: false }),
        reached: (s) => s.on,
        ...FAST,
      }),
    ).rejects.toThrow('设备拒绝')
    expect(isSettling(key)).toBe(false)
  })
})
