import type { Storage } from './files'
import { between, fail, ok, optBoolean, optString, sleep, type ApiRequest, type ApiResult } from './http'
import { MockShell } from './shell'

/**
 * Mock：高级功能（Samba root 钩子）、Root / User Shell、TTYD 探测、ADB、官方后台密码同步、禁用固件更新，
 * 格式照 docs/legacy-tools.md §5、§6 与附录 C.5 / C.7 / C.11。
 *
 * 初始：高级功能未开启（root_shell 报 sock 不存在）、无线 ADB 已就绪（adb_alive 为 "true"）、
 * 无线 ADB 开机自启关闭、已保存官方后台密码 admin。
 */

export interface AdvancedDeps {
  storage: Storage
  identity(): { model: string; imei: string; crVersion: string }
  /** 网关地址（hasTTYD 返回的 ip 用它的主机部分） */
  lanIp(): string
  /** 官方 Samba 开关：关着时 samba_exec.sh 不会被执行，root 也就起不来 */
  sambaOn(): boolean
  /** 以 root 执行了 reboot */
  reboot(): void
}

/** 钩子写进 smb.conf 后，App 每 30 s 访问一次 Samba，下一次访问时才以 root 拉起 socat / ttyd */
const ROOT_DELAY = 30_000
/** samba_exec.sh 的开机窗口：这之内第一次执行才跑 boot_up_script */
const BOOT_WINDOW = 120_000
/** 开机后 ADBService 探测到 localhost:5555 的时间【推断】 */
const ADB_BOOT_DELAY = 20_000
const USER_SHELL_LIMIT = 300_000
const TTYD_PORT = 1146
const ADB_PORT = 5555

const SOCK_MISSING = '执行命令失败，没有找到 socat 创建的 sock (高级功能是否开启？)'

/** org.json 的 optInt：数字取整，数字字符串也认，其它用默认值 */
function optInt(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : Number.NaN
  return Number.isFinite(n) ? Math.trunc(n) : fallback
}

export class MockAdvanced {
  readonly shell: MockShell
  private readonly deps: AdvancedDeps
  /** smb.conf 里写着 root preexec 钩子 */
  private hooked = false
  /** socat / ttyd 以 root 运行起来的时刻（在未来表示还没起来）；null = 没有运行 */
  private rootAt: number | null = null
  /** 本次开机的时刻；0 = 开发服务器启动前就开着机 */
  private bootAt = 0
  /** 重启后第一次执行 samba_exec.sh 时要跑 boot_up_script */
  private pendingBoot = false
  private adbAt = 0
  /** prefs ADB_IP_ENABLED */
  private adbAutostart = false
  /** prefs ADMIN_PWD；null = 没有保存 */
  private adminPwd: string | null = 'admin'
  private fotaBusy = false

  constructor(deps: AdvancedDeps) {
    this.deps = deps
    this.shell = new MockShell({ storage: deps.storage, identity: deps.identity, rootSince: () => this.rootSince(), reboot: deps.reboot })
  }

  /** root shell 从什么时候可用；不可用为 null */
  rootSince(): number | null {
    const now = Date.now()
    // 钩子已写好、但写入时 Samba 关着：Samba 打开后的下一次访问才执行
    if (this.hooked && this.rootAt === null && now >= this.bootAt && this.deps.sambaOn()) {
      this.rootAt = Math.max(now, this.bootAt) + ROOT_DELAY
      if (this.rootAt - this.bootAt > BOOT_WINDOW) this.pendingBoot = false
    }
    if (this.rootAt === null || now < this.rootAt) return null
    if (this.pendingBoot) {
      // 先清标记：boot() 里执行用户脚本时还会回到这里
      this.pendingBoot = false
      this.shell.boot(this.rootAt)
    }
    return this.rootAt
  }

  rootReady(): boolean {
    return this.rootSince() !== null
  }

  /** ADBService.adbIsReady：能连上 localhost:5555（端口被 DROP 且没有 lo 放行时连不上） */
  adbReady(): boolean {
    return Date.now() >= this.adbAt && !this.shell.localBlocked(ADB_PORT)
  }

  /** 整机重启：iptables 清空、socat / ttyd 没了；钩子还在的话开机后 Samba 再次拉起它们并执行 boot_up_script */
  rebooted(ms: number) {
    this.bootAt = Date.now() + ms
    this.shell.reset(this.bootAt)
    this.adbAt = this.bootAt + ADB_BOOT_DELAY
    this.rootAt = this.hooked && this.deps.sambaOn() ? this.bootAt + ROOT_DELAY : null
    this.pendingBoot = this.hooked
  }

