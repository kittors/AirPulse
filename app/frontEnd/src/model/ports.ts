/**
 * 端口防护：读回 iptables / ip6tables 的 INPUT 规则，IPv4 与 IPv6 分开看。
 *
 * 高级功能的开机流程（samba_exec.sh）每次开机都会在 IPv6 上 DROP 一批端口（TCP 和 UDP）：
 * 蜂窝网络分到的 IPv6 地址可能公网可达，这些服务（官方后台、Web 终端、Samba、ADB、iperf3）不能暴露出去。
 * 所以界面上的「允许」只针对局域网（IPv4），不解除这些端口的 IPv6 规则；它们也不算用户自己加的端口。
 *
 * 固件自己也带几条 IPv4 规则（真机 iptables -S INPUT）：
 *   -A INPUT -i lo -j ACCEPT
 *   -A INPUT -s 192.168.0.0/24 -p tcp -m tcp --dport 8080 -j ACCEPT   ← 官方后台只放行局域网
 *   -A INPUT -j bw_INPUT / fw_INPUT                                    ← 跳到别的链，不是结论
 *   -A INPUT -p tcp -m tcp --dport 8080 -j DROP                        ← 其余来源（蜂窝侧）丢弃
 *   -A INPUT -p tcp -m tcp --dport 9090 -j DROP / 9999 -j DROP
 * 规则按顺序生效，所以「局域网能不能访问某个端口」要从上往下找第一条对局域网生效的 ACCEPT / DROP，
 * 不能见到 DROP 就算阻止（8080 在局域网里是通的）。这几个端口归固件管：不列成用户端口，也不去删它们的规则。
 */

export const V6_HARDENED_PORTS: ReadonlySet<number> = new Set([8080, 1146, 139, 445, 5555, 5201, 5001, 5002])

/** 固件自带规则的端口（见上） */
export const V4_SYSTEM_PORTS: ReadonlySet<number> = new Set([8080, 9090, 9999])

export interface BlockedPorts {
  /** 局域网（IPv4）访问会被丢弃的 TCP 端口（按规则顺序判断） */
  v4: Set<number>
  /** IPv6 上有 DROP 规则的 TCP 端口 */
  v6: Set<number>
}

const V6_MARK = '__ip6tables__'

/** 一次读回两张表；用标记行把输出分成 IPv4 / IPv6 两段 */
export const BLOCKED_PORTS_CMD = `iptables -S INPUT 2>&1; echo ${V6_MARK}; ip6tables -S INPUT 2>&1`

interface Rule {
  /** ACCEPT / DROP / REJECT；跳到别的链（bw_INPUT 等）时为 null */
  verdict: 'ACCEPT' | 'DROP' | 'REJECT' | null
  proto: string | null
  ports: number[] | null
  source: string | null
  iface: string | null
  /** 带取反或 state / limit 之类的附加条件：是否命中说不准，判断时跳过 */
  conditional: boolean
}

/** 只认 tcp / udp / multiport 这几个匹配模块，其余（state、conntrack、limit……）都算附加条件 */
const PLAIN_MODULES = new Set(['tcp', 'udp', 'multiport'])

function parseRule(line: string): Rule | null {
  const tokens = line.trim().split(/\s+/)
  if (tokens[0] !== '-A' || tokens[1] !== 'INPUT') return null
  const rule: Rule = { verdict: null, proto: null, ports: null, source: null, iface: null, conditional: false }
  for (let i = 2; i < tokens.length; i++) {
    const token = tokens[i]
    const value = tokens[i + 1]
    switch (token) {
      case '!':
        rule.conditional = true
        break
      case '-p':
        rule.proto = value
        i++
        break
      case '-s':
        rule.source = value
        i++
        break
      case '-i':
        rule.iface = value
        i++
        break
      case '--dport':
      case '--dports':
      case '--destination-port':
        rule.ports = value
          .split(',')
          .flatMap((part) => {
            const [from, to] = part.split(':').map(Number)
            return to ? Array.from({ length: Math.max(0, Math.min(to, from + 1024) - from + 1) }, (_, k) => from + k) : [from]
          })
          .filter(Number.isInteger)
        i++
        break
      case '-m':
        if (!PLAIN_MODULES.has(value)) rule.conditional = true
        i++
        break
      case '-j':
        rule.verdict = value === 'ACCEPT' || value === 'DROP' || value === 'REJECT' ? value : null
        i++
        break
      default:
        // 其他带值的选项（-d、-o、--state 等）都让这条规则变成有条件的
        if (token.startsWith('-')) rule.conditional = true
    }
  }
  return rule
}

