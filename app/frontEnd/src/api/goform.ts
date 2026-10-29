import { getT } from '@/i18n'
import { ApiError } from '@/lib/errors'
import { createStore } from '@/lib/store'

import { credentialsStore } from './auth'
import { api, request } from './client'
import { antiTamperDigest, loginPasswordHash } from './crypto'

/**
 * 中兴官方后台（经 /api/goform 反代）的读写与会话。
 *
 * 会话：登录拿到的 Cookie 通过 Kano-Cookie 头携带（浏览器不允许脚本设置 Cookie 头）；
 * 同时用 /api/set_cookie 存到设备上，多个标签页 / 多台电脑共用同一个会话。
 * 所有 goform 请求统一带上 Kano-Cookie——原版只有主页轮询带了，其余请求的会话头
 * 被它自己的 fetchWithTimeout 覆盖掉了。
 *
 * 写操作：串行排队（避免两个写操作交叉取 RD / 计算 AD），每次先确认会话有效。
 * 与原版选网、锁频、锁小区一致，写完不退出登录。
 */

const GET_PATH = '/goform/goform_get_cmd_process'
const SET_PATH = '/goform/goform_set_cmd_process'

export interface GoformWriteResult {
  result?: string
  [key: string]: unknown
}

/** 官方后台会话状态（顶栏据此提示「设备管理后台登录失败」） */
export const deviceSessionStore = createStore<{ ok: boolean; error: string | null }>({ ok: true, error: null })

/** null = 还没建立过会话；'' = 设备按来源识别会话、不发 Cookie */
let cookie: string | null = null
let firmware: { wa: string; cr: string } | null = null
let inflight: Promise<string> | null = null
let writeQueue: Promise<unknown> = Promise.resolve()

const sessionHeaders = (value: string | null) => (value ? { 'kano-cookie': value } : undefined)

export function goformGet<T>(
  cmd: string | string[],
  options: { extra?: Record<string, string | number>; timeout?: number; signal?: AbortSignal; silent401?: boolean } = {},
): Promise<T> {
  const list = Array.isArray(cmd) ? cmd : [cmd]
  return api<T>(GET_PATH, {
    query: {
      isTest: 'false',
      cmd: list.join(','),
      multi_data: list.length > 1 ? 1 : undefined,
      ...options.extra,
      _: Date.now(),
    },
    headers: sessionHeaders(cookie),
    timeout: options.timeout ?? 8_000,
    signal: options.signal,
    silent401: options.silent401,
  })
}

async function isSessionValid(value: string | null): Promise<boolean> {
  const res = await api<{ loginfo?: string }>(GET_PATH, {
    query: { isTest: 'false', cmd: 'loginfo', _: Date.now() },
    headers: sessionHeaders(value),
    timeout: 6_000,
  })
  return res.loginfo === 'ok'
}

export class DeviceLoginError extends ApiError {
  readonly reason: 'wrong-password' | 'locked' | 'failed'
  /** 剩余可尝试次数（设备返回的 psw_fail_num_str） */
  readonly attemptsLeft: string | null
  /** 锁定剩余秒数 */
  readonly lockSeconds: string | null

  constructor(reason: DeviceLoginError['reason'], message: string, extra: { attemptsLeft?: string; lockSeconds?: string } = {}) {
    super('session', message)
    this.name = 'DeviceLoginError'
    this.reason = reason
    this.attemptsLeft = extra.attemptsLeft ?? null
    this.lockSeconds = extra.lockSeconds ?? null
  }
}

/** 登录前检查是否因密码错误次数过多被锁定；同时作为一次带鉴权的请求，顺带校验访问口令 */
export async function checkLoginLock(options: { silent401?: boolean } = {}) {
  const res = await goformGet<{ psw_fail_num_str?: string; login_lock_time?: string }>(
    ['psw_fail_num_str', 'login_lock_time'],
    { silent401: options.silent401, timeout: 6_000 },
  )
  const left = res.psw_fail_num_str ?? ''
  const lock = res.login_lock_time ?? ''
  if (left === '0' && lock && lock !== '0') {
    throw new DeviceLoginError('locked', getT().auth.locked(lock), { lockSeconds: lock })
  }
  return { attemptsLeft: left || null }
}

