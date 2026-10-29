import { randomUUID } from 'node:crypto'

import { between, deviceStamp, fail, ok, optString, orgJsonError, plain, shellDate, sleep, type ApiRequest, type ApiResult } from './http'

/**
 * Mock：上传文件（<filesDir>/uploads）与本地 OTA 安装，格式照 docs/legacy-tools.md §5.9、§7、附录 C.6 / C.8。
 * 文件都只存在内存里；/sdcard 上的文本文件（启动脚本、更新日志）也放在这份存储里，Shell 模拟会读写它们。
 */

export interface Upload {
  data: Buffer
  mtime: number
  /** 上传时的原文件名：真机不记录，Mock 用它解析 OTA 安装包的版本号 */
  original: string
}

export interface Storage {
  uploads: Map<string, Upload>
  /** uploads 目录是否存在：从没上传过时不存在，ls 会写 stderr */
  uploadsDir: boolean
  /** /sdcard 上的文本文件 */
  sdcard: Map<string, string>
}

export const BOOT_SCRIPT = '/sdcard/ufi_tools_boot.sh'
export const UPDATE_LOG = '/sdcard/ufi_tools_update.log'

const installLog = (at: number, result: string) => `Performing Streamed Install\n${result}\n${shellDate(at)}install and sync complete!\n`

export function createStorage(): Storage {
  return {
    uploads: new Map(),
    uploadsDir: false,
    sdcard: new Map([
      // 默认启动脚本 + 一条「开机阻止 5555 端口」的持久化规则（原版端口防火墙写入的格式）
      [BOOT_SCRIPT, '#!/system/bin/sh\n# you script here...\nsync\n(iptables -A INPUT -p tcp --dport 5555 -j DROP >/dev/null 2>&1 &) # UFI-TOOLS v4 5555\n'],
      ['/sdcard/ufi_tools_schedule.sh', '#!/system/bin/sh\n# you script here...\n\n'],
      // 上一次 OTA（当前版本）的安装日志
      [UPDATE_LOG, installLog(Date.now() - 6 * 86_400_000 - 5_123_000, 'Success')],
    ]),
  }
}

/** 够用的 multipart/form-data 解析：只取带 filename 的文件部分（Ktor 也只处理 FileItem） */
function fileParts(body: Buffer, contentType: string): { filename: string; data: Buffer }[] {
  const boundary = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType)
  if (!/^multipart\/form-data/i.test(contentType) || !boundary) {
    throw new Error("Cannot transform this request's content to io.ktor.http.content.MultiPartData")
  }
  const delimiter = Buffer.from(`--${boundary[1] ?? boundary[2]}`)
  const parts: { filename: string; data: Buffer }[] = []
  let start = body.indexOf(delimiter)
  while (start !== -1) {
    const head = start + delimiter.length
    if (body.subarray(head, head + 2).toString() === '--') break
    const next = body.indexOf(delimiter, head)
    if (next === -1) break
    // 分隔行后面的 CRLF 与下一个分隔符前面的 CRLF 不属于内容
    const part = body.subarray(head + 2, next - 2)
    const split = part.indexOf('\r\n\r\n')
    if (split !== -1) {
      const filename = /\bfilename="([^"]*)"/i.exec(part.subarray(0, split).toString('utf8'))?.[1]
      if (filename !== undefined) parts.push({ filename, data: part.subarray(split + 4) })
    }
    start = next
  }
  return parts
}

const MIME: Record<string, string> = {
  apk: 'application/vnd.android.package-archive',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  svg: 'image/svg+xml',
  js: 'application/javascript',
  css: 'text/css; charset=UTF-8',
  html: 'text/html; charset=UTF-8',
  json: 'application/json',
  txt: 'text/plain; charset=UTF-8',
  sh: 'application/x-sh',
}
const mimeOf = (name: string) => MIME[name.slice(name.lastIndexOf('.') + 1).toLowerCase()] ?? 'application/octet-stream'

interface Version {
  app_ver: string
  app_ver_code: string
}

export interface FilesDeps {
  /** root 安装通道（高级功能已就绪） */
  rootReady(): boolean
  /** ADB 安装通道（无线 ADB 已就绪） */
  adbReady(): boolean
}

