/**
 * AT 指令的整理与分级（纯函数）。接口行为见 docs/legacy-tools.md §2。
 *
 * 后端把指令用单引号拼进 shell，sendat 又把它放进双引号再 sh -c：
 * 单引号、$、反引号会造成命令注入，换行属于无效输入——这几个字符一律在前端拒绝。
 */

export type AtRisk = 'read' | 'write' | 'danger'

const FORBIDDEN = /['$`\r\n\\]/

/** 第一个不允许出现的字符；没有时为 null */
export function forbiddenAtChar(input: string): string | null {
  const match = FORBIDDEN.exec(input)
  return match ? match[0] : null
}

/** 补全前缀：「+CGSN」→「AT+CGSN」，「cgsn」→「AT+CGSN」；已有 AT 前缀时只把前缀改成大写 */
export function normalizeAt(input: string): string {
  const trimmed = input.trim()
  if (!trimmed) return ''
  if (/^at/i.test(trimmed)) return `AT${trimmed.slice(2)}`
  if (/^[+^&$]/.test(trimmed)) return `AT${trimmed}`
  return `AT+${trimmed}`
}

/** 只读白名单：带 = 但不改任何状态的常用查询 */
const READ_ONLY = [/^AT\+CGEQOSRDP(=\d+)?$/i, /^AT\+SP5GCMDS="get\b/i, /^AT\+SPENGMD=0,6,0$/i]

/** 高危：断网、重启基带、改串号、改拨号参数、锁卡、恢复默认 */
const DANGER = [
  /^AT\+CFUN=/i,
  /^AT\+SFUN=/i,
  /^AT\+SPIMEI=/i,
  /^AT\+EGMR=/i,
  /^AT\+CGDCONT=/i,
  /^AT\+COPS=/i,
  /^AT\+CLCK=/i,
  /^AT\+CPWD=/i,
  /^AT\+CPIN=/i,
  /^AT\+SP5GCMDS="set\b/i,
  /^AT\+SPTESTMODEM=/i,
  /^ATZ\b/i,
  /^AT&F/i,
]

export function classifyAt(command: string): AtRisk {
  const cmd = command.trim()
  // 「?」结尾是查询（含 =? 的取值范围查询），先于高危判断
  if (/\?$/.test(cmd) || READ_ONLY.some((re) => re.test(cmd))) return 'read'
  if (DANGER.some((re) => re.test(cmd))) return 'danger'
  return cmd.includes('=') ? 'write' : 'read'
}

/** 基带层面的失败（HTTP 仍是 200） */
export const isAtError = (result: string) => /(^|\s)ERROR\b|\+CM[ES] ERROR/i.test(result)

/**
 * 后端把多行响应挤成了一行（丢掉了 \r\n）：在每个「+NAME:」前和结尾的 OK / ERROR 前断行，恢复可读性。
 * 引号里的内容（如号码 "+8613…"）没有冒号，不受影响。
 */
export function formatAtOutput(result: string): string {
  return result
    .replace(/\s*(\+[A-Z][A-Z0-9_]*:)/g, '\n$1')
    .replace(/\s+(OK|ERROR)$/, '\n$1')
    .trim()
}

/**
 * 「+SP5GCMDS: "get nr synch_param",44,1 OK」这类响应：去掉引号，取冒号后、OK 前的部分按逗号拆分，
 * 第 3 段为 1 即开启（与后端解析 VoNR 的方法一致；原版用 includes('synch_param,44,1') 在带引号时永远不成立）。
 */
export function parseSynchParam(result: string): boolean | null {
  if (isAtError(result)) return null
  const body = result.replace(/"/g, '').split(':').slice(1).join(':').replace(/\s*OK\s*$/i, '')
  const parts = body.split(',').map((part) => part.trim())
  if (parts.length < 3) return null
  return parts[2] === '1'
}

export const HIGH_RAIL_QUERY = 'AT+SP5GCMDS="get nr synch_param",44'
export const highRailCommand = (enabled: boolean) => `AT+SP5GCMDS="set nr param",35,${enabled ? 1 : 0}`
