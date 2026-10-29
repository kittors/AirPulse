/**
 * 接口错误：带 HTTP 状态码与可选的错误类别，界面据此给出可执行的提示
 * （口令失效 → 回登录页；超时 → 提示检查连接；设备返回 error 字段 → 原样展示）。
 */
export type ApiErrorKind = 'unauthorized' | 'timeout' | 'network' | 'http' | 'device' | 'session'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status?: number

  constructor(kind: ApiErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
  }
}

export function isApiError(error: unknown, kind?: ApiErrorKind): error is ApiError {
  return error instanceof ApiError && (kind === undefined || error.kind === kind)
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
