import { BLOCKED_PORTS_CMD, parseBlockedPorts, V4_SYSTEM_PORTS, V6_HARDENED_PORTS, type BlockedPorts } from '@/model/ports'

import { api, stripTags, uploadFile } from './client'
import { goformSet } from './goform'
import { truthy } from './system'

/**
 * 高级工具：Root / 应用身份 Shell、高级功能（Samba root 钩子）、ADB、Web 终端、
 * 端口防护、启动脚本、上传文件、自定义注入。接口细节见 docs/legacy-tools.md §5、§6、§9.8。
 *
 * - root_shell 的 result 是字符串（API_Doc 写成对象是错的），只返回 stdout；
 * - user_shell 只要 stderr 有输出就判失败，所以命令里统一把 stderr 丢掉或并进 stdout。
 */

const FILES_DIR = '/data/data/com.minikano.f50_sms/files'
export const UPLOAD_DIR = `${FILES_DIR}/uploads`
export const BOOT_SCRIPT = '/sdcard/ufi_tools_boot.sh'
export const TTYD_PORT = 1146
export const ADB_PORT = 5555

const DEFAULT_BOOT_SCRIPT = '#!/system/bin/sh\n# 每行一条命令，常驻程序请用 nohup … & 放到后台\nsync\n'

export async function rootShell(command: string, timeout = 10_000): Promise<string> {
  const res = await api<{ result?: unknown }>('/root_shell', { method: 'POST', json: { command, timeout }, timeout: timeout + 5_000 })
  return typeof res.result === 'string' ? res.result : res.result == null ? '' : JSON.stringify(res.result)
}

export async function userShell(command: string, timeout = 30_000): Promise<string> {
  const res = await api<{ result?: { content?: string } }>('/user_shell', { method: 'POST', json: { command }, timeout })
  return String(res.result?.content ?? '')
}

/** 高级功能是否真正可用：root shell 能执行 whoami 且输出 root */
export async function hasRoot(): Promise<boolean> {
  try {
    return (await rootShell('whoami', 5_000)).includes('root')
  } catch {
    return false
  }
}

export interface Capabilities {
  root: boolean
  /** 无线 ADB 就绪（后端能连上 localhost:5555） */
  adb: boolean
  /** 后端保存了设备管理密码（定时任务、无线 ADB 自启要用） */
  adminSynced: boolean
}

