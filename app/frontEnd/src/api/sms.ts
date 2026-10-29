import { encodeSmsBody, parseSms, type RawSms, type SmsMessage } from '@/model/sms'

import { goformGet, goformSet } from './goform'

export { extractCode, groupConversations, smsSegments, type Conversation, type SmsMessage } from '@/model/sms'

export const smsApi = {
  /** 最近的短信，新的在前（只读，不会把未读标成已读）。原版一次取 500 条 */
  async list(pageSize = 20, signal?: AbortSignal): Promise<SmsMessage[]> {
    const res = await goformGet<{ messages?: RawSms[] | string }>('sms_data_total', {
      extra: { multi_data: 1, page: 0, data_per_page: pageSize, mem_store: 1, tags: 100, order_by: 'order by id desc' },
      signal,
    })
    const list = Array.isArray(res.messages) ? res.messages : []
    return list
      .map(parseSms)
      .filter((sms): sms is SmsMessage => sms !== null)
      .sort((a, b) => (b.time ?? 0) - (a.time ?? 0))
  },

  /** 发送：正文按 UTF-16BE 十六进制编码（与原版一致） */
  send: (number: string, body: string) => goformSet('SEND_SMS', { Number: number.trim(), MessageBody: encodeSmsBody(body) }, { timeout: 30_000 }),

  /** 删除：设备一次只认一条，按顺序逐条删（写操作本来就排队执行） */
  async remove(ids: string[]) {
    for (const id of ids) await goformSet('DELETE_SMS', { msg_id: id, notCallback: 'true' })
  },

  /** 标为已读：同样逐条提交；失败不打断其它条 */
  async markRead(ids: string[]) {
    for (const id of ids) await goformSet('SET_MSG_READ', { msg_id: id, notCallback: 'true' }).catch(() => undefined)
  },
}
