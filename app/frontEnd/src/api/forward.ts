import { api } from './client'

export * from '@/model/forward'

/**
 * 短信转发（AirPulse 后端独立完成，不读官方后台的短信）。见 docs/legacy-network-sms.md §6：
 * 三个渠道（邮件 / curl / 钉钉）配置各自保留，最后一次保存的渠道生效；保存成功后后端立刻用该渠道发一条测试消息，
 * 但发送是异步入队的——返回 success 只代表已保存，不代表送达。
 */

export type ForwardMethod = 'SMTP' | 'CURL' | 'DINGTALK' | ''

export interface MailConfig {
  smtp_host: string
  smtp_port: string
  smtp_username: string
  smtp_password: string
  smtp_from: string
  smtp_from_name: string
  smtp_to: string
  forward_dev_info: '1' | '0'
}

export interface DingtalkConfig {
  webhook_url: string
  secret: string
  forward_dev_info: '1' | '0'
}

const flag = (value: unknown) => String(value ?? '') === '1'
const str = (value: unknown) => (value == null ? '' : String(value))

export const forwardApi = {
  enabled: async () => flag((await api<{ enabled?: unknown }>('/sms_forward_enabled')).enabled),
  /** 开关走 query 参数，没有请求体 */
  setEnabled: (enabled: boolean) => api('/sms_forward_enabled', { method: 'POST', query: { enable: enabled ? 1 : 0 } }),
  method: async (): Promise<ForwardMethod> => {
    const value = str((await api<{ sms_forward_method?: unknown }>('/sms_forward_method')).sms_forward_method).toUpperCase()
    return value === 'SMTP' || value === 'CURL' || value === 'DINGTALK' ? value : ''
  },

  async mail(): Promise<MailConfig> {
    const raw = await api<Record<string, unknown>>('/sms_forward_mail')
    return {
      smtp_host: str(raw.smtp_host),
      smtp_port: str(raw.smtp_port) || '465',
      smtp_username: str(raw.smtp_username),
      smtp_password: str(raw.smtp_password),
      smtp_from: str(raw.smtp_from),
      smtp_from_name: str(raw.smtp_from_name),
      smtp_to: str(raw.smtp_to),
      forward_dev_info: flag(raw.forward_dev_info) ? '1' : '0',
    }
  },
  saveMail: (config: MailConfig) => api('/sms_forward_mail', { method: 'POST', json: config, timeout: 20_000 }),

  curl: async () => str((await api<{ curl_text?: unknown }>('/sms_forward_curl')).curl_text),
  saveCurl: (text: string) => api('/sms_forward_curl', { method: 'POST', json: { curl_text: text }, timeout: 20_000 }),

  async dingtalk(): Promise<DingtalkConfig> {
    const raw = await api<Record<string, unknown>>('/sms_forward_dingtalk')
    return { webhook_url: str(raw.webhook_url), secret: str(raw.secret), forward_dev_info: flag(raw.forward_dev_info) ? '1' : '0' }
  },
  saveDingtalk: (config: DingtalkConfig) => api('/sms_forward_dingtalk', { method: 'POST', json: config, timeout: 20_000 }),

  powerEnabled: async () => flag((await api<{ enabled?: unknown }>('/power_status_forward_enabled')).enabled),
  setPowerEnabled: (enabled: boolean) => api('/power_status_forward_enabled', { method: 'POST', query: { enable: enabled ? 1 : 0 } }),

  async blacklist() {
    const raw = await api<{ keywords?: unknown; phone?: unknown }>('/sms_forward_blacklist')
    return { phone: str(raw.phone), keywords: str(raw.keywords) }
  },
  /** 两个键都必须带上，否则后端报「请求出错」 */
  saveBlacklist: (phone: string, keywords: string) => api('/sms_forward_blacklist', { method: 'POST', json: { keywords, phone } }),

  /** 按当前渠道立即推送一条（不检查总开关和过滤规则） */
  test: (body: string) => api('/do_forward_msg', { method: 'POST', json: { address: 'AirPulse', body, is_sms: true, timestamp: Date.now() } }),
}

export const forwardKeys = {
  all: ['forward'] as const,
  enabled: ['forward', 'enabled'] as const,
  method: ['forward', 'method'] as const,
  mail: ['forward', 'mail'] as const,
  curl: ['forward', 'curl'] as const,
  dingtalk: ['forward', 'dingtalk'] as const,
  power: ['forward', 'power'] as const,
  blacklist: ['forward', 'blacklist'] as const,
}
