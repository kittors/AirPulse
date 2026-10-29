import { describe, expect, it } from 'vitest'

import { classifyAt, forbiddenAtChar, formatAtOutput, isAtError, normalizeAt, parseSynchParam } from '../src/model/at'
import { parseCustomHead, serializeCustomHead } from '../src/model/plugins'
import { parseBlockedPorts, userBlockedPorts, withPortBlocked } from '../src/model/ports'
import { buildAction, decodeUcs2Hex, EMPTY_DRAFT, encodeUcs2Hex, formatTimeInput, normalizeTime, parseAction, sortTasks, type TaskInfo } from '../src/model/tasks'

describe('AT 指令', () => {
  it('拒绝会造成注入的字符', () => {
    expect(forbiddenAtChar('AT+CGSN')).toBeNull()
    expect(forbiddenAtChar('AT+SP5GCMDS="get nr synch_param",44')).toBeNull()
    expect(forbiddenAtChar("AT+CGSN';reboot")).toBe("'")
    expect(forbiddenAtChar('AT+X=$(id)')).toBe('$')
    expect(forbiddenAtChar('AT+X=`id`')).toBe('`')
  })

  it('补全 AT 前缀', () => {
    expect(normalizeAt(' at+cgsn ')).toBe('AT+cgsn')
    expect(normalizeAt('+CIMI')).toBe('AT+CIMI')
    expect(normalizeAt('CGMR')).toBe('AT+CGMR')
    expect(normalizeAt('')).toBe('')
  })

  it('按风险分级', () => {
    expect(classifyAt('AT+CGSN')).toBe('read')
    expect(classifyAt('AT+CGEQOSRDP=1')).toBe('read')
    expect(classifyAt('AT+COPS?')).toBe('read')
    expect(classifyAt('AT+CGDCONT=?')).toBe('read')
    expect(classifyAt('AT+SP5GCMDS="get nr synch_param",44')).toBe('read')
    expect(classifyAt('AT+CFUN=1,1')).toBe('danger')
    expect(classifyAt('AT+SP5GCMDS="set nr param",35,1')).toBe('danger')
    expect(classifyAt('AT+SPIMEI=0,"123"')).toBe('danger')
    expect(classifyAt('AT+CAVIMS=1')).toBe('write')
  })

  it('识别基带错误并恢复多行输出', () => {
    expect(isAtError('ERROR')).toBe(true)
    expect(isAtError('+CME ERROR: 4')).toBe(true)
    expect(isAtError('+CGSN: 861234567890123 OK')).toBe(false)
    expect(formatAtOutput('+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000 OK')).toBe('+CGEQOSRDP: 1,9,0,0,0,0,1000000,200000\nOK')
    expect(formatAtOutput('+CGDCONT: 1,"IP","cmnet"+CGDCONT: 2,"IPV4V6","ims" OK')).toBe('+CGDCONT: 1,"IP","cmnet"\n+CGDCONT: 2,"IPV4V6","ims"\nOK')
  })

  it('高铁模式状态按第 3 段解析（兼容带引号的响应）', () => {
    expect(parseSynchParam('+SP5GCMDS: "get nr synch_param",44,1 OK')).toBe(true)
    expect(parseSynchParam('+SP5GCMDS: get nr synch_param,44,0 OK')).toBe(false)
    expect(parseSynchParam('ERROR')).toBeNull()
  })
})

