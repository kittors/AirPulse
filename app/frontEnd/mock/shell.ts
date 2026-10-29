import { BOOT_SCRIPT, type Storage } from './files'
import { DEVICE_TZ, deviceStamp, shellDate } from './http'

/**
 * Mock：Root Shell / User Shell 背后的 sh（docs/legacy-tools.md §5.3–§5.9、附录 C.5）。
 * 只认识 AirPulse 与原版会用到的命令，其它命令没有输出。语法够用为止：
 * ; 换行 & && || | ( ) { }、for / while read / if、$变量 $(命令) `命令`、* 通配、
 * 重定向 > >> < 2>&1 2>/dev/null &>，单双引号与反斜杠按 sh 规则处理。
 */

const FILES = '/data/data/com.minikano.f50_sms/files'
const UPLOADS = `${FILES}/uploads`
const SMB_LOG = '/sdcard/smb_log.log'
const KEEP_ALIVE_LOG = '/sdcard/ufi_keep_alive.log'
const APP_USER = 'u0_a103'
const PATH = '/product/bin:/apex/com.android.runtime/bin:/system_ext/bin:/system/bin:/system/xbin:/odm/bin:/vendor/bin:/vendor/xbin'
const FOTA_PACKAGES = ['com.zte.zdm', 'cn.zte.aftersale', 'com.zte.zdmdaemon', 'com.zte.zdmdaemon.install', 'com.zte.analytics', 'com.zte.neopush']
const PACKAGES = ['android', 'com.android.phone', 'com.android.settings', 'com.android.shell', 'com.minikano.f50_sms', 'com.sprd.engineermode', ...FOTA_PACKAGES]
/** samba_exec.sh 开机时给 IPv6 默认 DROP 的端口 */
const V6_PORTS = [8080, 1146, 139, 445, 5555, 5201, 5001, 5002]
/** INPUT 链本来就有的规则（netd） */
const BASE_RULES = ['-j bw_INPUT', '-j fw_INPUT']
/** 开机时刻：与 /api/baseDeviceInfo 的 boot_time 对得上（275112 s + 开发服务器运行时长） */
const BOOT_AT = Date.now() - process.uptime() * 1000 - 275_112_000
/** 上一次开机期间用户移除了高级功能：smb_log 里还留着那之前的记录 */
const REMOVED_AT = BOOT_AT - 2 * 3_600_000
const PREV_BOOT = REMOVED_AT - 3 * 86_400_000
const GUARD_PID = 3017

export interface ShellResult {
  out: string
  err: string
  /** 命令会阻塞多久（毫秒）；常驻 / 交互式命令为 Infinity */
  wait: number
}

interface Step extends ShellResult {
  status: number
}

export interface ShellDeps {
  storage: Storage
  /** root shell（socat）从什么时候开始可用；不可用为 null */
  rootSince(): number | null
  identity(): { model: string; imei: string; crVersion: string }
  /** root 身份执行了 reboot */
  reboot(): void
}

/* —— 词法与语法 —— */

/** 词由片段组成：' 字面量、" 双引号（展开变量不拆词）、空串 = 无引号、$( 命令替换 */
interface Part {
  text: string
  quote: '' | "'" | '"' | '$('
}
type Word = Part[]
type Token = { kind: 'word'; word: Word } | { kind: 'op'; op: string } | { kind: 'redir'; fd: number; op: string }
interface Redirect {
  /** 0 输入、1 输出、2 错误、3 = &>（输出和错误） */
  fd: number
  op: string
  target: Word
}
type Node =
  | { type: 'list'; items: { op: string; node: Node; bg: boolean }[] }
  | { type: 'pipe'; cmds: Node[]; bang: boolean }
  | { type: 'cmd'; words: Word[]; redirects: Redirect[] }
  | { type: 'group'; body: Node; subshell: boolean; redirects: Redirect[] }
  | { type: 'for'; name: string; items: Word[]; body: Node; redirects: Redirect[] }
  | { type: 'while'; cond: Node; body: Node; until: boolean; redirects: Redirect[] }
  | { type: 'if'; branches: { cond: Node; body: Node }[]; otherwise: Node | null; redirects: Redirect[] }

/** open 位置的 ( 对应的 )（跳过引号与嵌套）；找不到返回末尾 */
function closing(src: string, open: number): number {
  let depth = 0
  let quote = ''
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i]
    if (quote) {
      if (ch === quote) quote = ''
      else if (ch === '\\' && quote === '"') i += 1
    } else if (ch === "'" || ch === '"') quote = ch
    else if (ch === '\\') i += 1
    else if (ch === '(') depth += 1
    else if (ch === ')' && --depth === 0) return i
  }
  return src.length
}

/** 单 / 双引号没有闭合 */
function unclosed(src: string): boolean {
  let quote = ''
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    if (quote === "'") {
      if (ch === "'") quote = ''
    } else if (ch === '\\') {
      i += 1
    } else if (quote === '"') {
      if (ch === '"') quote = ''
    } else if (ch === "'" || ch === '"') {
      quote = ch
    } else if (ch === '#' && (i === 0 || /\s/.test(src[i - 1]))) {
      // 注释里的引号不算
      while (i + 1 < src.length && src[i + 1] !== '\n') i += 1
    }
  }
  return quote !== ''
}

function tokenize(src: string): Token[] {
  const tokens: Token[] = []
  const cur: { word: Word | null } = { word: null }
  const add = (text: string, quote: Part['quote']) => {
    const word = (cur.word ??= [])
    const last = word[word.length - 1]
    if (quote === '' && last?.quote === '') last.text += text
    else word.push({ text, quote })
  }
  const end = () => {
    if (cur.word) tokens.push({ kind: 'word', word: cur.word })
    cur.word = null
  }
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i]
    const next = src[i + 1] ?? ''
    if (ch === '\\') {
      // 反斜杠续行，或把下一个字符按字面量
      if (next !== '\n') add(next, "'")
      i += 1
    } else if (ch === "'") {
      const stop = src.indexOf("'", i + 1)
      const close = stop === -1 ? src.length : stop
      add(src.slice(i + 1, close), "'")
      i = close
    } else if (ch === '"') {
      let j = i + 1
      let text = ''
      for (; j < src.length && src[j] !== '"'; j += 1) {
        if (src[j] === '\\' && '"\\$`'.includes(src[j + 1] ?? '')) {
          add(text, '"')
          add(src[j + 1], "'")
          text = ''
          j += 1
        } else if (src[j] === '$' && src[j + 1] === '(') {
          const close = closing(src, j + 1)
          text += src.slice(j, close + 1)
          j = close
        } else {
          text += src[j]
        }
      }
      add(text, '"')
      i = j
    } else if (ch === '$' && next === '(') {
      const close = closing(src, i + 1)
      add(src.slice(i + 2, close), '$(')
      i = close
    } else if (ch === '`') {
      const stop = src.indexOf('`', i + 1)
      const close = stop === -1 ? src.length : stop
      add(src.slice(i + 1, close), '$(')
      i = close
    } else if (ch === '#' && !cur.word) {
      while (i + 1 < src.length && src[i + 1] !== '\n') i += 1
    } else if (ch === ' ' || ch === '\t' || ch === '\r') {
      end()
    } else if (ch === '>' || ch === '<' || (ch === '&' && next === '>')) {
      // 紧挨着的单个数字是文件描述符：2>&1、2>/dev/null
      const word = cur.word
      const fd = word?.length === 1 && word[0].quote === '' && /^\d$/.test(word[0].text) ? Number(word[0].text) : null
      if (fd !== null) cur.word = null
      else end()
      if (ch === '&') {
        const append = src[i + 2] === '>'
        tokens.push({ kind: 'redir', fd: 3, op: append ? '>>' : '>' })
        i += append ? 2 : 1
      } else if (ch === '>' && next === '>') {
        tokens.push({ kind: 'redir', fd: fd ?? 1, op: '>>' })
        i += 1
      } else if (next === '&') {
        tokens.push({ kind: 'redir', fd: fd ?? (ch === '<' ? 0 : 1), op: `${ch}&` })
        i += 1
      } else {
        tokens.push({ kind: 'redir', fd: fd ?? (ch === '<' ? 0 : 1), op: ch })
      }
    } else if ('|&;()\n'.includes(ch)) {
      end()
      if ((ch === '&' || ch === '|') && next === ch) {
        tokens.push({ kind: 'op', op: ch + ch })
        i += 1
      } else {
        tokens.push({ kind: 'op', op: ch })
      }
    } else {
      add(ch, '')
    }
  }
  end()
  return tokens
}

const STOPS = new Set(['}', 'do', 'done', 'then', 'elif', 'else', 'fi'])

