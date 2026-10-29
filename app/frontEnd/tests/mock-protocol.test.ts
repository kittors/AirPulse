import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { createMockApi } from '../mock/server'
import { adminPasswordDigest, antiTamperDigest, kanoSign, loginPasswordHash, sha256Hex } from '../src/api/crypto'

/**
 * 用前端的签名 / 哈希函数，对模拟设备走一遍完整的双层鉴权协议。
 * 模拟设备用 Node crypto 独立实现校验，两边任何一处算法不一致，这里就会失败。
 */
let server: Server
let base = ''
const mock = createMockApi()

beforeAll(async () => {
  server = createServer((req, res) => void mock.handle(req, res))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

const PAGE = 'http://localhost:5173/?mock=sa'

async function call(path: string, init: { method?: string; token?: string; cookie?: string; form?: Record<string, string> } = {}) {
  const method = init.method ?? (init.form ? 'POST' : 'GET')
  const t = Date.now()
  const pathname = new URL(path, base).pathname
  const headers: Record<string, string> = {
    referer: PAGE,
    'kano-t': String(t),
    'kano-sign': kanoSign(method, pathname, t),
    authorization: sha256Hex(init.token ?? 'admin'),
  }
  if (init.cookie) headers['kano-cookie'] = init.cookie
  let body: string | undefined
  if (init.form) {
    body = new URLSearchParams(init.form).toString()
    headers['content-type'] = 'application/x-www-form-urlencoded; charset=UTF-8'
  }
  const res = await fetch(`${base}${path}`, { method, headers, body })
  const text = await res.text()
  return { res, data: text ? (JSON.parse(text) as Record<string, string>) : null }
}

const get = (cmd: string, cookie?: string) => call(`/api/goform/goform_get_cmd_process?isTest=false&cmd=${cmd}&multi_data=1&_=${Date.now()}`, { cookie })

async function signIn(password = 'admin') {
  const { data: ld } = await get('LD')
  const { res, data } = await call('/api/goform/goform_set_cmd_process', {
    form: { goformId: 'LOGIN', isTest: 'false', password: loginPasswordHash(adminPasswordDigest(password), ld!.LD), user: 'admin' },
  })
  return { result: data!.result, cookie: (res.headers.get('kano-cookie') ?? '').split(';')[0] }
}

describe('模拟设备：AirPulse 鉴权', () => {
  it('免鉴权端点无需签名', async () => {
    const res = await fetch(`${base}/api/version_info`, { headers: { referer: PAGE } })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-airpulse-mock')).toBe('1')
  })

  it('口令错误 → 401', async () => {
    const { res } = await call('/api/baseDeviceInfo', { token: 'wrong' })
    expect(res.status).toBe(401)
  })

  it('口令正确 → 200，签名校验通过', async () => {
    const { res, data } = await call('/api/baseDeviceInfo')
    expect(res.status).toBe(200)
    expect(data).toHaveProperty('cpu_temp_list')
  })
})

describe('模拟设备：官方后台会话与写操作', () => {
  it('登录拿到会话 → loginfo ok → 计算 AD 写入选网 → 读回新值', async () => {
    const { result, cookie } = await signIn()
    expect(result).toBe('0')
    expect(cookie).toMatch(/^stok=/)
    expect((await get('loginfo', cookie)).data!.loginfo).toBe('ok')

    const { data: fw } = await get('Language,cr_version,wa_inner_version', cookie)
    const { data: rd } = await get('RD', cookie)
    const AD = antiTamperDigest(fw!.wa_inner_version, fw!.cr_version, rd!.RD)
    const write = await call('/api/goform/goform_set_cmd_process', {
      cookie,
      form: { goformId: 'SET_BEARER_PREFERENCE', BearerPreference: 'Only_LTE', isTest: 'false', AD },
    })
    expect(write.data!.result).toBe('success')
    expect((await get('net_select', cookie)).data!.net_select).toBe('Only_LTE')
  })

  it('AD 错误 → 拒绝写入', async () => {
    const { cookie } = await signIn()
    await get('RD', cookie)
    const write = await call('/api/goform/goform_set_cmd_process', {
      cookie,
      form: { goformId: 'UNLOCK_ALL_CELL', isTest: 'false', AD: 'DEADBEEF' },
    })
    expect(write.data!.result).toBe('failure')
  })

  it('密码错误返回 3；连续 5 次后锁定', async () => {
    const page = 'http://localhost:5173/?mock=weak'
    const lockCall = async () => {
      const t = Date.now()
      const path = '/api/goform/goform_get_cmd_process'
      const res = await fetch(`${base}${path}?isTest=false&cmd=psw_fail_num_str,login_lock_time&multi_data=1`, {
        headers: { referer: page, 'kano-t': String(t), 'kano-sign': kanoSign('GET', path, t), authorization: sha256Hex('admin') },
      })
      return (await res.json()) as Record<string, string>
    }
    const attempt = async () => {
      const t = Date.now()
      const ldPath = '/api/goform/goform_get_cmd_process'
      const ldRes = await fetch(`${base}${ldPath}?isTest=false&cmd=LD`, {
        headers: { referer: page, 'kano-t': String(t), 'kano-sign': kanoSign('GET', ldPath, t), authorization: sha256Hex('admin') },
      })
      const { LD } = (await ldRes.json()) as { LD: string }
      const setPath = '/api/goform/goform_set_cmd_process'
      const t2 = Date.now()
      const res = await fetch(`${base}${setPath}`, {
        method: 'POST',
        headers: {
          referer: page,
          'kano-t': String(t2),
          'kano-sign': kanoSign('POST', setPath, t2),
          authorization: sha256Hex('admin'),
          'content-type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ goformId: 'LOGIN', isTest: 'false', password: loginPasswordHash(adminPasswordDigest('nope'), LD), user: 'admin' }),
      })
      return ((await res.json()) as { result: string }).result
    }
    for (let i = 0; i < 5; i += 1) expect(await attempt()).toBe('3')
    const lock = await lockCall()
    expect(lock.psw_fail_num_str).toBe('0')
    expect(Number(lock.login_lock_time)).toBeGreaterThan(0)
  })
})