describe('定时任务', () => {
  it('动作表单 → action，值全是字符串', () => {
    expect(buildAction({ ...EMPTY_DRAFT, kind: 'performance', on: true })).toEqual({
      ok: true,
      action: { goformId: 'PERFORMANCE_MODE_SETTING', performance_mode: '1' },
    })
    expect(buildAction({ ...EMPTY_DRAFT, kind: 'roaming', on: false })).toEqual({
      ok: true,
      action: { goformId: 'SET_CONNECTION_MODE', ConnectionMode: 'auto_dial', roam_setting_option: 'off', dial_roam_setting_option: 'off' },
    })
    expect(buildAction({ ...EMPTY_DRAFT, kind: 'wifi', wifi: 'off' })).toEqual({ ok: true, action: { goformId: 'switchWiFiModule', SwitchOption: '0' } })
    expect(buildAction({ ...EMPTY_DRAFT, kind: 'lockCell', pci: 'x', earfcn: '1' })).toEqual({ ok: false, error: 'pci' })
    expect(buildAction({ ...EMPTY_DRAFT, kind: 'custom', custom: '{"a":1}' })).toEqual({ ok: false, error: 'goformId' })
    expect(buildAction({ ...EMPTY_DRAFT, kind: 'custom', custom: '{"goformId":"X","n":0}' })).toEqual({ ok: true, action: { goformId: 'X', n: '0' } })
  })

  it('短信正文按 UTF-16 十六进制编码，可往返', () => {
    expect(encodeUcs2Hex('Hi你')).toBe('004800694f60')
    expect(decodeUcs2Hex(encodeUcs2Hex('流量查询 😀'))).toBe('流量查询 😀')
  })

  it('已有任务反解回表单；认不得的保留为自定义', () => {
    for (const draft of [
      { ...EMPTY_DRAFT, kind: 'reboot' as const },
      { ...EMPTY_DRAFT, kind: 'data' as const, on: false },
      { ...EMPTY_DRAFT, kind: 'wifi' as const, wifi: 'chip1' as const },
      { ...EMPTY_DRAFT, kind: 'networkMode' as const, mode: 'Only_LTE' },
      { ...EMPTY_DRAFT, kind: 'lockCell' as const, pci: '912', earfcn: '504990', rat: '16' as const },
      { ...EMPTY_DRAFT, kind: 'sendSms' as const, number: '10086', body: '查询流量' },
      { ...EMPTY_DRAFT, kind: 'forwardInfo' as const },
      { ...EMPTY_DRAFT, kind: 'indicator' as const, on: false },
    ]) {
      const built = buildAction(draft)
      expect(built.ok).toBe(true)
      if (built.ok) expect(parseAction(built.action)).toMatchObject({ kind: draft.kind })
    }
    // 原版模板里没改的占位文字：不能当成开关
    expect(parseAction({ goformId: 'INDICATOR_LIGHT_SETTING', indicator_light_switch: '此处 开启填 1 关闭填 0' }).kind).toBe('custom')
    expect(parseAction({ goformId: 'PERFORMANCE_MODE', performance_mode: '1' }).kind).toBe('custom')
  })

  it('时间补齐为两位数 HH:mm', () => {
    expect(normalizeTime('3:5')).toBe('03:05')
    expect(normalizeTime('0305')).toBe('03:05')
    expect(normalizeTime('23:59')).toBe('23:59')
    expect(normalizeTime('24:00')).toBeNull()
    expect(normalizeTime('12:60')).toBeNull()
  })

  it('按下一次触发时间排序，已执行的一次性任务沉底', () => {
    const tasks: TaskInfo[] = [
      { key: 1, id: 'a', time: '02:00', repeatDaily: true },
      { key: 2, id: 'b', time: '23:00', repeatDaily: true },
      { key: 3, id: 'c', time: '22:30', repeatDaily: false, hasTriggered: true },
    ]
    expect(sortTasks(tasks, new Date(2026, 0, 1, 22, 0)).map((t) => t.id)).toEqual(['b', 'a', 'c'])
  })
})

describe('自定义注入', () => {
  const text = [
    '<style>body{}</style>',
    '<!-- [KANO_PLUGIN_START] 主题 -->\n<style>a{}</style>\n<!-- [KANO_PLUGIN_END] 主题 -->',
    '<!-- [KANO_PLUGIN_START] 统计 -->\n<!-- [kano_disabled]\n<script>1</script>\n[kano_disabled] -->\n<!-- [KANO_PLUGIN_END] 统计 -->',
  ].join('\n\n\n\n')

  it('解析块、停用状态与块外内容', () => {
    const head = parseCustomHead(text)
    expect(head.loose).toBe('<style>body{}</style>')
    expect(head.blocks).toEqual([
      { name: '主题', content: '<style>a{}</style>', enabled: true },
      { name: '统计', content: '<script>1</script>', enabled: false },
    ])
  })

  it('序列化与原版格式一致，可往返', () => {
    expect(serializeCustomHead(parseCustomHead(text))).toBe(text)
  })
})

describe('时间输入', () => {
  it('手机数字键盘没有冒号：3–4 位数字自动补成 HH:mm', () => {
    expect(formatTimeInput('043')).toBe('04:3')
    expect(formatTimeInput('0430')).toBe('04:30')
    expect(formatTimeInput('04:30')).toBe('04:30')
    expect(formatTimeInput('04')).toBe('04')
    expect(formatTimeInput('04:')).toBe('04:')
    expect(formatTimeInput('0a4 30')).toBe('04:30')
    expect(formatTimeInput('12:345')).toBe('12:34')
  })
})