export const advancedApi = {
  async capabilities(): Promise<Capabilities> {
    const [root, adb, pwd] = await Promise.all([hasRoot(), advancedApi.adbAlive().catch(() => false), advancedApi.officialPassword().catch(() => '')])
    return { root, adb, adminSynced: Boolean(pwd) }
  },

  /** 开启高级功能：先确保官方 Samba 打开，再写入 root 钩子。返回成功只代表配置已写入，root 要等 30 s – 2 min */
  async enableAdvanced(): Promise<string> {
    await goformSet('SAMBA_SETTING', { samba_switch: '1' }).catch(() => undefined)
    const res = await api<{ result?: string }>('/smbPath', { query: { enable: 1 }, timeout: 90_000 })
    return stripTags(res.result ?? '')
  },
  async disableAdvanced(): Promise<string> {
    const res = await api<{ result?: string }>('/smbPath', { query: { enable: 0 }, timeout: 30_000 })
    return stripTags(res.result ?? '')
  },

  adbAlive: async () => truthy((await api<{ result?: unknown }>('/adb_alive', { timeout: 6_000 })).result),
  adbWifi: async () => truthy((await api<{ enabled?: unknown }>('/adb_wifi_setting')).enabled),
  officialPassword: async () => String((await api<{ pwd?: string }>('/get_official_web_password')).pwd ?? ''),
  /**
   * 无线 ADB 开机自启：开启时后端保存设备管理密码（明文）；关闭时后端会把它删掉，
   * 导致定时任务登录官方后台失败——所以关闭后立刻用之前保存的密码补回去。
   */
  async setAdbWifi(enabled: boolean, password: string) {
    await api('/adb_wifi_setting', { method: 'POST', json: { enabled, password: enabled ? password : '' }, timeout: 8_000 })
    if (!enabled && password) await api('/update_admin_pwd', { method: 'POST', json: { password } }).catch(() => undefined)
  },

  async ttyd(port = TTYD_PORT): Promise<{ available: boolean; address: string }> {
    const res = await api<{ code?: string; ip?: string }>('/hasTTYD', { query: { port }, timeout: 6_000 })
    return { available: String(res.code) === '200', address: String(res.ip ?? '') }
  },

  /** 禁用中兴固件更新：有 root 就用 root 卸载相关组件，否则走后端的 ADB 方式（需要无线 ADB 就绪） */
  async disableFota(root: boolean): Promise<string> {
    if (!root) return stripTags((await api<{ result?: string }>('/disable_fota', { timeout: 60_000 })).result ?? '')
    const packages = ['com.zte.zdm', 'cn.zte.aftersale', 'com.zte.zdmdaemon', 'com.zte.zdmdaemon.install', 'com.zte.analytics', 'com.zte.neopush']
    const commands = ['pm disable com.zte.zdm', ...packages.map((p) => `pm uninstall -k --user 0 ${p}`), 'am force-stop com.zte.zdm']
    return rootShell(commands.map((c) => `${c} 2>&1`).join('; '), 30_000)
  },

  /**
   * 备份当前槽位的 boot 分区到上传目录（刷机救砖用）。dd 期间没有输出，root shell 的读超时取后端上限 100 s；
   * 以结束标记判断成功，避免原版「fetch 先超时、dd 还没写完就去下载」拿到残缺文件。
   */
  async extractBoot(): Promise<string> {
    const suffix = (await rootShell('getprop ro.boot.slot_suffix', 8_000)).trim()
    const part = /^_[ab]$/.test(suffix) ? `boot${suffix}` : 'boot'
    const file = `${UPLOAD_DIR}/${part}.img`
    // root 建的目录 / 文件属主是 root：上传目录还没建过时，之后 App 自己往里写（上传、存启动脚本）会被拒，所以交还给 App 的用户
    const owner = `$(stat -c %u:%g ${FILES_DIR})`
    const out = await rootShell(
      `mkdir -p ${UPLOAD_DIR} && { chown ${owner} ${UPLOAD_DIR} 2>/dev/null; true; } && rm -f ${file} && dd if=/dev/block/by-name/${part} of=${file} bs=1048576 2>&1 && { chown ${owner} ${file} 2>/dev/null; chmod 644 ${file}; true; } && echo __ok__`,
      100_000,
    )
    if (!out.includes('__ok__')) throw new Error(out.trim() || 'dd failed')
    return `${part}.img`
  },

  /** 从诊断通道读 IMEI（AT 读不到时用） */
  readImeiDeep: () => rootShell(`${FILES_DIR}/imei_reader 2>&1`, 20_000),

  /* —— 端口防护（iptables，只处理 TCP；IPv4 / IPv6 分开看，见 model/ports） —— */
  blockedPorts: async (): Promise<BlockedPorts> => parseBlockedPorts(await rootShell(BLOCKED_PORTS_CMD, 8_000)),
  /**
   * 先清掉这个端口的 DROP 规则，阻止时再加一条（-C 先查，不重复加）；可选写进启动脚本，开机自动应用。
   * 开机加固过的端口不碰它们的 IPv6 规则：放行只放行局域网，免得把 ADB、Web 终端暴露到公网 IPv6 上。
   * 固件自带规则的端口（8080 等）一律不动：删掉它们的 DROP 会把官方后台暴露到蜂窝侧。
   */
  async setPortBlocked(port: number, blocked: boolean, options: { ipv6: boolean; onBoot: boolean }) {
    if (V4_SYSTEM_PORTS.has(port)) throw new Error(`port ${port} is managed by the firmware`)
    const hardened = V6_HARDENED_PORTS.has(port)
    const bins = options.ipv6 ? ['iptables', 'ip6tables'] : ['iptables']
    const lines: string[] = []
    for (const bin of bins) {
      if (bin === 'iptables' || !hardened) {
        for (const table of ['filter', 'nat', 'mangle', 'raw', 'security']) {
          lines.push(`${bin}-save -t ${table} | grep -- '--dport ${port} .*DROP' | sed 's/^-A/-D/' | while read line; do ${bin} -t ${table} $line; done`)
        }
      }
      if (blocked) lines.push(`${bin} -C INPUT -p tcp --dport ${port} -j DROP 2>/dev/null || ${bin} -A INPUT -p tcp --dport ${port} -j DROP`)
    }
    lines.push(`touch ${BOOT_SCRIPT}; sed -i '/# UFI-TOOLS .* ${port}$/d' ${BOOT_SCRIPT}`)
    if (blocked && options.onBoot) {
      // 开机加固本来就会加 IPv6 规则，这里不再重复写
      for (const bin of bins.filter((bin) => bin === 'iptables' || !hardened)) {
        lines.push(`echo '(${bin} -A INPUT -p tcp --dport ${port} -j DROP >/dev/null 2>&1 &) # UFI-TOOLS ${bin === 'iptables' ? 'v4' : 'v6'} ${port}' >> ${BOOT_SCRIPT}`)
      }
    }
    return rootShell(lines.join('\n'), 20_000)
  },

  /* —— 启动脚本 —— */
  readBootScript: () => rootShell(`timeout 5s awk '{print}' ${BOOT_SCRIPT} 2>/dev/null`, 10_000),
  /** 先上传成文件再 mv 过去：避开命令行转义 */
  async writeBootScript(text: string) {
    const content = (text.trim() ? text : DEFAULT_BOOT_SCRIPT).replace(/\r\n/g, '\n')
    const { url } = await uploadFile<{ url?: string }>('/upload_img', new Blob([content.endsWith('\n') ? content : `${content}\n`], { type: 'text/plain' }), {
      filename: 'boot.sh',
      timeout: 60_000,
    })
    const name = String(url ?? '').split('/').pop() ?? ''
    if (!/^[\w.-]+$/.test(name)) throw new Error('upload failed')
    // /sdcard 可能是 FUSE，chmod 会失败：移过去就算成功，chmod 尽力而为
    const out = await rootShell(`mv ${UPLOAD_DIR}/${name} ${BOOT_SCRIPT} && { chmod 644 ${BOOT_SCRIPT} 2>/dev/null; true; } && echo __ok__`, 10_000).catch(
      (error: unknown) => (error instanceof Error ? error.message : String(error)),
    )
    if (!out.includes('__ok__')) {
      // 没移走的临时文件别留在「上传的文件」里
      void api('/delete_img', { method: 'POST', json: { file_name: name } }).catch(() => undefined)
      throw new Error(out.trim() || 'mv failed')
    }
  },

  /* —— 上传文件 —— */
  async listUploads(): Promise<UploadedFile[]> {
    const out = await userShell(`ls -l ${UPLOAD_DIR}/ 2>/dev/null`)
    return parseLsLong(out)
  },
  upload: (file: File, onProgress?: (loaded: number, total: number) => void, signal?: AbortSignal) =>
    uploadFile<{ url?: string }>('/upload_img', file, { onProgress, signal }),
  /** 上传后文件名是 <uuid>.<ext>；原名只含安全字符时改回原名（与原版一致） */
  async renameUpload(from: string, to: string) {
    if (!/^[\w.-]+$/.test(from) || !/^[\w.]+$/.test(to)) return from
    await userShell(`mv ${UPLOAD_DIR}/${from} ${UPLOAD_DIR}/${to} 2>&1`)
    return to
  },
  deleteUpload: (name: string) => api('/delete_img', { method: 'POST', json: { file_name: name } }),
  clearUploads: () => api<{ deleted_list?: Record<string, boolean> }>('/delete_all_uploads_data', { method: 'POST', timeout: 30_000 }),

  /* —— 自定义注入 —— */
  customHead: async () => String((await api<{ text?: string }>('/get_custom_head', { anonymous: true })).text ?? ''),
  setCustomHead: (text: string) => api('/set_custom_head', { method: 'POST', json: { text: text.trim() }, timeout: 60_000 }),
}