function parse(src: string): Node {
  const tokens = tokenize(src)
  let pos = 0
  const peek = (): Token | undefined => tokens[pos]
  const keyword = (token = peek()) => (token?.kind === 'word' && token.word.length === 1 && token.word[0].quote === '' ? token.word[0].text : '')
  const op = (token = peek()) => (token?.kind === 'op' ? token.op : '')
  const skip = (...ops: string[]) => {
    while (ops.includes(op())) pos += 1
  }
  const expect = (word: string) => {
    if (keyword() === word) pos += 1
  }

  function redirects(): Redirect[] {
    const out: Redirect[] = []
    for (let token = peek(); token?.kind === 'redir'; token = peek()) {
      pos += 1
      const target = peek()
      if (target?.kind === 'word') pos += 1
      out.push({ fd: token.fd, op: token.op, target: target?.kind === 'word' ? target.word : [] })
    }
    return out
  }

  function list(): Node {
    const items: { op: string; node: Node; bg: boolean }[] = []
    let joiner = ';'
    for (;;) {
      skip('\n', ';')
      const token = peek()
      if (!token || op(token) === ')' || STOPS.has(keyword(token))) break
      const start = pos
      const node = pipeline()
      if (pos === start) {
        // 不认识的记号：跳过，免得死循环
        pos += 1
        continue
      }
      const next = op()
      items.push({ op: joiner, node, bg: next === '&' })
      joiner = ';'
      if (next === '&&' || next === '||') {
        joiner = next
        pos += 1
        skip('\n')
      } else if (next === ';' || next === '\n' || next === '&') {
        pos += 1
      } else {
        break
      }
    }
    return { type: 'list', items }
  }

  function pipeline(): Node {
    const bang = keyword() === '!'
    if (bang) pos += 1
    const cmds = [command()]
    while (op() === '|') {
      pos += 1
      skip('\n')
      cmds.push(command())
    }
    return cmds.length === 1 && !bang ? cmds[0] : { type: 'pipe', cmds, bang }
  }

  function command(): Node {
    const word = keyword()
    if (op() === '(') {
      pos += 1
      const body = list()
      if (op() === ')') pos += 1
      return { type: 'group', body, subshell: true, redirects: redirects() }
    }
    if (word === '{') {
      pos += 1
      const body = list()
      expect('}')
      return { type: 'group', body, subshell: false, redirects: redirects() }
    }
    if (word === 'for') {
      pos += 1
      const name = keyword()
      pos += 1
      const items: Word[] = []
      skip('\n')
      if (keyword() === 'in') {
        pos += 1
        for (let token = peek(); token?.kind === 'word'; token = peek()) {
          items.push(token.word)
          pos += 1
        }
      }
      skip(';', '\n')
      expect('do')
      const body = list()
      expect('done')
      return { type: 'for', name, items, body, redirects: redirects() }
    }
    if (word === 'while' || word === 'until') {
      pos += 1
      const cond = list()
      expect('do')
      const body = list()
      expect('done')
      return { type: 'while', cond, body, until: word === 'until', redirects: redirects() }
    }
    if (word === 'if') {
      pos += 1
      const branches: { cond: Node; body: Node }[] = []
      let otherwise: Node | null = null
      for (;;) {
        const cond = list()
        expect('then')
        branches.push({ cond, body: list() })
        if (keyword() === 'elif') {
          pos += 1
          continue
        }
        if (keyword() === 'else') {
          pos += 1
          otherwise = list()
        }
        break
      }
      expect('fi')
      return { type: 'if', branches, otherwise, redirects: redirects() }
    }
    const words: Word[] = []
    const reds: Redirect[] = []
    for (let token = peek(); token && token.kind !== 'op'; token = peek()) {
      if (token.kind === 'redir') {
        reds.push(...redirects())
      } else {
        words.push(token.word)
        pos += 1
      }
    }
    return { type: 'cmd', words, redirects: reds }
  }

  return list()
}

/* —— 小工具 —— */

interface Ctx {
  root: boolean
  vars: Map<string, string>
  cwd: string
  status: number
  exited: boolean
  depth: number
}

type Sink = { kind: 'stdout' | 'stderr' | 'null' } | { kind: 'file'; path: string }

interface Io {
  stdin: string | null
  out: Sink
  err: Sink
  error?: Step
}

interface Entry {
  name: string
  size: number
  mtime: number
  dir: boolean
  owner: string
}

interface Proc {
  user: string
  pid: number
  ppid: number
  rss: number
  name: string
  cmdline: string
}

const done = (out = '', status = 0): Step => ({ out, err: '', wait: 0, status })
const fail = (err: string, status = 1): Step => ({ out: '', err: `${err}\n`, wait: 0, status })
const basename = (path: string) => path.replace(/\/+$/, '').slice(path.replace(/\/+$/, '').lastIndexOf('/') + 1)
const lines = (text: string) => (text ? text.replace(/\n$/, '').split('\n') : [])
const pad = (value: string | number, width: number, left = false) => (left ? String(value).padEnd(width) : String(value).padStart(width))
const joinLines = (list: string[]) => list.map((line) => `${line}\n`).join('')

/** 路径规范化：合并多余的 /、处理 . 和 ..，/data/user/0、/storage/emulated/0 等别名统一 */
function normalize(target: string): string {
  const parts: string[] = []
  for (const segment of target.split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return `/${parts.join('/')}`
    .replace(/^\/data\/user\/0(?=\/|$)/, '/data/data')
    .replace(/^\/(?:storage\/emulated\/0|storage\/self\/primary|mnt\/sdcard)(?=\/|$)/, '/sdcard')
}

/** BRE → JS 正则：\( \) \{ \} \| \+ \? 才是元字符，不带反斜杠的反而是普通字符 */
const bre = (pattern: string) => pattern.replace(/\\?([(){}|+?])/g, (match, ch: string) => (match.length === 2 ? ch : `\\${ch}`))

const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '\\': '\\', a: '\x07', e: '\x1b', '0': '' }
/** echo -e / printf 的转义 */
const escapes = (text: string) => text.replace(/\\([nrt\\ae0])/g, (_all, ch: string) => ESCAPES[ch] ?? ch)

/** sleep / timeout 的时长：5、5s、1.5m */
function duration(text: string): number {
  const match = /^(\d+(?:\.\d+)?)([smhd]?)$/.exec(text)
  if (!match) return 0
  const unit: Record<string, number> = { '': 1_000, s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }
  return Number(match[1]) * (unit[match[2]] ?? 1_000)
}

/** date +格式 的常用部分（设备时区 UTC+8） */
function strftime(format: string, at = Date.now()): string {
  const d = new Date(at + DEVICE_TZ)
  const p = (n: number) => String(n).padStart(2, '0')
  const full = shellDate(at)
  const map: Record<string, string> = {
    Y: String(d.getUTCFullYear()),
    y: p(d.getUTCFullYear() % 100),
    m: p(d.getUTCMonth() + 1),
    d: p(d.getUTCDate()),
    e: String(d.getUTCDate()).padStart(2, ' '),
    H: p(d.getUTCHours()),
    M: p(d.getUTCMinutes()),
    S: p(d.getUTCSeconds()),
    s: String(Math.floor(at / 1000)),
    a: full.slice(0, 3),
    b: full.slice(4, 7),
    Z: 'CST',
    z: '+0800',
    n: '\n',
    t: '\t',
    '%': '%',
  }
  map.T = `${map.H}:${map.M}:${map.S}`
  map.F = `${map.Y}-${map.m}-${map.d}`
  return format.replace(/%(.)/g, (all, ch: string) => map[ch] ?? all)
}

/** iptables 规则的规范写法：去掉 -t、链名与位置，-p tcp 后补上 -m tcp（iptables -S 就这么显示） */
function canonical(args: string[]): string {
  const out: string[] = []
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i]
    if (arg === '-t' || arg === '--table') i += 1
    else if (arg === '-w' || arg === '--wait') continue
    else if (['-A', '-I', '-D', '-C', '--append', '--insert', '--delete', '--check'].includes(arg)) {
      i += 1
      if (/^\d+$/.test(args[i + 1] ?? '')) i += 1
    } else out.push(arg)
  }
  return out.join(' ').replace(/-p (tcp|udp)(?! -m \1)/, '-p $1 -m $1')
}

const DF = `Filesystem                 Size  Used Avail Use% Mounted on
/dev/root                  1.4G  1.4G  4.1M 100% /
tmpfs                      733M  1.2M  732M   1% /dev
tmpfs                      733M     0  733M   0% /mnt
/dev/block/dm-1            247M  246M     0 100% /vendor
/dev/block/by-name/cache    58M   56K   57M   1% /cache
/dev/block/dm-5             23G  5.4G   18G  24% /data
/data/media                 23G  5.4G   18G  24% /storage/emulated
`

const FREE = `                total        used        free      shared     buffers
Mem:             1.4G        856M        611M         11M         10M
-/+ buffers/cache:           846M        621M
Swap:          910.0M        561M        348M
`

export class MockShell {
  private readonly deps: ShellDeps
  /** INPUT 链（filter 表）：规范写法的规则；重启后清空 */
  private input: Record<'v4' | 'v6', string[]> = { v4: [...BASE_RULES], v6: [...BASE_RULES] }
  /** 已被 pm uninstall --user 0 的包 */
  private removed = new Set<string>()
  /** /sdcard 文件的修改时间 */
  private mtimes = new Map<string, number>()
  /** 上一轮 samba_exec.sh 的时间 */
  private lastRound = 0
  /** 本次开机的时刻（uptime 由它算） */
  private bootAt = BOOT_AT
  /** /data/local/tmp/boot_once.flag：上一次执行 boot_up_script 时记下的开机时刻 */
  private flagBoot = PREV_BOOT

  constructor(deps: ShellDeps) {
    this.deps = deps
    const { sdcard } = deps.storage
    // 上一次开机期间的日志：日志超 4 MB 清空过一次，之后每 30 s 一轮，直到高级功能被移除
    let history = 'Log file exceeded 4MB, clearing...\n'
    for (let i = 39; i >= 0; i -= 1) history += this.round(REMOVED_AT - i * 30_000, PREV_BOOT + 90_000, PREV_BOOT, PREV_BOOT)
    if (!sdcard.has(SMB_LOG)) sdcard.set(SMB_LOG, history)
    if (!sdcard.has(KEEP_ALIVE_LOG)) sdcard.set(KEEP_ALIVE_LOG, `[${shellDate(PREV_BOOT + 95_000)}] UFI-TOOLS keep-alive started, pid=${GUARD_PID}\n`)
    this.mtimes.set(SMB_LOG, REMOVED_AT)
    this.mtimes.set(KEEP_ALIVE_LOG, PREV_BOOT + 95_000)
  }

