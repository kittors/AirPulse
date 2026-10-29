import {
  authStatusStore,
  credentialsStore,
  persistCredentials,
  signOut,
  signOutReasonStore,
  type Credentials,
  type LoginMethod,
} from '@/api/auth'
import { adminPasswordDigest, sha256Hex } from '@/api/crypto'
import { deviceApi } from '@/api/device'
import { checkLoginLock, DeviceLoginError, ensureDeviceSession, resetDeviceSession } from '@/api/goform'
import { queryClient } from '@/app/query'
import { isApiError } from '@/lib/errors'

export interface SignInInput {
  token: string
  password: string
  loginMethod: LoginMethod
  remember: boolean
  needToken: boolean
}

/**
 * 交互式登录（两层）：
 * 1. 用访问口令发一个带鉴权的请求（顺带读取官方后台的锁定状态）——401 即口令错误；
 * 2. 用设备管理密码登录官方后台，拿到会话；
 * 3. 把明文密码同步给后端（定时任务自动登录要用），本地只保存哈希。
 */
export async function signIn(input: SignInInput): Promise<void> {
  const credentials: Credentials = {
    tokenHash: input.needToken ? sha256Hex(input.token.trim()) : null,
    adminDigest: adminPasswordDigest(input.password.trim()),
    loginMethod: input.loginMethod,
    remember: input.remember,
  }
  // 草稿凭据：仅供本次校验的请求使用，校验通过才落盘
  credentialsStore.set(credentials)
  resetDeviceSession()
  try {
    await checkLoginLock({ silent401: true })
    await ensureDeviceSession({ force: true })
  } catch (error) {
    credentialsStore.set(null)
    throw error
  }
  void deviceApi.updateAdminPassword(input.password.trim()).catch(() => undefined)
  persistCredentials(credentials)
  signOutReasonStore.set(null)
  queryClient.clear()
  authStatusStore.set('signed-in')
}

/** 密码错误后查询剩余可尝试次数（查不到就不显示次数） */
export async function attemptsLeft(): Promise<string | null> {
  try {
    return (await checkLoginLock({ silent401: true })).attemptsLeft
  } catch (error) {
    if (error instanceof DeviceLoginError && error.reason === 'locked') throw error
    return null
  }
}

/**
 * 启动时校验本地保存的凭据。口令 / 密码失效回登录页；
 * 设备暂时连不上则把错误抛给调用方（显示重试），不清除凭据。
 */
export async function verifyStoredSession(): Promise<void> {
  if (!credentialsStore.get()) {
    authStatusStore.set('signed-out')
    return
  }
  try {
    await checkLoginLock({ silent401: true })
    await ensureDeviceSession()
    authStatusStore.set('signed-in')
  } catch (error) {
    if (isApiError(error, 'unauthorized')) return signOut('expired')
    if (error instanceof DeviceLoginError) return signOut('device-session')
    throw error
  }
}

export function signOutManually() {
  resetDeviceSession()
  queryClient.clear()
  signOut('manual')
}
