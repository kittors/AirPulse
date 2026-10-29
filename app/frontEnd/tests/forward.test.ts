import { describe, expect, it } from 'vitest'

import { detectPreset, missingPlaceholders, normalizeCurl, PRESETS, presetById, smartFill, validParam, validPhoneList } from '../src/model/forward'

describe('短信转发预设', () => {
  it('每个预设都包含后端要求的三个占位符，并且请求体是单引号 JSON', () => {
    for (const preset of PRESETS) {
      const params = Object.fromEntries(preset.fields.map((f) => [f.key, f.default ?? (f.kind === 'url' ? 'https://x.example.com' : 'TOKEN')]))
      const text = preset.build(params)
      expect(missingPlaceholders(text)).toEqual([])
      expect(text.startsWith('curl ')).toBe(true)
      const body = /-d '(.*)'$/.exec(text)?.[1] ?? ''
      // 占位符替换前的模板本身就是合法 JSON
      expect(() => JSON.parse(body.replace(/\{\{[a-z-]+\}\}/g, 'x'))).not.toThrow()
    }
  })

  it('读回已保存的命令：能反解出参数，往返一致', () => {
    const bark = presetById('bark').build({ server: 'https://api.day.app/', key: 'abc123' })
    expect(detectPreset(bark)).toEqual({ id: 'bark', params: { server: 'https://api.day.app', key: 'abc123' } })
    const tg = presetById('telegram').build({ token: '123:AA-bb', chat: '-100200' })
    expect(detectPreset(`  ${tg} `)).toEqual({ id: 'telegram', params: { token: '123:AA-bb', chat: '-100200' } })
  })

  it('改过的命令（含原版模板）不会被误认成预设', () => {
    const edited = presetById('wecom').build({ key: 'k' }).replace('【号码】', '【From】')
    expect(detectPreset(edited)).toBeNull()
    const legacy = `curl -X POST "https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=k" -H "Content-Type: application/json" -d '{"msgtype": "text", "text": {"content": "{{sms-body}}"}}'`
    expect(detectPreset(legacy)).toBeNull()
  })

  it('参数校验与自定义命令整理', () => {
    const url = presetById('webhook').fields[0]
    expect(validParam(url, 'https://a.example.com/hook')).toBe(true)
    expect(validParam(url, 'ftp://a')).toBe(false)
    expect(validParam(presetById('bark').fields[1], "a'b")).toBe(false)
    expect(normalizeCurl('curl -X POST \\\n  "https://x" \\\n -d \'{}\'')).toBe(`curl -X POST "https://x" -d '{}'`)
    expect(validPhoneList('10086\n95588')).toBe(true)
    expect(validPhoneList('+8610086')).toBe(false)
  })
})

describe('smartFill', () => {
  it('拆出 Bark 链接里的服务器与 Key', () => {
    expect(smartFill('bark', 'key', 'https://api.day.app/AbCd123/这里改成你自己的推送内容')).toEqual({ server: 'https://api.day.app', key: 'AbCd123' })
    expect(smartFill('bark', 'key', 'AbCd123')).toEqual({ key: 'AbCd123' })
  })
  it('拆出企业微信、飞书、Server 酱、Gotify 的参数', () => {
    expect(smartFill('wecom', 'key', 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=693a91f6-7xxx')).toEqual({ key: '693a91f6-7xxx' })
    expect(smartFill('feishu', 'token', 'https://open.feishu.cn/open-apis/bot/v2/hook/abc-123')).toEqual({ token: 'abc-123' })
    expect(smartFill('serverchan', 'key', 'https://sctapi.ftqq.com/SCT123abc.send')).toEqual({ key: 'SCT123abc' })
    expect(smartFill('gotify', 'token', 'https://push.example.com/message?token=AbC')).toEqual({ server: 'https://push.example.com', token: 'AbC' })
  })
  it('认不出时原样返回', () => {
    expect(smartFill('wecom', 'key', 'https://example.com/hook')).toEqual({ key: 'https://example.com/hook' })
    expect(smartFill('webhook', 'url', 'https://example.com/hook')).toEqual({ url: 'https://example.com/hook' })
  })
})
