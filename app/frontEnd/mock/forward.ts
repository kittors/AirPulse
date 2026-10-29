import { fail, ok, optString, orgJsonError, type ApiRequest, type ApiResult } from './http'

/**
 * Mock：短信转发（总开关、SMTP / CURL / 钉钉三个渠道、黑名单、电源状态通知、主动转发），
 * 格式照 docs/legacy-network-sms.md §6 与附录 A.8。三套渠道配置各自保留，最后一次保存的渠道生效。
 * Mock 不真的发消息：保存成功只代表「配置已保存、测试消息已入队」，与真机一致。
 */

type Method = '' | 'SMTP' | 'CURL' | 'DINGTALK'

/** 前端 Bark 预设（src/model/forward.ts 的 PRESETS[0]）按 server=https://api.day.app、key=AbCd123 生成的命令；\n 是反斜杠加 n 两个字符 */
const BARK = `curl -s -X POST "https://api.day.app/AbCd123" -H 'Content-Type: application/json; charset=utf-8' -d '{"title":"{{sms-from}}","body":"{{sms-body}}\\n{{sms-time}}","group":"AirPulse","isArchive":1}'`

export class MockForward {
  private enabled = '1'
  private power = '0'
  private method: Method = 'CURL'
  private curl = BARK
  private smtp = {
    smtp_host: 'smtp.qq.com',
    smtp_port: '465',
    smtp_to: 'me@example.com',
    smtp_username: '123456@qq.com',
    smtp_password: 'abcdefghijklmnop',
    smtp_from: '',
    smtp_from_name: 'AirPulse',
    forward_dev_info: '1',
  }
  private dingtalk = { webhook_url: '', secret: '', forward_dev_info: '0' }
  private blacklist = { keywords: '退订\n广告', phone: '10010\n95588' }

  async api(req: ApiRequest): Promise<ApiResult | null> {
    const post = req.method === 'POST'
    switch (req.path) {
      case '/api/sms_forward_enabled':
      case '/api/power_status_forward_enabled': {
        const key = req.path === '/api/sms_forward_enabled' ? 'enabled' : 'power'
        if (!post) return ok({ enabled: this[key] })
        // 开关走 query，不校验取值：任何字符串都存下，只有 "1" 生效
        const enable = req.query.get('enable')
        if (enable === null) return fail('请求出错')
        this[key] = enable
        return ok()
      }
      case '/api/sms_forward_method':
        return ok({ sms_forward_method: this.method })
      case '/api/sms_forward_mail': {
        if (!post) return ok({ ...this.smtp })
        // 失败一律是笼统的「SMTP配置出错」，不带具体原因
        if (!req.json) return fail('SMTP配置出错')
        const field = (key: string, fallback = '') => optString(req.json?.[key], fallback).trim()
        const next = {
          smtp_host: field('smtp_host'),
          smtp_port: field('smtp_port', '465'),
          smtp_to: field('smtp_to'),
          smtp_username: field('smtp_username'),
          smtp_password: field('smtp_password'),
          smtp_from: field('smtp_from'),
          smtp_from_name: field('smtp_from_name'),
          forward_dev_info: field('forward_dev_info', '0'),
        }
        if (!next.smtp_to || !next.smtp_host || !next.smtp_username || !next.smtp_password) return fail('SMTP配置出错')
        if (next.smtp_from && !next.smtp_from.includes('@')) return fail('SMTP配置出错')
        this.smtp = next
        this.method = 'SMTP'
        return ok()
      }
      case '/api/sms_forward_curl': {
        if (!post) return ok({ curl_text: this.curl })
        if (!req.json) return fail(`curl配置出错：${orgJsonError(req.text)}`)
        if (!('curl_text' in req.json)) return fail('curl配置出错：No value for curl_text')
        // 模板原样保存（不 trim）；三个短信占位符缺一不可，按 body → time → from 的顺序检查
        const text = optString(req.json.curl_text)
        for (const holder of ['{{sms-body}}', '{{sms-time}}', '{{sms-from}}']) {
          if (!text.includes(holder)) return fail(`curl配置出错：没有找到“${holder}”占位符`)
        }
        this.curl = text
        this.method = 'CURL'
        return ok()
      }
      case '/api/sms_forward_dingtalk': {
        if (!post) {
          // 后端用字符串模板拼 JSON：webhook / secret 里有引号或反斜杠时返回的不是合法 JSON
          const { webhook_url, secret, forward_dev_info } = this.dingtalk
          const raw = `{\n    "webhook_url": "${webhook_url}",\n    "secret": "${secret}",\n    "forward_dev_info":"${forward_dev_info}"\n}`
          return { status: 200, raw, contentType: 'application/json; charset=utf-8' }
        }
        if (!req.json) return fail(`钉钉配置出错：${orgJsonError(req.text)}`)
        const webhook = optString(req.json.webhook_url).trim()
        if (!webhook) return fail('钉钉配置出错：缺少必要参数：webhook_url')
        this.dingtalk = { webhook_url: webhook, secret: optString(req.json.secret).trim(), forward_dev_info: optString(req.json.forward_dev_info, '0').trim() }
        this.method = 'DINGTALK'
        return ok()
      }
      case '/api/sms_forward_blacklist': {
        if (!post) return ok({ ...this.blacklist })
        // 两个键都必须存在；号码只允许数字和换行
        if (!req.json || !('phone' in req.json) || !('keywords' in req.json)) return fail('请求出错')
        const phone = optString(req.json.phone)
        if (!/^[0-9\n]*$/.test(phone)) return fail('请求出错')
        this.blacklist = { keywords: optString(req.json.keywords), phone }
        return ok()
      }
      case '/api/do_forward_msg':
        // 按当前渠道推送，不检查总开关和黑名单；没配置渠道时什么也不做，同样返回成功
        if (!req.json) return fail(`主动触发短信转发出错：${orgJsonError(req.text)}`)
        return ok()
      default:
        return null
    }
  }
}
