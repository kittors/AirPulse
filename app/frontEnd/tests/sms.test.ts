import { describe, expect, it } from 'vitest'

import { decodeSmsBody, extractCode, parseSmsDate } from '../src/model/sms'

describe('短信解析', () => {
  it('Base64 UTF-8 正文', () => {
    const b64 = Buffer.from('【中国移动】您的验证码为 482916', 'utf8').toString('base64')
    expect(decodeSmsBody(b64)).toBe('【中国移动】您的验证码为 482916')
    // 设备偶尔返回去掉了 = 补位的 Base64
    expect(decodeSmsBody(b64.replace(/=+$/, ''))).toBe('【中国移动】您的验证码为 482916')
  })

  it('日期按时区换算成时间戳', () => {
    // 26 年 10 月 28 日 22:30:15，UTC+8（+32 个 15 分钟）
    expect(parseSmsDate('26,10,28,22,30,15,+32')).toBe(Date.UTC(2026, 9, 28, 14, 30, 15))
    expect(parseSmsDate('')).toBeNull()
    expect(parseSmsDate('26,10,28')).toBeNull()
  })

  it('认出验证码，但不把金额、单号当成验证码', () => {
    expect(extractCode('【中国移动】您的验证码为 482916，5 分钟内有效')).toBe('482916')
    expect(extractCode('您的动态码：0517，请勿泄露')).toBe('0517')
    expect(extractCode('Your verification code is 731204')).toBe('731204')
    expect(extractCode('482916 是您的验证码，10 分钟内有效')).toBe('482916')
    expect(extractCode('您本月套餐内通用流量已使用 60.5GB，剩余 139.5GB')).toBeNull()
    expect(extractCode('您的快件 SF1408231 已由前台代收，凭取件码 7-2-1043 领取')).toBeNull()
  })
})

describe('短信发送与会话', () => {
  it('正文按 UTF-16BE 十六进制编码（与原版 gsmEncode 一致）', async () => {
    const { encodeSmsBody } = await import('../src/model/sms')
    expect(encodeSmsBody('Hi')).toBe('00480069')
    expect(encodeSmsBody('你好')).toBe('4f60597d')
    // emoji 是代理对：两个码元
    expect(encodeSmsBody('😀')).toBe('d83dde00')
  })

  it('按 UCS-2 计条数', async () => {
    const { smsSegments } = await import('../src/model/sms')
    expect(smsSegments('')).toBe(0)
    expect(smsSegments('a'.repeat(70))).toBe(1)
    expect(smsSegments('a'.repeat(71))).toBe(2)
    expect(smsSegments('a'.repeat(134))).toBe(2)
    expect(smsSegments('a'.repeat(135))).toBe(3)
  })

  it('同一号码（含 +86）归成一个会话，最近的会话在前', async () => {
    const { groupConversations } = await import('../src/model/sms')
    const base = { body: 'x', unread: false, outgoing: false, failed: false }
    const list = groupConversations([
      { ...base, id: '1', number: '+8613800138000', time: 1000 },
      { ...base, id: '2', number: '13800138000', time: 3000, unread: true },
      { ...base, id: '3', number: '10086', time: 2000 },
    ])
    expect(list.map((c) => c.number)).toEqual(['13800138000', '10086'])
    expect(list[0].messages.map((m) => m.id)).toEqual(['1', '2'])
    expect(list[0].unread).toBe(1)
  })
})