export class MockFiles {
  private readonly storage: Storage
  private readonly deps: FilesDeps
  private ver: Version = { app_ver: '4.1.5', app_ver_code: '20261020' }
  /** 安装成功后 App 进程被替换：这之前的所有 /api 请求直接断开 */
  private offlineUntil = 0
  /** download_apk 的内存状态（与后端 ApkState 一致），App 重启后丢失 */
  private apk = { inProgress: false, percent: 0, error: null as string | null, result: null as Upload | null, url: '' }
  private downloadSeq = 0

  constructor(storage: Storage, deps: FilesDeps) {
    this.storage = storage
    this.deps = deps
  }

  version(): Version {
    return this.ver
  }

  offline(): boolean {
    return Date.now() < this.offlineUntil
  }

  async api(req: ApiRequest): Promise<ApiResult | null> {
    if (req.path === '/api/uploads' || req.path.startsWith('/api/uploads/')) return this.serve(req.path)
    switch (req.path) {
      case '/api/upload_img':
        return this.upload(req)
      case '/api/delete_img': {
        if (!req.json) return fail(`删除出错: ${orgJsonError(req.text)}`)
        const name = optString(req.json.file_name).trim()
        if (!name || name.includes('..') || name.startsWith('/')) return fail('非法文件名', 403)
        // 文件不存在也返回成功
        this.storage.uploads.delete(name)
        return ok()
      }
      case '/api/delete_all_uploads_data': {
        // 只删文件，uploads 目录本身保留
        const deleted = Object.fromEntries([...this.storage.uploads.keys()].map((name) => [name, true]))
        this.storage.uploads.clear()
        return ok({ result: 'success', deleted_list: deleted })
      }
      case '/api/download_apk': {
        if (!req.json) return fail(orgJsonError(req.text))
        const url = optString(req.json.apk_url).trim()
        if (!url) return fail('请提供 apk_url')
        // 同一个地址正在下载时忽略，同样返回 download_started
        if (!(this.apk.inProgress && url === this.apk.url)) this.download(url)
        return ok({ result: 'download_started' })
      }
      case '/api/download_apk_status': {
        const { inProgress, error, result, percent } = this.apk
        const status = inProgress ? 'downloading' : error !== null ? 'error' : result ? 'done' : 'idle'
        return ok({ status, percent, error: error ?? '' })
      }
      case '/api/install_apk':
        return this.install()
      default:
        return null
    }
  }

  /** GET /api/uploads/<文件名>：免鉴权；越界 403、不存在 404，都是纯文本 */
  private serve(path: string): ApiResult {
    let relative: string
    try {
      relative = decodeURIComponent(path.slice('/api/uploads'.length))
    } catch {
      return plain(403, '403 Forbidden')
    }
    const segments: string[] = []
    for (const segment of relative.split('/')) {
      if (!segment || segment === '.') continue
      if (segment !== '..') segments.push(segment)
      else if (segments.pop() === undefined) return plain(403, '403 Forbidden')
    }
    const name = segments.join('/')
    if (!name || name.includes('\0')) return plain(403, '403 Forbidden')
    const file = this.storage.uploads.get(name)
    if (!file) return plain(404, '404 Not Found')
    return { status: 200, raw: file.data, contentType: mimeOf(name), headers: { 'last-modified': new Date(file.mtime).toUTCString() } }
  }

  /** POST /api/upload_img：每个文件部分都保存为 <UUID>.<小写扩展名>，有多个时只返回最后一个 */
  private upload(req: ApiRequest): ApiResult {
    let parts: { filename: string; data: Buffer }[]
    try {
      parts = fileParts(req.raw, req.contentType)
    } catch (error) {
      return fail(`上传文件出错: ${(error as Error).message}`)
    }
    if (!parts.length) return fail('上传文件出错: 文件上传失败')
    let name = ''
    for (const part of parts) {
      const dot = part.filename.lastIndexOf('.')
      name = `${randomUUID()}.${dot === -1 ? 'unknown' : part.filename.slice(dot + 1).toLowerCase()}`
      this.storage.uploads.set(name, { data: part.data, mtime: Date.now(), original: part.filename })
    }
    this.storage.uploadsDir = true
    return ok({ url: `/uploads/${name}` })
  }

