import { api, request, uploadFile } from './client'

/**
 * 本地上传安装包更新（不做在线 OTA）。流程与每一步的坑见 docs/legacy-tools.md §7.2：
 * 上传到设备 → 让后端从本机地址「下载」（install_apk 只认 download_apk 记下的路径）→
 * 轮询到 status == "done"（不能看 percent == 100，有竞态）→ 安装（流式响应，错误也是 200）→
 * 服务会随 App 重启中断，之后轮询 version_info 核对版本 → 删掉上传的那份。
 */

export interface DownloadStatus {
  status: 'idle' | 'downloading' | 'done' | 'error'
  percent: number
  error: string
}

export const otaApi = {
  upload: (file: File, onProgress: (loaded: number, total: number) => void, signal?: AbortSignal) =>
    uploadFile<{ url?: string }>('/upload_img', file, { onProgress, signal, filename: file.name }),

  /** 服务端口固定 2333；/api/uploads 免鉴权，后端自己下载不需要签名 */
  startDownload: (uploadUrl: string) =>
    api<{ result?: string }>('/download_apk', { method: 'POST', json: { apk_url: `http://127.0.0.1:2333/api${uploadUrl}` }, timeout: 20_000 }),

  /** 失败时 error 字段装的是原因，不能交给 api() 当异常抛掉 */
  async downloadStatus(): Promise<DownloadStatus> {
    const res = await request('/download_apk_status', { timeout: 8_000 })
    const data = JSON.parse((await res.text()) || '{}') as Partial<DownloadStatus>
    const status = data.status === 'downloading' || data.status === 'done' || data.status === 'error' ? data.status : 'idle'
    return { status, percent: Number(data.percent) || 0, error: String(data.error ?? '') }
  },

  /** ADB 通道要模拟点击工程模式，可能要一两分钟 */
  install: () => api<{ result?: string }>('/install_apk', { method: 'POST', timeout: 200_000 }),

  cleanup: (name: string) => api('/delete_img', { method: 'POST', json: { file_name: name } }).catch(() => undefined),
}

/** 从安装包文件名里读出版本与构建日期：…V4.1.5_20261029_1530.apk */
export function parseApkName(name: string): { version: string | null; build: string | null } {
  const version = /V(\d+\.\d+\.\d+)/i.exec(name)?.[1] ?? null
  const build = /_(\d{8})(?:_\d{4})?\.apk$/i.exec(name)?.[1] ?? null
  return { version, build }
}

/** 按数字逐段比较版本号（原版用字符串比较，4.10.0 会被当成比 4.9.0 旧） */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0)
    if (diff) return diff > 0 ? 1 : -1
  }
  return 0
}