export const uploadUrl = (name: string) => `/api/uploads/${encodeURIComponent(name)}`

export interface UploadedFile {
  name: string
  size: number | null
  modified: string | null
}

/** toybox 的 ls -l：权限 链接数 属主 属组 大小 日期 时间 名称；认不出的行只取名称 */
export function parseLsLong(out: string): UploadedFile[] {
  const files: UploadedFile[] = []
  for (const line of out.split('\n')) {
    const text = line.trim()
    if (!text || /^total\s+\d+/.test(text)) continue
    const match = /^([-dlbcps][-rwxsStT]{9})\S*\s+\d+\s+\S+\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/.exec(text)
    if (match) {
      if (match[1].startsWith('d')) continue
      files.push({ name: match[4], size: Number(match[2]), modified: match[3] })
    } else if (!text.includes(' ')) {
      files.push({ name: text, size: null, modified: null })
    }
  }
  return files.sort((a, b) => (b.modified ?? '').localeCompare(a.modified ?? '') || a.name.localeCompare(b.name))
}

/** Web 终端地址：设备上用当前访问的主机名（远程访问、反向代理时网关 IP 打不开）；开发时走同源代理 */
export function ttydUrl(port = TTYD_PORT): string {
  const host = window.location.hostname
  const local = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]'
  // 开发 / 本机预览：走 dev server 的同源代理（mock/plugin.ts），浏览器不一定能直连设备
  if (import.meta.env.DEV || local) return '/ttyd/'
  return `http://${host.includes(':') && !host.startsWith('[') ? `[${host}]` : host}:${port}/`
}