  run(command: string, root: boolean): ShellResult {
    this.syncLogs()
    const { out, err, wait } = this.script(command, root)
    return { out, err, wait }
  }

  /** 禁用固件更新（ADB 方式）卸载的那几个包 */
  removeFota() {
    for (const pkg of FOTA_PACKAGES) this.removed.add(pkg)
  }

  /** 设备重启：iptables 规则不持久，uptime 从 bootAt 重新算 */
  reset(bootAt: number) {
    this.bootAt = bootAt
    this.input = { v4: [...BASE_RULES], v6: [...BASE_RULES] }
  }

  /** 开机窗口内 Samba 第一次执行 samba_exec.sh：boot_up_script 执行用户开机脚本、给 IPv6 加默认 DROP、放行 lo */
  boot(now = Date.now()) {
    const { sdcard } = this.deps.storage
    // 这一轮就是 boot_up_script，先记下，免得下面执行用户脚本时又补一轮 schedule_script 的日志
    this.lastRound = now
    const stamp = `[${shellDate(now)}]`
    const script = sdcard.get(BOOT_SCRIPT)
    sdcard.set(KEEP_ALIVE_LOG, `${sdcard.get(KEEP_ALIVE_LOG) ?? ''}[${shellDate(now + 300)}] UFI-TOOLS keep-alive started, pid=${GUARD_PID}\n`)
    const log = [
      `${stamp} samba_exec.sh start running...`,
      `${stamp} uptime_seconds=${Math.floor((now - this.bootAt) / 1000)}, now_ts=${Math.floor(now / 1000)}, boot_time=${Math.floor(this.bootAt / 1000)}, last_boot_time=${Math.floor(this.flagBoot / 1000)}`,
      `${stamp} boot window (<120s) detected.`,
      `${stamp} detected new boot, running boot_up_script...`,
      `${stamp} starting UFI-TOOLS keep-alive...`,
      script === undefined ? `${stamp} ${BOOT_SCRIPT} not found，skip` : `${stamp} exec ${BOOT_SCRIPT} ...`,
    ]
    sdcard.set(SMB_LOG, (sdcard.get(SMB_LOG) ?? '') + joinLines(log))
    if (script === undefined) this.write(BOOT_SCRIPT, '#!/system/bin/sh\n# you script here...\nsync\n', false)
    else this.script(script, true)
    for (const proto of ['tcp', 'udp']) for (const port of V6_PORTS) this.input.v6.push(`-p ${proto} -m ${proto} --dport ${port} -j DROP`)
    this.input.v4.unshift('-i lo -j ACCEPT')
    sdcard.set(SMB_LOG, (sdcard.get(SMB_LOG) ?? '') + joinLines([`${stamp} start ttyd...`, `${stamp} start socat...`]))
    this.mtimes.set(SMB_LOG, now)
    this.flagBoot = this.bootAt
  }

  /** 设备自己访问本机某个 TCP 端口会不会被 DROP（走 lo，先命中 -i lo -j ACCEPT 就放行） */
  localBlocked(port: number): boolean {
    for (const rule of this.input.v4) {
      if (rule === '-i lo -j ACCEPT') return false
      if (rule.endsWith('-j DROP') && rule.includes(`--dport ${port}`) && !rule.includes('-p udp') && !rule.includes('-i ')) return true
    }
    return false
  }

  /* —— 执行 —— */

  private script(src: string, root: boolean): Step {
    // 引号没闭合：root shell（从 socket 读命令）会一直等后续输入；sh -c 直接报语法错误
    if (unclosed(src)) return root ? { out: '', err: '', wait: Infinity, status: 0 } : { out: '', err: 'sh: no closing quote\n', wait: 0, status: 2 }
    const ctx: Ctx = { root, vars: new Map([['PATH', PATH], ['HOME', root ? '/' : '/data']]), cwd: '/', status: 0, exited: false, depth: 0 }
    return this.node(parse(src), ctx, null)
  }

  private node(n: Node, ctx: Ctx, stdin: string | null): Step {
    switch (n.type) {
      case 'list': {
        const step = done()
        let status = ctx.status
        for (const item of n.items) {
          if (ctx.exited) break
          if ((item.op === '&&' && status !== 0) || (item.op === '||' && status === 0)) continue
          const result = this.node(item.node, ctx, stdin)
          step.out += result.out
          step.err += result.err
          // 放到后台的命令不阻塞
          if (!item.bg) step.wait += result.wait
          status = item.bg ? 0 : result.status
          ctx.status = status
        }
        step.status = status
        return step
      }
      case 'pipe': {
        let input = stdin
        let err = ''
        let wait = 0
        let status = 0
        for (const cmd of n.cmds) {
          const result = this.node(cmd, { ...ctx, vars: new Map(ctx.vars) }, input)
          // head 读够就退出，前面卡住的命令随之收到 SIGPIPE
          const head = cmd.type === 'cmd' && cmd.words[0]?.[0]?.text === 'head'
          wait = head ? result.wait : Math.max(wait, result.wait)
          input = result.out
          err += result.err
          status = result.status
        }
        return { out: input ?? '', err, wait, status: n.bang ? Number(status === 0) : status }
      }
      case 'cmd':
        return this.simple(n.words, n.redirects, ctx, stdin)
      case 'group': {
        const io = this.open(n.redirects, ctx)
        if (io.error) return io.error
        const inner = n.subshell ? { ...ctx, vars: new Map(ctx.vars) } : ctx
        return this.route(this.node(n.body, inner, io.stdin ?? stdin), io)
      }
      case 'for': {
        const io = this.open(n.redirects, ctx)
        if (io.error) return io.error
        const step = done()
        for (const value of this.expand(n.items, ctx).slice(0, 1_000)) {
          ctx.vars.set(n.name, value)
          this.merge(step, this.node(n.body, ctx, io.stdin ?? stdin))
          if (ctx.exited) break
        }
        return this.route(step, io)
      }
      case 'while': {
        const io = this.open(n.redirects, ctx)
        if (io.error) return io.error
        const input = io.stdin ?? stdin
        const step = done()
        const first = n.cond.type === 'list' && n.cond.items.length === 1 ? n.cond.items[0].node : null
        if (!n.until && first?.type === 'cmd' && this.expand(first.words.slice(0, 1), ctx)[0] === 'read') {
          // while read 变量：逐行读输入
          const names = this.expand(first.words.slice(1), ctx).filter((arg) => !arg.startsWith('-'))
          for (const line of lines(input ?? '').slice(0, 10_000)) {
            this.assignRead(names, line, ctx)
            this.merge(step, this.node(n.body, ctx, null))
            if (ctx.exited) break
          }
          step.status = 0
        } else {
          // 其它循环：条件成立就跑一遍循环体，然后一直卡着（while true; do …; sleep 1; done 之类）
          const cond = this.node(n.cond, ctx, input)
          this.merge(step, cond)
          step.status = 0
          if ((cond.status === 0) !== n.until) {
            this.merge(step, this.node(n.body, ctx, input))
            step.wait = Infinity
          }
        }
        return this.route(step, io)
      }
      case 'if': {
        const io = this.open(n.redirects, ctx)
        if (io.error) return io.error
        const step = done()
        for (const branch of n.branches) {
          const cond = this.node(branch.cond, ctx, io.stdin ?? stdin)
          this.merge(step, cond)
          if (cond.status === 0) {
            this.merge(step, this.node(branch.body, ctx, io.stdin ?? stdin))
            return this.route(step, io)
          }
        }
        if (n.otherwise) this.merge(step, this.node(n.otherwise, ctx, io.stdin ?? stdin))
        else step.status = 0
        return this.route(step, io)
      }
    }
  }

  private merge(into: Step, from: Step) {
    into.out += from.out
    into.err += from.err
    into.wait += from.wait
    into.status = from.status
  }

  private assignRead(names: string[], line: string, ctx: Ctx) {
    const list = names.length ? names : ['REPLY']
    const fields = line.trim().split(/\s+/)
    list.forEach((name, i) => ctx.vars.set(name, i === list.length - 1 ? fields.slice(i).join(' ') : (fields[i] ?? '')))
  }

  private simple(input: Word[], redirects: Redirect[], ctx: Ctx, stdin: string | null): Step {
    const words = [...input]
    // 开头的 NAME=value：设置变量（值不拆词）
    const assigns: [string, string][] = []
    while (words.length && words[0][0]?.quote === '' && /^[A-Za-z_]\w*=/.test(words[0][0].text)) {
      const text = this.expandWord(words.shift() ?? [], ctx, false)[0] ?? ''
      assigns.push([text.slice(0, text.indexOf('=')), text.slice(text.indexOf('=') + 1)])
    }
    const argv = this.expand(words, ctx)
    const io = this.open(redirects, ctx)
    if (io.error) return io.error
    if (!argv.length) {
      for (const [name, value] of assigns) ctx.vars.set(name, value)
      return done()
    }
    return this.route(this.exec(argv, ctx, io.stdin ?? stdin), io)
  }