  /**
   * 后台「下载」：本机地址 /api/uploads/<文件> 指向已上传的文件时，2–4 s 内进度涨到 100，
   * 再过约 300 ms 才写入结果——这段时间 status 仍是 downloading（复现文档说的 percent==100 竞态）。
   */
  private download(url: string) {
    const seq = ++this.downloadSeq
    this.apk = { inProgress: true, percent: 0, error: null, result: null, url }
    const name = /\/api\/uploads\/([^?#]+)/.exec(url)?.[1]
    let file: Upload | undefined
    try {
      file = name ? this.storage.uploads.get(decodeURIComponent(name)) : undefined
    } catch {
      file = undefined
    }
    if (!file || !file.data.length) {
      // 非 2xx 或 Content-Length 为 0：都是「下载失败」
      setTimeout(() => {
        if (seq !== this.downloadSeq) return
        this.apk.error = '下载失败'
        this.apk.inProgress = false
      }, between(150, 400))
      return
    }
    // 下载的是一份拷贝（downloaded_app.apk）：之后删掉上传文件也不影响安装
    const copy: Upload = { ...file }
    const started = Date.now()
    const duration = between(2_000, 4_000)
    const timer = setInterval(() => {
      if (seq !== this.downloadSeq) return clearInterval(timer)
      this.apk.percent = Math.min(100, Math.floor(((Date.now() - started) / duration) * 100))
      if (this.apk.percent < 100) return
      clearInterval(timer)
      setTimeout(() => {
        if (seq !== this.downloadSeq) return
        this.apk.result = copy
        this.apk.inProgress = false
      }, 300)
    }, 150)
  }

  /** 安装包名里有 V<x.y.z>_<yyyyMMdd>（release 构建的命名）就用它，否则补丁号 +1、日期取今天 */
  private nextVersion(pkg: Upload): Version {
    const named = /V(\d+\.\d+\.\d+)_(\d{8})/i.exec(pkg.original)
    if (named) return { app_ver: named[1], app_ver_code: named[2] }
    const [major = 0, minor = 0, patch = 0] = this.ver.app_ver.split('.').map((n) => Number(n) || 0)
    return { app_ver: `${major}.${minor}.${patch + 1}`, app_ver_code: deviceStamp(Date.now(), true) }
  }

  /**
   * POST /api/install_apk：流式响应，HTTP 状态码恒为 200，错误放在 error 字段。
   * root 通道 2 s 后返回、ADB 通道约 20 s；安装成功后服务重启约 10 s，期间所有请求断开，恢复后版本号变新。
   * 文件名含 incompatible（签名不一致）或版本日期更早（降级）时 pm install 失败：服务不中断、版本不变，原因写进更新日志。
   */
  private async install(): Promise<ApiResult> {
    const pkg = this.apk.result
    if (!pkg) return ok({ error: '未检测到已下载的 APK' })
    const viaRoot = this.deps.rootReady()
    if (!viaRoot && !this.deps.adbReady()) {
      // 两个通道都没有时后端仍硬走 ADB 自动化，很久之后才报错
      await sleep(30_000)
      return ok({ error: '异常: click_stage 多次重试失败' })
    }
    await sleep(viaRoot ? 2_000 : 20_000)
    const next = this.nextVersion(pkg)
    const failure = /incompatible/i.test(pkg.original)
      ? 'Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Package com.minikano.f50_sms signatures do not match previously installed version; ignoring!]'
      : Number(next.app_ver_code) < Number(this.ver.app_ver_code)
        ? `Failure [INSTALL_FAILED_VERSION_DOWNGRADE: Downgrade detected: Update version code ${next.app_ver_code} is older than current ${this.ver.app_ver_code}]`
        : null
    this.storage.sdcard.set(UPDATE_LOG, (this.storage.sdcard.get(UPDATE_LOG) ?? '') + installLog(Date.now(), failure ?? 'Success'))
    if (!failure) {
      this.ver = next
      this.offlineUntil = Date.now() + between(9_000, 11_000)
      // 内存里的下载状态随 App 重启丢失
      this.downloadSeq += 1
      this.apk = { inProgress: false, percent: 0, error: null, result: null, url: '' }
    }
    return ok({ result: 'success' })
  }
}