const PRIVATE_SOURCE = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/
/** 不是局域网的入口：回环、蜂窝数据口 */
const NON_LAN_IFACE = /^(lo|rmnet|ccmni|wwan|v4-rmnet|seth|dummy)/

/** 这条规则会不会作用到「局域网设备访问这个 TCP 端口」 */
function hitsLan(rule: Rule, port: number): boolean {
  if (rule.conditional) return false
  if (rule.proto !== null && rule.proto !== 'tcp' && rule.proto !== 'all') return false
  if (rule.ports !== null && !rule.ports.includes(port)) return false
  if (rule.source !== null && !PRIVATE_SOURCE.test(rule.source)) return false
  if (rule.iface !== null && NON_LAN_IFACE.test(rule.iface.replace(/\+$/, ''))) return false
  return true
}

function lanBlocked(text: string): Set<number> {
  const rules = text.split('\n').map(parseRule).filter((rule): rule is Rule => rule !== null)
  const policyDrop = /^-P INPUT (DROP|REJECT)\b/m.test(text)
  const candidates = new Set<number>()
  for (const rule of rules) {
    if (rule.verdict && rule.verdict !== 'ACCEPT' && (rule.proto === null || rule.proto === 'tcp') && rule.ports) {
      for (const port of rule.ports) candidates.add(port)
    }
  }
  const blocked = new Set<number>()
  for (const port of candidates) {
    const first = rules.find((rule) => rule.verdict !== null && hitsLan(rule, port))
    if (first ? first.verdict !== 'ACCEPT' : policyDrop) blocked.add(port)
  }
  return blocked
}

/** IPv6 只看有没有这个端口的 TCP DROP 规则（UDP 的同端口规则由开机加固一起加，不影响显示） */
function dropPorts(text: string): Set<number> {
  const ports = new Set<number>()
  for (const line of text.split('\n')) {
    if (!/\s-j DROP\b/.test(line) || !/\s-p tcp\b/.test(line)) continue
    const match = /--dport (\d+)\b/.exec(line)
    if (match) ports.add(Number(match[1]))
  }
  return ports
}

export function parseBlockedPorts(output: string): BlockedPorts {
  const at = output.indexOf(V6_MARK)
  return {
    v4: lanBlocked(at < 0 ? output : output.slice(0, at)),
    v6: dropPorts(at < 0 ? '' : output.slice(at + V6_MARK.length)),
  }
}

/** 列表里除了 Web 终端、ADB 之外要显示的端口：用户自己阻止过的（固件规则、开机加固的 IPv6 规则都不算） */
export function userBlockedPorts(blocked: BlockedPorts, known: number[]): number[] {
  const ports = new Set([...blocked.v4].filter((port) => !V4_SYSTEM_PORTS.has(port)))
  for (const port of blocked.v6) if (!V6_HARDENED_PORTS.has(port) && !V4_SYSTEM_PORTS.has(port)) ports.add(port)
  return [...ports].filter((port) => !known.includes(port)).sort((a, b) => a - b)
}

/** 写入成功后先把结果记进缓存（再去读设备确认），开关不会先弹回旧状态 */
export function withPortBlocked(blocked: BlockedPorts, port: number, on: boolean, ipv6: boolean): BlockedPorts {
  const v4 = new Set(blocked.v4)
  const v6 = new Set(blocked.v6)
  if (on) v4.add(port)
  else v4.delete(port)
  // 开机加固过的端口，放行时不动它的 IPv6 规则（见 setPortBlocked）
  if (ipv6 && (on || !V6_HARDENED_PORTS.has(port))) {
    if (on) v6.add(port)
    else v6.delete(port)
  }
  return { v4, v6 }
}