async function signInToDevice(): Promise<string> {
  const t = getT()
  const credentials = credentialsStore.get()
  if (!credentials) throw new DeviceLoginError('failed', t.errors.session)

  const { LD } = await goformGet<{ LD?: string }>('LD')
  if (!LD) throw new DeviceLoginError('failed', t.errors.session)

  const multi = credentials.loginMethod === 'multi'
  const response = await request(SET_PATH, {
    method: 'POST',
    form: {
      goformId: multi ? 'LOGIN_MULTI_USER' : 'LOGIN',
      isTest: 'false',
      password: loginPasswordHash(credentials.adminDigest, LD),
      user: 'admin',
      ...(multi ? { IP: 'localhost' } : {}),
    },
    timeout: 10_000,
  })
  const data = (await response.json().catch(() => ({}))) as GoformWriteResult
  const result = String(data.result ?? '')
  if (result === '3') throw new DeviceLoginError('wrong-password', t.auth.passwordWrong)

  // 与原版一致：从响应头 kano-cookie 取第一段 name=value；没有 Cookie 但明确成功时按来源识别会话
  const header = response.headers.get('kano-cookie')
  const value = header ? header.split(';')[0].trim() : ''
  if (!value && result !== '0' && result !== 'success') {
    throw new DeviceLoginError('failed', `${t.errors.session}（${result || '—'}）`)
  }
  cookie = value
  firmware = null
  void api('/set_cookie', { method: 'POST', json: { cookie: value } }).catch(() => undefined)
  return value
}

/**
 * 确保官方后台会话有效，返回当前 Cookie。并发调用共用同一次检查 / 登录。
 * force：跳过「复用现有会话」，直接重新登录（轮询发现 loginfo 失效时用）。
 */
export function ensureDeviceSession(options: { force?: boolean } = {}): Promise<string> {
  if (inflight) return inflight
  inflight = (async () => {
    try {
      if (!options.force) {
        if (cookie !== null && (await isSessionValid(cookie))) return cookie
        const stored = await api<{ cookie?: string }>('/get_cookie').catch(() => null)
        const candidate = stored?.cookie ?? ''
        if (candidate && candidate !== cookie && (await isSessionValid(candidate))) {
          cookie = candidate
          return candidate
        }
      }
      const value = await signInToDevice()
      deviceSessionStore.set({ ok: true, error: null })
      return value
    } catch (error) {
      if (error instanceof DeviceLoginError) {
        deviceSessionStore.set({ ok: false, error: error.message })
      }
      throw error
    } finally {
      inflight = null
    }
  })()
  return inflight
}

async function computeAntiTamper(): Promise<string> {
  if (!firmware) {
    const info = await goformGet<{ wa_inner_version?: string; cr_version?: string }>([
      'Language',
      'cr_version',
      'wa_inner_version',
    ])
    if (!info.wa_inner_version || !info.cr_version) throw new ApiError('device', getT().errors.session)
    firmware = { wa: info.wa_inner_version, cr: info.cr_version }
  }
  const { RD } = await goformGet<{ RD?: string }>('RD')
  if (!RD) throw new ApiError('device', getT().errors.session)
  return antiTamperDigest(firmware.wa, firmware.cr, RD)
}

/**
 * 官方后台写操作：串行执行；结果不是 success 时抛错（原版只认 result == 'success'）。
 * onSend：会话检查、取 RD 这些前置请求都过了、真正发出写请求的那一刻回调——
 * 会让设备重启的写操作据此区分「根本没发出去」和「发出去后设备没来得及回应」。
 */
export function goformSet<T extends GoformWriteResult = GoformWriteResult>(
  goformId: string,
  params: Record<string, string | number | boolean> = {},
  options: { timeout?: number; onSend?: () => void } = {},
): Promise<T> {
  const run = async () => {
    const session = await ensureDeviceSession()
    const AD = await computeAntiTamper()
    options.onSend?.()
    const data = await api<T>(SET_PATH, {
      method: 'POST',
      form: { goformId, ...params, isTest: 'false', AD },
      headers: sessionHeaders(session),
      timeout: options.timeout ?? 15_000,
    })
    if (data.result !== 'success') {
      throw new ApiError('device', `${getT().common.operationFailed}（${goformId}: ${data.result ?? '—'}）`)
    }
    return data
  }
  const next = writeQueue.then(run, run)
  writeQueue = next.catch(() => undefined)
  return next
}

/** 退出 AirPulse 时丢弃本地会话缓存（不主动注销设备会话，避免影响其他已登录的浏览器） */
export function resetDeviceSession() {
  cookie = null
  firmware = null
  deviceSessionStore.set({ ok: true, error: null })
}