  async api(req: ApiRequest): Promise<ApiResult | null> {
    switch (req.path) {
      case '/api/smbPath':
        return this.smbPath(req.query.get('enable'))
      case '/api/root_shell': {
        if (!req.json) return fail('shell执行出错: 解析请求的json出错')
        const command = optString(req.json.command).trim()
        // timeout 是 socket 每读一行的超时，缺省与上限都是 100 s；这里按命令的总阻塞时间近似
        const timeout = Math.min(optInt(req.json.timeout, 100_000), 100_000)
        if (!command) return fail('shell执行出错: 命令不能为空')
        if (this.rootSince() === null) return fail(`shell执行出错: ${SOCK_MISSING}`)
        const result = this.shell.run(command, true)
        const limit = timeout > 0 ? timeout : 100_000
        if (result.wait > limit) {
          await sleep(limit)
          return fail('shell执行出错: 请检查命令输入格式')
        }
        await sleep(result.wait + between(30, 120))
        // 只有 stdout；socat 不转发 stderr
        return ok({ result: result.out.replace(/\s+$/, '') })
      }
      case '/api/user_shell': {
        if (!req.json) return fail('shell执行出错: 解析请求的json出错')
        const command = optString(req.json.command).trim()
        if (!command) return fail('shell执行出错: 命令不能为空')
        const result = this.shell.run(command, false)
        if (result.wait > USER_SHELL_LIMIT) {
          await sleep(USER_SHELL_LIMIT)
          return fail('shell执行出错: Error: Command timed out after 300 seconds')
        }
        await sleep(result.wait + between(20, 80))
        // stderr 只要有输出就算失败，哪怕退出码是 0
        if (result.err) return fail(`shell执行出错: ${result.err.trim()}`)
        return ok({ result: { done: true, content: result.out.trim() } })
      }
      case '/api/hasTTYD': {
        const port = req.query.get('port')
        if (port === null) return fail('获取TTYD信息出错:query 缺少 port 参数')
        return ok({ code: await this.probe(port), ip: `${this.deps.lanIp()}:${port}` })
      }
      case '/api/adb_wifi_setting': {
        if (req.method !== 'POST') return ok({ enabled: this.adbAutostart })
        if (!req.json) return fail('参数解析失败')
        const enabled = optBoolean(req.json.enabled, false)
        // 关闭时后端会删掉 ADMIN_PWD（定时任务随后只能用默认密码登录）
        this.adminPwd = enabled ? optString(req.json.password) : null
        this.adbAutostart = enabled
        return ok({ result: 'success', enabled: String(enabled) })
      }
      case '/api/adb_alive':
        return ok({ result: String(this.adbReady()) })
      case '/api/get_official_web_password':
        return ok({ pwd: this.adminPwd ?? '' })
      case '/api/update_admin_pwd':
        if (!req.json) return fail('参数解析失败')
        this.adminPwd = optString(req.json.password)
        return ok()
      case '/api/disable_fota': {
        if (this.fotaBusy) return fail('禁用系统更新出错：禁用系统更新失败')
        this.fotaBusy = true
        try {
          // 依次执行 7 条 adb shell pm …；ADB 没就绪时每条都失败，但后端不检查结果，照样返回成功
          const ready = this.adbReady()
          await sleep(ready ? between(3_000, 5_000) : between(800, 1_500))
          if (ready) this.shell.removeFota()
        } finally {
          this.fotaBusy = false
        }
        return ok({ result: '执行成功,如需强力禁用请使用高级功能！' })
      }
      default:
        return null
    }
  }

  /** GET /api/smbPath?enable=1|其它 */
  private async smbPath(enable: string | null): Promise<ApiResult> {
    if (enable === null) return fail('Error：缺少 query 参数 enable')
    if (enable === '1') {
      // App 身份写不了 /data/samba；只有无线 ADB 就绪时 adb shell 那条路能成功
      await sleep(between(1_200, 2_500))
      if (!this.adbReady()) {
        return fail('Error：开启高级功能失败(Adb与Shell方式执行不成功)，请打开网络ADB后再试<br>Failed to enable advanced features (resultAdb and resultShell execution unsuccessful)')
      }
      this.hooked = true
      if (this.rootAt === null && this.deps.sambaOn()) this.rootAt = Date.now() + ROOT_DELAY
      return ok({ result: '执行成功，等待1-2分钟即可生效！<br>Execution successful, please wait 1–2 minutes for it to take effect!' })
    }
    // 关闭要经 root shell 删掉 smb.conf
    if (this.rootSince() === null) {
      return fail(
        `Error：${SOCK_MISSING}<br>Command execution failed, could not find the sock created by socat (are advanced features enabled?)`,
      )
    }
    await sleep(between(400, 900))
    this.hooked = false
    this.pendingBoot = false
    // 按 C.11：关闭后立即视为未开启（真机上已运行的 socat / ttyd 其实会留到重启）
    this.rootAt = null
    return ok({ result: '执行成功<br>Execution successful！' })
  }

  /** 后端 GET http://<网关>:<port>（连接 / 读取各 1.5 s）：设备访问自己走 lo，被 DROP 时等到连接超时 */
  private async probe(port: string): Promise<string> {
    const n = Number(port)
    if (!/^\d{1,5}$/.test(port) || n < 1 || n > 65_535) return '-1'
    // 8080 官方后台、2333 本服务会返回 200；TTYD 只在高级功能运行时有；其它端口不是 HTTP 或没在监听
    const http = n === 8080 || n === 2333 || (n === TTYD_PORT && this.rootReady())
    if (!http) return '-1'
    if (this.shell.localBlocked(n)) {
      await sleep(1_500)
      return '-1'
    }
    return '200'
  }
}
