import { sessionStore, storage } from '@/lib/storage'
import { createStore } from '@/lib/store'

export type LoginMethod = 'standard' | 'multi'

/**
 * 登录凭据：只保存哈希，不保存明文。
 * - tokenHash：SHA256(访问口令) 小写，直接作为 authorization 头；设备关闭口令认证时为 null；
 * - adminDigest：SHA256(设备管理密码) 大写，官方后台登录只需要它（再与 LD 拼接做一次哈希）。
 * 勾选「记住我」存 localStorage，否则存 sessionStorage（关掉标签页即失效）。
 */
export interface Credentials {
  tokenHash: string | null
  adminDigest: string
  loginMethod: LoginMethod
  remember: boolean
}

export type AuthStatus = 'checking' | 'signed-in' | 'signed-out'
/** 回到登录页的原因：用于在登录页顶部给出说明 */
export type SignOutReason = 'expired' | 'device-session' | 'manual' | null

const KEY = 'auth'

function load(): Credentials | null {
  return storage.get<Credentials | null>(KEY, null) ?? sessionStore.get<Credentials | null>(KEY, null)
}

/** 请求层随时读取的当前凭据（登录校验期间可能是尚未确认的草稿） */
export const credentialsStore = createStore<Credentials | null>(load())
export const authStatusStore = createStore<AuthStatus>(credentialsStore.get() ? 'checking' : 'signed-out')
export const signOutReasonStore = createStore<SignOutReason>(null)

export function persistCredentials(credentials: Credentials) {
  if (credentials.remember) {
    storage.set(KEY, credentials)
    sessionStore.remove(KEY)
  } else {
    sessionStore.set(KEY, credentials)
    storage.remove(KEY)
  }
  credentialsStore.set(credentials)
}

export function signOut(reason: SignOutReason) {
  storage.remove(KEY)
  sessionStore.remove(KEY)
  credentialsStore.set(null)
  signOutReasonStore.set(reason)
  authStatusStore.set('signed-out')
}