  /** 处理重定向：> 先清空文件；2>&1 指向当前的标准输出 */
  private open(redirects: Redirect[], ctx: Ctx): Io {
    const io: Io = { stdin: null, out: { kind: 'stdout' }, err: { kind: 'stderr' } }
    for (const r of redirects) {
      const target = this.expandWord(r.target, ctx, false)[0] ?? ''
      if (r.op === '<') {
        const text = this.read(this.resolve(target, ctx))
        if (text === undefined) return { ...io, error: fail(`sh: ${target}: No such file or directory`) }
        io.stdin = text
      } else if (r.op === '>&') {
        const sink: Sink = target === '1' ? io.out : target === '2' ? io.err : { kind: 'null' }
        if (r.fd === 2) io.err = sink
        else io.out = sink
      } else if (r.op === '>' || r.op === '>>') {
        const path = this.resolve(target, ctx)
        const sink: Sink = path === '/dev/null' ? { kind: 'null' } : { kind: 'file', path }
        if (sink.kind === 'file' && r.op === '>') this.write(path, '', false)
        if (r.fd === 1 || r.fd === 3) io.out = sink
        if (r.fd === 2 || r.fd === 3) io.err = sink
      }
    }
    return io
  }

  private route(step: Step, io: Io): Step {
    const result: Step = { out: '', err: '', wait: step.wait, status: step.status }
    const send = (sink: Sink, text: string) => {
      if (!text) return
      if (sink.kind === 'stdout') result.out += text
      else if (sink.kind === 'stderr') result.err += text
      else if (sink.kind === 'file') this.write(sink.path, text, true)
    }
    send(io.out, step.out)
    send(io.err, step.err)
    return result
  }

  /* —— 展开 —— */

  private expand(words: Word[], ctx: Ctx): string[] {
    return words.flatMap((word) => this.expandWord(word, ctx, true))
  }

  /** 变量 / 命令替换 / 拆词 / 通配 */
  private expandWord(word: Word, ctx: Ctx, split: boolean): string[] {
    const fields: string[] = []
    let current = ''
    let has = false
    let glob = false
    for (const part of word) {
      if (part.quote === "'") {
        current += part.text
        has = true
        continue
      }
      const text = part.quote === '$(' ? this.capture(part.text, ctx) : this.expandText(part.text, ctx)
      if (part.quote === '"' || !split) {
        current += text
        has ||= part.quote === '"' || text !== ''
        continue
      }
      if (part.quote === '' && /[*?]/.test(part.text)) glob = true
      text.split(/[ \t\n]+/).forEach((piece, i) => {
        if (i > 0) {
          if (has) fields.push(current)
          current = ''
          has = false
        }
        current += piece
        if (piece) has = true
      })
    }
    if (has) fields.push(current)
    return glob ? fields.flatMap((field) => this.glob(field, ctx)) : fields
  }