describe('端口防护', () => {
  // 真机（F50，高级功能已开）iptables -S INPUT / ip6tables -S INPUT 的原样输出，外加用户自己阻止的 7000
  const device = [
    '-P INPUT ACCEPT',
    '-A INPUT -i lo -j ACCEPT',
    '-A INPUT -s 192.168.0.0/24 -p tcp -m tcp --dport 8080 -j ACCEPT',
    '-A INPUT -j bw_INPUT',
    '-A INPUT -j fw_INPUT',
    '-A INPUT -p tcp -m tcp --dport 8080 -j DROP',
    '-A INPUT -p tcp -m tcp --dport 9090 -j DROP',
    '-A INPUT -p tcp -m tcp --dport 9999 -j DROP',
    '-A INPUT -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1460',
    '-A INPUT -p tcp -m tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1460',
    '-A INPUT -p tcp -m tcp --dport 7000 -j DROP',
    '-A INPUT -p udp -m udp --dport 7001 -j DROP',
    '__ip6tables__',
    '-P INPUT ACCEPT',
    '-A INPUT -j zte_fw_net_limit',
    '-A INPUT -j bw_INPUT',
    '-A INPUT -j fw_INPUT',
    ...[8080, 1146, 139, 445, 5555, 5201, 5001, 5002].map((port) => `-A INPUT -p tcp -m tcp --dport ${port} -j DROP`),
    ...[8080, 1146, 139, 445, 5555, 5201, 5001, 5002].map((port) => `-A INPUT -p udp -m udp --dport ${port} -j DROP`),
    '-A INPUT -p tcp -m tcp --dport 9000 -j DROP',
  ].join('\n')

  it('IPv4 按规则顺序看局域网能不能访问：8080 先放行了局域网，不算阻止；只看 TCP', () => {
    const blocked = parseBlockedPorts(device)
    expect([...blocked.v4].sort((a, b) => a - b)).toEqual([7000, 9090, 9999])
    expect(blocked.v6.has(1146)).toBe(true)
    expect(blocked.v6.has(9000)).toBe(true)
    expect(blocked.v6.has(7001)).toBe(false)
  })

  it('固件规则和开机加固的 IPv6 规则都不算用户阻止的端口', () => {
    expect(userBlockedPorts(parseBlockedPorts(device), [1146, 5555])).toEqual([7000, 9000])
    expect(userBlockedPorts(parseBlockedPorts('__ip6tables__\n-A INPUT -p tcp -m tcp --dport 8080 -j DROP'), [])).toEqual([])
  })

  it('只对蜂窝口、回环或公网来源生效的规则不影响局域网；带附加条件的规则不当结论', () => {
    const rules = [
      '-P INPUT ACCEPT',
      '-A INPUT -i rmnet_data0 -p tcp -m tcp --dport 5555 -j DROP',
      '-A INPUT -s 1.2.3.0/24 -p tcp -m tcp --dport 5555 -j ACCEPT',
      '-A INPUT -p tcp -m state --state ESTABLISHED -m tcp --dport 1146 -j ACCEPT',
      '-A INPUT -p tcp -m tcp --dport 1146 -j DROP',
      '-A INPUT -p tcp -m multiport --dports 6000:6002,6100 -j DROP',
    ].join('\n')
    const blocked = parseBlockedPorts(rules)
    expect([...blocked.v4].sort((a, b) => a - b)).toEqual([1146, 6000, 6001, 6002, 6100])
  })

  it('默认策略是 DROP 时，没有放行规则的端口算阻止', () => {
    const blocked = parseBlockedPorts(['-P INPUT DROP', '-A INPUT -s 192.168.0.0/24 -p tcp -m tcp --dport 80 -j ACCEPT', '-A INPUT -p tcp -m tcp --dport 80 -j DROP', '-A INPUT -p tcp -m tcp --dport 81 -j DROP'].join('\n'))
    expect([...blocked.v4]).toEqual([81])
  })

  it('写入后先更新缓存：放行开机加固的端口时不动它的 IPv6 状态', () => {
    const blocked = parseBlockedPorts(device)
    const allowed = withPortBlocked(blocked, 1146, false, true)
    expect(allowed.v4.has(1146)).toBe(false)
    expect(allowed.v6.has(1146)).toBe(true)
    const custom = withPortBlocked(blocked, 7000, false, true)
    expect(custom.v4.has(7000)).toBe(false)
    const added = withPortBlocked(blocked, 7100, true, true)
    expect(added.v4.has(7100) && added.v6.has(7100)).toBe(true)
  })
})
