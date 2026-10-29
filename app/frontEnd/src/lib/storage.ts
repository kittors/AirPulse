/**
 * 本地存储：统一 `airpulse:` 前缀 + JSON 序列化。
 * 隐私模式 / 存储被禁用时静默降级为内存行为，不让页面因为 localStorage 抛错而白屏。
 */
const PREFIX = 'airpulse:'

function make(area: () => Storage) {
  return {
    get<T>(key: string, fallback: T): T {
      try {
        const raw = area().getItem(PREFIX + key)
        return raw == null ? fallback : (JSON.parse(raw) as T)
      } catch {
        return fallback
      }
    },
    set(key: string, value: unknown) {
      try {
        area().setItem(PREFIX + key, JSON.stringify(value))
      } catch {
        /* 存储不可用：忽略 */
      }
    },
    remove(key: string) {
      try {
        area().removeItem(PREFIX + key)
      } catch {
        /* 存储不可用：忽略 */
      }
    },
  }
}

export const storage = make(() => window.localStorage)
export const sessionStore = make(() => window.sessionStorage)