  private expandText(text: string, ctx: Ctx): string {
    let out = ''
    for (let i = 0; i < text.length; i += 1) {
      if (text[i] !== '$') {
        out += text[i]
        continue
      }
      if (text[i + 1] === '(') {
        const close = closing(text, i + 1)
        out += this.capture(text.slice(i + 2, close), ctx)
        i = close
        continue
      }
      const match = /^\$(?:\{(\w+)\}|(\w+)|([?$#]))/.exec(text.slice(i))
      if (!match) {
        out += '$'
        continue
      }
      const name = match[1] ?? match[2] ?? match[3]
      out += name === '?' ? String(ctx.status) : name === '$' ? String(30_000 + ctx.depth) : name === '#' ? '0' : (ctx.vars.get(name) ?? '')
      i += match[0].length - 1
    }
    return out
  }

  /** $(命令)：子 shell 执行，去掉结尾换行 */
  private capture(src: string, ctx: Ctx): string {
    if (ctx.depth > 16) return ''
    const sub = { ...ctx, vars: new Map(ctx.vars), exited: false, depth: ctx.depth + 1 }
    return this.node(parse(src), sub, null).out.replace(/\n+$/, '')
  }

  private glob(pattern: string, ctx: Ctx): string[] {
    const slash = pattern.lastIndexOf('/')
    const prefix = slash === -1 ? '' : pattern.slice(0, slash + 1)
    const name = pattern.slice(slash + 1)
    if (/[*?]/.test(prefix) || !/[*?]/.test(name)) return [pattern]
    const re = new RegExp(`^${name.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`)
    const hits = (this.entries(this.resolve(prefix || '.', ctx)) ?? [])
      .map((entry) => entry.name)
      .filter((entry) => re.test(entry) && !entry.startsWith('.'))
      .sort()
    return hits.length ? hits.map((hit) => prefix + hit) : [pattern]
  }

  /* —— 文件 —— */

  private resolve(target: string, ctx: Ctx): string {
    return normalize(target.startsWith('/') ? target : `${ctx.cwd}/${target}`)
  }

  private file(path: string): Buffer | undefined {
    if (path.startsWith(`${UPLOADS}/`)) return this.deps.storage.uploads.get(path.slice(UPLOADS.length + 1))?.data
    if (path === '/proc/uptime') {
      const up = (Date.now() - this.bootAt) / 1000
      return Buffer.from(`${up.toFixed(2)} ${(up * 7.3).toFixed(2)}\n`)
    }
    if (path === '/proc/loadavg') return Buffer.from('0.62 0.55 0.48 2/1027 31502\n')
    const text = this.deps.storage.sdcard.get(path)
    return text === undefined ? undefined : Buffer.from(text, 'utf8')
  }

  private read(path: string): string | undefined {
    return this.file(path)?.toString('utf8')
  }

  /** 写文件：uploads 与 /sdcard 有效，其它位置（/sys、/proc……）只当写成功 */
  private write(path: string, data: string | Buffer, append: boolean, original?: string) {
    const { storage } = this.deps
    if (path.startsWith(`${UPLOADS}/`)) {
      const name = path.slice(UPLOADS.length + 1)
      const previous = storage.uploads.get(name)
      const bytes = typeof data === 'string' ? Buffer.from(data, 'utf8') : data
      storage.uploads.set(name, {
        data: append && previous ? Buffer.concat([previous.data, bytes]) : bytes,
        mtime: Date.now(),
        original: original ?? previous?.original ?? name,
      })
      storage.uploadsDir = true
    } else if (path.startsWith('/sdcard/')) {
      const text = typeof data === 'string' ? data : data.toString('utf8')
      storage.sdcard.set(path, append ? (storage.sdcard.get(path) ?? '') + text : text)
      this.mtimes.set(path, Date.now())
    }
  }

  private remove(path: string): boolean {
    if (path.startsWith(`${UPLOADS}/`)) return this.deps.storage.uploads.delete(path.slice(UPLOADS.length + 1))
    return this.deps.storage.sdcard.delete(path)
  }

  /** 目录内容；不是目录返回 null */
  private entries(dir: string): Entry[] | null {
    const { storage } = this.deps
    const folder = (name: string, owner = 'root'): Entry => ({ name, size: 3452, mtime: BOOT_AT, dir: true, owner })
    switch (dir) {
      case UPLOADS:
        return storage.uploadsDir ? [...storage.uploads].map(([name, file]) => ({ name, size: file.data.length, mtime: file.mtime, dir: false, owner: APP_USER })) : null
      case FILES: {
        const names = ['adb', 'curl', 'imei_reader', 'iperf3', 'jq', 'login.sh', 'samba_exec.sh', 'sendat', 'smb.conf', 'socat', 'ttyd', 'ufi_keep_alive.sh']
        const list: Entry[] = names.map((name) => ({ name, size: name.endsWith('.sh') || name === 'smb.conf' ? 2_048 : 1_843_200, mtime: BOOT_AT, dir: false, owner: APP_USER }))
        if (storage.uploadsDir) list.push(folder('uploads', APP_USER))
        const since = this.deps.rootSince()
        if (since !== null) list.push({ name: 'kano_root_shell.sock', size: 0, mtime: since, dir: false, owner: 'root' })
        return list
      }
      case '/sdcard': {
        const files = [...storage.sdcard]
          .filter(([path]) => path.lastIndexOf('/') === '/sdcard'.length)
          .map(([path, text]) => ({ name: basename(path), size: Buffer.byteLength(text), mtime: this.mtimes.get(path) ?? BOOT_AT, dir: false, owner: 'root' }))
        return [folder('Android'), folder('DCIM'), folder('Download'), ...files]
      }
      case '/data/data/com.minikano.f50_sms':
        return ['cache', 'files', 'shared_prefs'].map((name) => folder(name, APP_USER))
      case '/':
        return ['acct', 'apex', 'cache', 'config', 'data', 'dev', 'etc', 'mnt', 'odm', 'proc', 'product', 'sdcard', 'storage', 'sys', 'system', 'vendor'].map((name) => folder(name))
      default:
        return null
    }
  }

  private cat(files: string[], ctx: Ctx, stdin: string | null, name: string): Step {
    if (!files.length || (files.length === 1 && files[0] === '-')) return done(stdin ?? '')
    let out = ''
    let err = ''
    for (const file of files) {
      const path = this.resolve(file, ctx)
      const text = this.read(path)
      if (text !== undefined) out += text
      else err += `${name}: ${file}: ${this.entries(path) ? 'Is a directory' : 'No such file or directory'}\n`
    }
    return { out, err, wait: 0, status: err ? 1 : 0 }
  }

  /* —— 命令 —— */

  private exec(argv: string[], ctx: Ctx, stdin: string | null): Step {
    const [path = '', ...rest] = argv
    const cmd = basename(path)
    const flags = new Set<string>()
    const operands: string[] = []
    for (const arg of rest) {
      if (/^-[A-Za-z]+$/.test(arg)) for (const ch of arg.slice(1)) flags.add(ch)
      else operands.push(arg)
    }

    switch (cmd) {
      case 'timeout': {
        let i = 0
        while (rest[i]?.startsWith('-')) i += rest[i] === '-s' || rest[i] === '-k' ? 2 : 1
        const limit = duration(rest[i] ?? '0')
        const result = this.exec(rest.slice(i + 1), ctx, stdin)
        return result.wait > limit ? { ...result, wait: limit, status: 124 } : result
      }
      case 'nohup':
      case 'busybox':
      case 'toybox':
      case 'nice':
        return rest.length ? this.exec(rest, ctx, stdin) : done()
      case 'whoami':
        return done(ctx.root ? 'root\n' : `${APP_USER}\n`)
      case 'id':
        return done(
          ctx.root
            ? 'uid=0(root) gid=0(root) groups=0(root) context=u:r:su:s0\n'
            : `uid=10103(${APP_USER}) gid=10103(${APP_USER}) groups=10103(${APP_USER}),3003(inet),9997(everybody) context=u:r:untrusted_app:s0:c103,c256,c512,c768\n`,
        )
      case 'hostname':
        return done('localhost\n')
      case 'true':
      case ':':
        return done()
      case 'false':
        return done('', 1)
      case 'echo': {
        let i = 0
        let newline = true
        let escape = false
        for (; /^-[neE]+$/.test(rest[i] ?? ''); i += 1) {
          if (rest[i].includes('n')) newline = false
          if (rest[i].includes('e')) escape = true
        }
        const text = rest.slice(i).join(' ')
        return done((escape ? escapes(text) : text) + (newline ? '\n' : ''))
      }
      case 'printf': {
        const [format = '', ...values] = rest
        let out = ''
        let index = 0
        do {
          out += escapes(format).replace(/%([sdc%])/g, (_all, f: string) => {
            if (f === '%') return '%'
            const value = values[index++] ?? ''
            return f === 'd' ? String(Math.trunc(Number(value)) || 0) : value
          })
        } while (index < values.length && /%[sdc]/.test(format))
        return done(out)
      }
      case 'sleep':
        return { ...done(), wait: duration(rest[0] ?? '0') }
      case 'cd': {
        const target = this.resolve(rest[0] ?? (ctx.vars.get('HOME') || '/'), ctx)
        if (!this.entries(target) && !['/data', '/system', '/vendor', '/proc', '/dev', '/cache'].includes(target)) return fail(`sh: cd: ${rest[0]}: No such file or directory`, 2)
        ctx.cwd = target
        return done()
      }
      case 'pwd':
        return done(`${ctx.cwd}\n`)
      case 'export':
        for (const arg of rest) if (arg.includes('=')) ctx.vars.set(arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1))
        return done()
      case 'unset':
        for (const name of rest) ctx.vars.delete(name)
        return done()
      case 'read': {
        const line = lines(stdin ?? '')[0]
        if (line === undefined) return done('', 1)
        this.assignRead(operands, line, ctx)
        return done()
      }
      case 'exit':
        ctx.exited = true
        return done('', Number(rest[0] ?? ctx.status) || 0)
      case 'test':
      case '[':
        return done('', this.test(cmd === '[' && rest[rest.length - 1] === ']' ? rest.slice(0, -1) : rest, ctx) ? 0 : 1)
      case 'cat':
      case 'more':
        return this.cat(operands, ctx, stdin, cmd)
      case 'awk':
        return this.awk(rest, ctx, stdin)
      case 'head':
      case 'tail':
        return this.headTail(cmd, rest, ctx, stdin)
      case 'grep':
      case 'egrep':
      case 'fgrep':
        return this.grep(cmd, rest, ctx, stdin)
      case 'wc': {
        const source = this.cat(operands, ctx, stdin, 'wc')
        const counts: Record<string, number> = {
          l: (source.out.match(/\n/g) ?? []).length,
          w: source.out.split(/\s+/).filter(Boolean).length,
          c: Buffer.byteLength(source.out),
        }
        const picked = ['l', 'w', 'c'].filter((f) => flags.has(f))
        const text = (picked.length ? picked : ['l', 'w', 'c']).map((f) => counts[f]).join(' ')
        return { ...source, out: `${text}${operands[0] ? ` ${operands[0]}` : ''}\n` }
      }
      case 'sed':
        return this.sed(rest, ctx, stdin)
      case 'sort': {
        const source = this.cat(operands, ctx, stdin, 'sort')
        let list = lines(source.out).sort(flags.has('n') ? (a, b) => Number.parseFloat(a) - Number.parseFloat(b) : undefined)
        if (flags.has('r')) list.reverse()
        if (flags.has('u')) list = [...new Set(list)]
        return { ...source, out: joinLines(list) }
      }
      case 'uniq': {
        const source = this.cat(operands, ctx, stdin, 'uniq')
        return { ...source, out: joinLines(lines(source.out).filter((line, i, all) => i === 0 || all[i - 1] !== line)) }
      }
      case 'cut': {
        let delimiter = '\t'
        let fields: number[] = []
        const files: string[] = []
        for (let i = 0; i < rest.length; i += 1) {
          const arg = rest[i]
          if (arg.startsWith('-d')) delimiter = arg.length > 2 ? arg.slice(2) : (rest[++i] ?? '\t')
          else if (arg.startsWith('-f')) fields = (arg.length > 2 ? arg.slice(2) : (rest[++i] ?? '')).split(',').map(Number)
          else files.push(arg)
        }
        const source = this.cat(files, ctx, stdin, 'cut')
        return { ...source, out: joinLines(lines(source.out).map((line) => fields.map((f) => line.split(delimiter)[f - 1] ?? '').join(delimiter))) }
      }
      case 'basename':
        return done(`${basename(rest[0] ?? '')}\n`)
      case 'dirname': {
        const target = (rest[0] ?? '.').replace(/\/+$/, '')
        return done(`${target.includes('/') ? target.slice(0, target.lastIndexOf('/')) || '/' : '.'}\n`)
      }
      case 'ls':
        return this.ls(operands, flags.has('l'), ctx)
      case 'mkdir':
        for (const target of operands) {
          if (this.resolve(target, ctx) !== UPLOADS) continue
          if (this.deps.storage.uploadsDir && !flags.has('p')) return fail(`mkdir: '${target}': File exists`)
          this.deps.storage.uploadsDir = true
        }
        return done()
      case 'touch':
        for (const target of operands) {
          const file = this.resolve(target, ctx)
          if (this.file(file) === undefined) this.write(file, '', false)
        }
        return done()
      case 'rm': {
        let err = ''
        for (const target of operands) {
          const file = this.resolve(target, ctx)
          if (this.entries(file)) {
            if (!flags.has('r') && !flags.has('R')) err += `rm: ${target}: is a directory\n`
            else if (file === UPLOADS) {
              this.deps.storage.uploads.clear()
              this.deps.storage.uploadsDir = false
            }
          } else if (!this.remove(file) && !flags.has('f')) {
            err += `rm: ${target}: No such file or directory\n`
          }
        }
        return { out: '', err, wait: 0, status: err ? 1 : 0 }
      }
      case 'mv':
      case 'cp': {
        if (operands.length < 2) return fail(`${cmd}: Needs 2 arguments`)
        const source = operands[0]
        const from = this.resolve(source, ctx)
        const data = this.file(from)
        if (!data) return fail(`${cmd}: bad '${source}': No such file or directory`)
        let to = this.resolve(operands[operands.length - 1], ctx)
        if (this.entries(to)) to = `${to}/${basename(from)}`
        const original = from.startsWith(`${UPLOADS}/`) ? this.deps.storage.uploads.get(from.slice(UPLOADS.length + 1))?.original : undefined
        this.write(to, data, false, original)
        if (cmd === 'mv' && from !== to) this.remove(from)
        return done()
      }
      case 'dd': {
        const opts = new Map(rest.filter((arg) => arg.includes('=')).map((arg) => [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)]))
        const input = opts.get('if') ?? ''
        if (!/^\/dev\/block\/by-name\/boot(_[ab])?$/.test(input)) return fail(`dd: ${input}: No such file or directory`)
        if (!ctx.root) return fail(`dd: ${input}: Permission denied`)
        // 假的 boot 镜像：开头是 Android boot image 的魔数；dd 的统计写在 stderr
        const image = Buffer.alloc(4 * 1024 * 1024)
        image.write('ANDROID!', 0, 'ascii')
        const output = opts.get('of')
        if (output) this.write(this.resolve(output, ctx), image, false)
        const records = Math.ceil(image.length / (Number(opts.get('bs')) || 512))
        return { out: '', err: `${records}+0 records in\n${records}+0 records out\n${image.length} bytes (4.0 M) copied, 0.092 s, 43 M/s\n`, wait: 400, status: 0 }
      }
      case 'getprop': {
        const { model, crVersion } = this.deps.identity()
        const props: Record<string, string> = {
          'persist.sys.timezone': 'Asia/Shanghai',
          'ro.boot.slot_suffix': '_a',
          'ro.build.display.id': crVersion,
          'ro.product.brand': 'ZTE',
          'ro.product.model': model,
          'service.adb.tcp.port': '5555',
        }
        if (rest[0]) return done(`${props[rest[0]] ?? ''}\n`)
        return done(joinLines(Object.entries(props).map(([key, value]) => `[${key}]: [${value}]`)))
      }
      case 'getenforce':
        return done('Permissive\n')
      case 'uname':
        if (flags.has('a')) return done('Linux localhost 5.4.210-android12-9 #1 SMP PREEMPT Wed Mar 5 10:21:33 CST 2025 aarch64 Toybox\n')
        return done(flags.has('r') ? '5.4.210-android12-9\n' : flags.has('m') ? 'aarch64\n' : 'Linux\n')
      case 'date': {
        const format = rest.find((arg) => arg.startsWith('+'))
        return done(`${format ? strftime(format.slice(1)) : shellDate()}\n`)
      }
      case 'uptime':
        return done(`${this.uptime()}\n`)
      case 'df':
        return done(DF)
      case 'free':
        return done(FREE)
      case 'ps':
        return done(this.ps(ctx.root, flags.has('f')))
      case 'top':
        // 不带 -n 会一直刷新
        return rest.includes('-n') || flags.has('n') ? done(this.top(ctx.root)) : { ...done(), wait: Infinity }
      case 'pidof': {
        const pids = this.processes(ctx.root)
          .filter((p) => operands.includes(p.name))
          .map((p) => p.pid)
        return pids.length ? done(`${pids.join(' ')}\n`) : done('', 1)
      }
      case 'pgrep': {
        const pattern = operands[0] ?? ''
        const hits = this.processes(ctx.root).filter((p) => (flags.has('f') ? p.cmdline : p.name).includes(pattern))
        return hits.length ? done(joinLines(hits.map((p) => (flags.has('l') ? `${p.pid} ${p.name}` : String(p.pid))))) : done('', 1)
      }
      case 'pm':
        return this.pm(rest, ctx.root)
      case 'am':
        if (rest[0] === 'start' || rest[0] === 'start-activity') return done(`Starting: Intent { cmp=${rest[rest.indexOf('-n') + 1] ?? ''} }\n`)
        return done()
      case 'iptables':
      case 'ip6tables':
        if (!ctx.root) {
          return fail(`${cmd} v1.8.7 (legacy): can't initialize ${cmd} table \`filter': Permission denied (you must be root)\nPerhaps ${cmd} or your kernel needs to be upgraded.`, 3)
        }
        return this.iptables(cmd === 'ip6tables' ? 'v6' : 'v4', rest)
      case 'iptables-save':
      case 'ip6tables-save': {
        if (!ctx.root) return fail(`${cmd}: Permission denied`)
        const table = rest.includes('-t') ? (rest[rest.indexOf('-t') + 1] ?? 'filter') : 'filter'
        return done(this.save(cmd === 'ip6tables-save' ? 'v6' : 'v4', table))
      }
      case 'imei_reader': {
        // 走 DIAG 通道，需要 root
        if (!ctx.root) return fail('open diag failed: Permission denied')
        const { imei } = this.deps.identity()
        return done(`IMEI1:${imei}\nIMEI2:${imei.replace(/\d$/, (d) => String((Number(d) + 1) % 10))}\n`)
      }
      case 'logcat': {
        if (flags.has('c')) return done()
        if (!flags.has('d') && !rest.includes('-t')) return { ...done(), wait: Infinity }
        const all = this.logcat(rest.includes('time'))
        const count = rest.includes('-t') ? Number(rest[rest.indexOf('-t') + 1]) || all.length : all.length
        return done(joinLines(all.slice(-count)))
      }
      case 'sh': {
        const c = rest.indexOf('-c')
        const script = c !== -1 ? (rest[c + 1] ?? '') : rest[0] ? this.read(this.resolve(rest[0], ctx)) : (stdin ?? '')
        if (script === undefined) return fail(`sh: ${rest[0]}: No such file or directory`, 127)
        if (ctx.depth > 16) return done()
        return this.node(parse(script), { ...ctx, vars: new Map(ctx.vars), exited: false, depth: ctx.depth + 1 }, stdin)
      }
      case 'reboot':
        if (!ctx.root) return fail('reboot: Operation not permitted')
        this.deps.reboot()
        return done()
      default:
        // chmod / chown / chattr / sync / setprop / settings / kill / svc …… 以及不认识的命令：没有输出
        return done()
    }
  }

  private test(args: string[], ctx: Ctx): boolean {
    if (args[0] === '!') return !this.test(args.slice(1), ctx)
    if (args.length <= 1) return Boolean(args[0])
    if (args.length === 2) {
      const [flag, value] = args
      if (flag === '-n') return value !== ''
      if (flag === '-z') return value === ''
      const path = this.resolve(value, ctx)
      if (flag === '-d') return this.entries(path) !== null
      if (flag === '-s') return (this.file(path)?.length ?? 0) > 0
      if (flag === '-e') return this.file(path) !== undefined || this.entries(path) !== null
      return this.file(path) !== undefined
    }
    const [a, operator, b] = args
    const x = Number(a)
    const y = Number(b)
    const result: Record<string, boolean> = { '=': a === b, '==': a === b, '!=': a !== b, '-eq': x === y, '-ne': x !== y, '-gt': x > y, '-ge': x >= y, '-lt': x < y, '-le': x <= y }
    return result[operator] ?? false
  }

  private ls(targets: string[], long: boolean, ctx: Ctx): Step {
    const row = (entry: Entry) => {
      const group = entry.owner === APP_USER ? APP_USER : entry.owner === 'root' && !entry.dir ? 'everybody' : 'root'
      return `${entry.dir ? 'drwxrwx--x' : '-rw-rw----'} ${entry.dir ? 2 : 1} ${entry.owner} ${group} ${pad(entry.size, 8)} ${deviceStamp(entry.mtime)} ${entry.name}\n`
    }
    let out = ''
    let err = ''
    for (const target of targets.length ? targets : ['.']) {
      const path = this.resolve(target, ctx)
      const list = this.entries(path)
      if (list) {
        const sorted = [...list].sort((a, b) => a.name.localeCompare(b.name))
        if (!long) out += sorted.map((entry) => `${entry.name}\n`).join('')
        else out += `total ${sorted.reduce((sum, entry) => sum + Math.ceil(entry.size / 4096) * 4, 0)}\n${sorted.map(row).join('')}`
        continue
      }
      const data = this.file(path)
      if (!data) err += `ls: ${target}: No such file or directory\n`
      else if (!long) out += `${target}\n`
      else {
        const upload = path.startsWith(`${UPLOADS}/`) ? this.deps.storage.uploads.get(path.slice(UPLOADS.length + 1)) : undefined
        out += row({ name: target, size: data.length, mtime: upload?.mtime ?? this.mtimes.get(path) ?? BOOT_AT, dir: false, owner: upload ? APP_USER : 'root' })
      }
    }
    return { out, err, wait: 0, status: err ? 1 : 0 }
  }

  private headTail(cmd: string, args: string[], ctx: Ctx, stdin: string | null): Step {
    let count = 10
    let from = 0
    let follow = false
    const files: string[] = []
    for (let i = 0; i < args.length; i += 1) {
      const arg = args[i]
      const value = arg === '-n' ? (args[++i] ?? '10') : /^-n.+/.test(arg) ? arg.slice(2) : /^-\d+$/.test(arg) ? arg.slice(1) : null
      if (value !== null) {
        if (value.startsWith('+')) from = Number(value.slice(1)) || 1
        else count = Number.parseInt(value, 10)
      } else if (arg === '-f' || arg === '-F') follow = true
      else if (!arg.startsWith('-')) files.push(arg)
    }
    const source = this.cat(files, ctx, stdin, cmd)
    const all = lines(source.out)
    const picked = from ? all.slice(from - 1) : !(count > 0) ? [] : cmd === 'head' ? all.slice(0, count) : all.slice(-count)
    return { ...source, out: joinLines(picked), wait: follow ? Infinity : 0 }
  }

  private grep(cmd: string, args: string[], ctx: Ctx, stdin: string | null): Step {
    const flags = new Set<string>(cmd === 'egrep' ? ['E'] : cmd === 'fgrep' ? ['F'] : [])
    let pattern: string | undefined
    let i = 0
    for (; i < args.length; i += 1) {
      const arg = args[i]
      if (arg === '--') {
        i += 1
        break
      }
      if (arg === '-e') pattern = args[++i]
      else if (/^-[a-zA-Z]+$/.test(arg)) for (const flag of arg.slice(1)) flags.add(flag)
      else break
    }
    const files = args.slice(i)
    const needle = pattern ?? files.shift() ?? ''
    let test: (line: string) => boolean
    if (flags.has('F')) {
      const wanted = flags.has('i') ? needle.toLowerCase() : needle
      test = (line) => {
        const text = flags.has('i') ? line.toLowerCase() : line
        return flags.has('x') ? text === wanted : text.includes(wanted)
      }
    } else {
      let re: RegExp
      try {
        const source = flags.has('E') ? needle : bre(needle)
        re = new RegExp(flags.has('x') ? `^(?:${source})$` : source, flags.has('i') ? 'i' : '')
      } catch {
        return fail(`grep: bad regex '${needle}'`, 2)
      }
      test = (line) => re.test(line)
    }
    const source = this.cat(files, ctx, stdin, 'grep')
    const hits = lines(source.out)
      .map((line, n) => ({ line, n: n + 1 }))
      .filter(({ line }) => test(line) !== flags.has('v'))
    const out = flags.has('q') ? '' : flags.has('c') ? `${hits.length}\n` : joinLines(hits.map(({ line, n }) => (flags.has('n') ? `${n}:${line}` : line)))
    return { out, err: source.err, wait: 0, status: hits.length ? 0 : source.err ? 2 : 1 }
  }

  /** 只支持 /正则/d（删行）与 s/旧/新/[g]（\1 与 & 引用）；-i 就地修改 */
  private sed(args: string[], ctx: Ctx, stdin: string | null): Step {
    const inPlace = args.includes('-i')
    const [script = '', ...files] = args.filter((arg) => arg !== '-i' && arg !== '-e')
    let transform = (text: string) => text
    try {
      const del = /^\/(.*)\/d$/.exec(script)
      const sub = /^s(.)(.*?)\1(.*?)\1(g?)$/.exec(script)
      if (del) {
        const re = new RegExp(bre(del[1]))
        transform = (text) => joinLines(lines(text).filter((line) => !re.test(line)))
      } else if (sub) {
        const re = new RegExp(bre(sub[2]), sub[4] ? 'g' : '')
        const replace = (match: string, groups: unknown[]) =>
          sub[3].replace(/\\(\d)|\\(.)|&/g, (_all, digit?: string, ch?: string) => (digit !== undefined ? String(groups[Number(digit) - 1] ?? '') : (ch ?? match)))
        transform = (text) => joinLines(lines(text).map((line) => line.replace(re, (match: string, ...groups: unknown[]) => replace(match, groups))))
      }
    } catch {
      return fail(`sed: bad regex '${script}'`)
    }
    if (!inPlace) {
      const source = this.cat(files, ctx, stdin, 'sed')
      return { ...source, out: transform(source.out) }
    }
    for (const file of files) {
      const path = this.resolve(file, ctx)
      const text = this.read(path)
      if (text === undefined) return fail(`sed: ${file}: No such file or directory`)
      this.write(path, transform(text), false)
    }
    return done()
  }

  /** awk '{print}' / '{print $1,$3}' [-F 分隔符] */
  private awk(args: string[], ctx: Ctx, stdin: string | null): Step {
    let separator: string | null = null
    let i = 0
    for (; i < args.length; i += 1) {
      if (args[i] === '-F') separator = args[++i] ?? ' '
      else if (args[i].startsWith('-F')) separator = args[i].slice(2)
      else break
    }
    const print = /^\s*\{\s*print\s*(.*?)\s*;?\s*\}\s*$/.exec(args[i] ?? '')
    const source = this.cat(args.slice(i + 1), ctx, stdin, 'awk')
    if (!print) return { ...source, out: '' }
    const fields = print[1] ? print[1].split(/\s*,\s*/) : ['$0']
    const out = lines(source.out).map((line) => {
      const parts = separator ? line.split(separator) : line.trim().split(/\s+/)
      return fields
        .map((field) => {
          if (field === '$0') return line
          if (field === '$NF') return parts[parts.length - 1] ?? ''
          if (/^\$\d+$/.test(field)) return parts[Number(field.slice(1)) - 1] ?? ''
          return field.replace(/^"|"$/g, '')
        })
        .join(' ')
    })
    return { ...source, out: joinLines(out) }
  }

  /* —— 系统信息 —— */

  private uptime(): string {
    const up = Math.floor((Date.now() - this.bootAt) / 1000)
    const clock = new Date(Date.now() + DEVICE_TZ).toISOString().slice(11, 19)
    const days = Math.floor(up / 86_400)
    const hours = Math.floor((up % 86_400) / 3_600)
    const minutes = String(Math.floor((up % 3_600) / 60)).padStart(2, '0')
    const load = (base: number) => (base + Math.random() * 0.3).toFixed(2)
    return ` ${clock} up ${days} day${days === 1 ? '' : 's'}, ${pad(hours, 2)}:${minutes},  0 users,  load average: ${load(0.62)}, ${load(0.55)}, ${load(0.48)}`
  }

  private processes(root: boolean): Proc[] {
    const list: Proc[] = [
      { user: 'root', pid: 1, ppid: 0, rss: 9452, name: 'init', cmdline: '/system/bin/init second_stage' },
      { user: 'root', pid: 389, ppid: 1, rss: 3504, name: 'ueventd', cmdline: '/system/bin/ueventd' },
      { user: 'logd', pid: 612, ppid: 1, rss: 8160, name: 'logd', cmdline: '/system/bin/logd' },
      { user: 'root', pid: 613, ppid: 1, rss: 108044, name: 'zygote64', cmdline: 'zygote64' },
      { user: 'shell', pid: 1043, ppid: 1, rss: 6024, name: 'adbd', cmdline: '/apex/com.android.adbd/bin/adbd --root_seclabel=u:r:su:s0' },
      { user: 'system', pid: 1127, ppid: 613, rss: 189460, name: 'system_server', cmdline: 'system_server' },
      { user: 'radio', pid: 1689, ppid: 613, rss: 80336, name: 'com.android.phone', cmdline: 'com.android.phone' },
      { user: APP_USER, pid: 2241, ppid: 613, rss: 141292, name: 'com.minikano.f50_sms', cmdline: 'com.minikano.f50_sms' },
      { user: APP_USER, pid: 2290, ppid: 1, rss: 3208, name: 'iperf3', cmdline: `${FILES}/iperf3 -s -D` },
      { user: 'root', pid: 2731, ppid: 1, rss: 9644, name: 'smbd', cmdline: '/system/bin/smbd -D' },
    ]
    if (this.deps.rootSince() !== null) {
      list.push(
        { user: 'root', pid: 3002, ppid: 2731, rss: 3740, name: 'ttyd', cmdline: `${FILES}/ttyd --writable --port 1146 ${FILES}/login.sh` },
        { user: 'root', pid: 3004, ppid: 1, rss: 2856, name: 'socat', cmdline: `${FILES}/socat -d -d UNIX-LISTEN:${FILES}/kano_root_shell.sock,fork,reuseaddr,unlink-early EXEC:/system/bin/sh` },
        { user: 'root', pid: GUARD_PID, ppid: 1, rss: 2416, name: 'sh', cmdline: `sh ${FILES}/ufi_keep_alive.sh` },
      )
    }
    list.push({ user: root ? 'root' : APP_USER, pid: 31_204, ppid: root ? 3004 : 2241, rss: 2932, name: 'ps', cmdline: 'ps -A' })
    // 普通应用只看得到自己的进程（hidepid）
    return list.filter((p) => root || p.user === APP_USER)
  }

  private ps(root: boolean, full: boolean): string {
    const list = this.processes(root)
    if (full) {
      return joinLines([
        'UID            PID  PPID C STIME TTY          TIME CMD',
        ...list.map((p) => `${pad(p.user, 12, true)}${pad(p.pid, 6)}${pad(p.ppid, 6)} 0 ${p.pid < 3000 ? 'Oct26' : strftime('%H:%M')} ?     00:00:${String(p.rss % 60).padStart(2, '0')} ${p.cmdline}`),
      ])
    }
    return joinLines([
      'USER           PID  PPID     VSZ    RSS WCHAN            ADDR S NAME',
      ...list.map(
        (p) =>
          `${pad(p.user, 12, true)}${pad(p.pid, 6)}${pad(p.ppid, 6)}${pad(10_845_320 + p.rss * 37, 9)}${pad(p.rss, 7)} ${pad(p.name === 'ps' ? '0' : 'do_epoll_wait', 16, true)}${pad(0, 5)} ${p.name === 'ps' ? 'R' : 'S'} ${p.name}`,
      ),
    ])
  }

  private top(root: boolean): string {
    const list = this.processes(root)
    const cpu = (p: Proc) => (p.name === 'com.minikano.f50_sms' ? 4.3 : p.name === 'system_server' ? 1.7 : p.name === 'ps' ? 1 : 0).toFixed(1)
    return joinLines([
      'Tasks: 312 total,   1 running, 311 sleeping,   0 stopped,   0 zombie',
      '  Mem:  1502956K total,  1341092K used,   161864K free,    10712K buffers',
      ' Swap:   931830K total,   574771K used,   357059K free,   612032K cached',
      '800%cpu   6%user   0%nice   9%sys 785%idle   0%iow   0%irq   0%sirq   0%host',
      '  PID USER         PR  NI VIRT  RES  SHR S[%CPU] %MEM     TIME+ ARGS',
      ...list.map((p) => {
        const mem = `${pad(`${(p.rss / 1024 + 900).toFixed(0)}M`, 5)} ${pad(`${(p.rss / 1024).toFixed(1)}M`, 6)} ${pad(`${(p.rss / 2048).toFixed(1)}M`, 6)}`
        const time = `0:${String(p.pid % 60).padStart(2, '0')}.${String(p.rss % 100).padStart(2, '0')}`
        return `${pad(p.pid, 5)} ${pad(p.user, 12, true)} 20   0 ${mem} ${p.name === 'ps' ? 'R' : 'S'} ${pad(cpu(p), 5)} ${pad(((p.rss / 1_502_956) * 100).toFixed(1), 5)}   ${time} ${p.name === 'ps' ? 'top -b -n 1' : p.cmdline}`
      }),
    ])
  }

  private pm(args: string[], root: boolean): Step {
    const [sub = ''] = args
    const pkg = args[args.length - 1] ?? ''
    if (sub === 'list' && args[1] === 'packages') return done(joinLines(PACKAGES.filter((name) => !this.removed.has(name)).map((name) => `package:${name}`)))
    if (!['disable', 'disable-user', 'enable', 'uninstall'].includes(sub)) return done()
    if (!root) {
      return fail(`Exception occurred while executing '${sub}':\njava.lang.SecurityException: Permission Denial: attempt to change component state from pid=31204, uid=10103, package uid=1000`, 255)
    }
    if (sub === 'uninstall') {
      if (this.removed.has(pkg) || !PACKAGES.includes(pkg)) return done('Failure [not installed for 0]\n', 1)
      this.removed.add(pkg)
      return done('Success\n')
    }
    if (this.removed.has(pkg) || !PACKAGES.includes(pkg)) return fail(`Exception occurred while executing '${sub}':\njava.lang.IllegalArgumentException: Unknown package: ${pkg}`, 255)
    return done(`Package ${pkg} new state: ${sub === 'enable' ? 'enabled' : sub === 'disable' ? 'disabled' : 'disabled-user'}\n`)
  }

  /* —— iptables（只模拟 filter 表的 INPUT 链，其它链 / 表只当执行成功） —— */

  private iptables(family: 'v4' | 'v6', args: string[]): Step {
    const bin = family === 'v6' ? 'ip6tables' : 'iptables'
    const value = (...names: string[]) => {
      const index = args.findIndex((arg) => names.includes(arg))
      return index === -1 ? undefined : args[index + 1]
    }
    const table = value('-t', '--table') ?? 'filter'
    if (args.some((arg) => arg === '-S' || arg === '--list-rules')) {
      const chain = value('-S', '--list-rules')
      return done(table === 'filter' ? this.rules(family, chain?.startsWith('-') ? undefined : chain) : '')
    }
    if (args.some((arg) => arg === '-L' || arg === '--list' || /^-[nv]*L[nv]*$/.test(arg))) return done(table === 'filter' ? this.listing(family) : '')
    if (args.some((arg) => arg === '-F' || arg === '--flush')) {
      const chain = value('-F', '--flush')
      if (table === 'filter' && (!chain || chain.startsWith('-') || chain === 'INPUT')) this.input[family] = []
      return done()
    }
    const action = args.find((arg) => ['-A', '-I', '-D', '-C', '--append', '--insert', '--delete', '--check'].includes(arg))
    if (!action) return done()
    const chain = value(action)
    if (table !== 'filter' || chain !== 'INPUT') return done()
    const spec = canonical(args)
    const list = this.input[family]
    const index = list.indexOf(spec)
    const missing = fail(`${bin}: Bad rule (does a matching rule exist in that chain?).`)
    switch (action) {
      case '-D':
      case '--delete':
        if (index === -1) return missing
        list.splice(index, 1)
        return done()
      case '-C':
      case '--check':
        return index === -1 ? missing : done()
      case '-I':
      case '--insert': {
        const position = Number(args[args.indexOf(action) + 2])
        list.splice(Number.isInteger(position) && position > 0 ? position - 1 : 0, 0, spec)
        return done()
      }
      default:
        list.push(spec)
        return done()
    }
  }

  /** iptables -S [链] */
  private rules(family: 'v4' | 'v6', chain?: string): string {
    if (chain && chain !== 'INPUT') return `-P ${chain} ACCEPT\n`
    const head = chain ? ['-P INPUT ACCEPT'] : ['-P INPUT ACCEPT', '-P FORWARD ACCEPT', '-P OUTPUT ACCEPT', '-N bw_INPUT', '-N fw_INPUT']
    return joinLines([...head, ...this.input[family].map((rule) => `-A INPUT ${rule}`)])
  }

  /** iptables -L [-n] */
  private listing(family: 'v4' | 'v6'): string {
    const any = family === 'v6' ? '::/0' : '0.0.0.0/0'
    const rows = this.input[family].map((rule) => {
      const target = /-j (\S+)/.exec(rule)?.[1] ?? ''
      const proto = /-p (\S+)/.exec(rule)?.[1] ?? 'all'
      const port = /--dport (\d+)/.exec(rule)?.[1]
      return `${pad(target, 10, true)} ${pad(proto, 4, true)} ${family === 'v6' ? '  ' : '--'}  ${pad(any, 20, true)} ${pad(any, 20, true)}${port ? ` ${proto} dpt:${port}` : ''}`
    })
    const header = 'target     prot opt source               destination'
    return joinLines(['Chain INPUT (policy ACCEPT)', header, ...rows, '', 'Chain FORWARD (policy ACCEPT)', header, '', 'Chain OUTPUT (policy ACCEPT)', header])
  }

  /** iptables-save [-t 表] */
  private save(family: 'v4' | 'v6', table: string): string {
    const chains: Record<string, string[]> = {
      filter: ['INPUT', 'FORWARD', 'OUTPUT'],
      nat: ['PREROUTING', 'INPUT', 'OUTPUT', 'POSTROUTING'],
      mangle: ['PREROUTING', 'INPUT', 'FORWARD', 'OUTPUT', 'POSTROUTING'],
      raw: ['PREROUTING', 'OUTPUT'],
      security: ['INPUT', 'FORWARD', 'OUTPUT'],
    }
    if (!chains[table]) return ''
    const stamp = shellDate().replace(' CST', '')
    return joinLines([
      `# Generated by ${family === 'v6' ? 'ip6tables' : 'iptables'}-save v1.8.7 on ${stamp}`,
      `*${table}`,
      ...chains[table].map((chain) => `:${chain} ACCEPT [0:0]`),
      ...(table === 'filter' ? [':bw_INPUT - [0:0]', ':fw_INPUT - [0:0]', ...this.input[family].map((rule) => `-A INPUT ${rule}`)] : []),
      'COMMIT',
      `# Completed on ${stamp}`,
    ])
  }

  /* —— 日志 —— */

  /** samba_exec.sh 每 30 s 跑一轮（高级功能开着时）：把这段时间该写的日志补上 */
  private syncLogs() {
    const since = this.deps.rootSince()
    if (since === null) return
    const { sdcard } = this.deps.storage
    const now = Date.now()
    let at = Math.max(since, this.lastRound + 30_000)
    if (at > now) return
    // 很久没看：只补最近 200 轮
    if (now - at > 200 * 30_000) at += Math.floor((now - at) / 30_000 - 200) * 30_000
    let log = sdcard.get(SMB_LOG) ?? ''
    for (; at <= now; at += 30_000) {
      log += this.round(at, since, this.bootAt, this.flagBoot)
      if (at === since) sdcard.set(KEEP_ALIVE_LOG, `${sdcard.get(KEEP_ALIVE_LOG) ?? ''}[${shellDate(at + 300)}] UFI-TOOLS keep-alive started, pid=${GUARD_PID}\n`)
      this.lastRound = at
    }
    sdcard.set(SMB_LOG, log)
    this.mtimes.set(SMB_LOG, this.lastRound)
  }

  /** samba_exec.sh 一轮（开机窗口之外：schedule_script）写的日志 */
  private round(at: number, since: number, boot: number, lastBoot: number): string {
    const stamp = `[${shellDate(at)}]`
    const out = [
      `${stamp} samba_exec.sh start running...`,
      `${stamp} uptime_seconds=${Math.floor((at - boot) / 1000)}, now_ts=${Math.floor(at / 1000)}, boot_time=${Math.floor(boot / 1000)}, last_boot_time=${Math.floor(lastBoot / 1000)}`,
      ...(at - boot < 120_000
        ? [`${stamp} boot window (<120s) detected.`, `${stamp} same boot_time detected, skipping boot_up_script. Running schedule_script instead...`]
        : [`${stamp} outside boot window (>120s), running schedule_script...`]),
      `${stamp} starting UFI-TOOLS keep-alive...`,
    ]
    if (at === since) out.push(`${stamp} start ttyd...`, `${stamp} start socat...`)
    out.push(
      `${stamp} ------SOCAT_CLEANER_START!!------`,
      `found pid=3004 ppid=1 age=${Math.max(0, Math.floor((at - since) / 1000))}s child=0`,
      'count=1 oldest=3004 newest=3004 newest_child=',
      'count_after_expired=1',
      `${stamp} ------SOCAT_CLEANER_END!!------`,
    )
    return joinLines(out)
  }

  /** logcat：App 身份只看得到自己的日志 */
  private logcat(timeFormat: boolean): string[] {
    const entries: [number, string, string, string][] = [
      [41_200, 'D', 'UFI_TOOLS_LOG_TaskScheduler', '定时轮询触发 reschedule() 更新'],
      [41_180, 'D', 'UFI_TOOLS_LOG_TaskScheduler', '下一任务时间：03:00'],
      [30_050, 'D', '[UFI_TOOLS]_SmbThrottledRunner', '访问 smb://192.168.0.1/internal_storage/ 成功'],
      [16_400, 'D', '[UFI_TOOLS]_ADBService', 'adb 已就绪：localhost:5555'],
      [8_020, 'D', '[UFI_TOOLS]_SmsPoll', '没有新短信'],
      [1_210, 'D', '[UFI_TOOLS]_baseDeviceInfoModule', 'baseDeviceInfo 请求完成'],
    ]
    return entries.map(([ago, level, tag, message]) => {
      const d = new Date(Date.now() - ago + DEVICE_TZ)
      const stamp = `${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')} ${d.toISOString().slice(11, 23)}`
      return timeFormat ? `${stamp} ${level}/${tag}( 2241): ${message}` : `${stamp}  2241  2290 ${level} ${tag}: ${message}`
    })
  }
}
