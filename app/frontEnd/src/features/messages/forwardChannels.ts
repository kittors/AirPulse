import {
  Bell,
  BellRinging,
  Bird,
  Broadcast,
  ChatCenteredText,
  ChatsCircle,
  Envelope,
  Megaphone,
  TelegramLogo,
  TerminalWindow,
  WebhooksLogo,
  WechatLogo,
  type Icon,
} from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'

import { detectPreset, forwardApi, forwardKeys, type ForwardMethod, type PresetId } from '@/api/forward'
import type { Messages } from '@/i18n'

/** 界面上的「渠道」：邮件、钉钉各占一个后端渠道；其余都是 curl 渠道上的预设或自定义命令 */
export type ChannelId = 'email' | 'dingtalk' | PresetId | 'custom'

export const PRIMARY_CHANNELS: ChannelId[] = ['email', 'dingtalk', 'bark', 'telegram', 'wecom', 'feishu']
export const MORE_CHANNELS: ChannelId[] = ['pushplus', 'serverchan', 'ntfy', 'gotify', 'webhook', 'custom']

export const CHANNEL_ICONS: Record<ChannelId, Icon> = {
  email: Envelope,
  dingtalk: ChatsCircle,
  bark: Bell,
  telegram: TelegramLogo,
  wecom: WechatLogo,
  feishu: Bird,
  pushplus: ChatCenteredText,
  serverchan: Megaphone,
  ntfy: BellRinging,
  gotify: Broadcast,
  webhook: WebhooksLogo,
  custom: TerminalWindow,
}

export const isCurlChannel = (id: ChannelId) => id !== 'email' && id !== 'dingtalk'
export const channelName = (t: Messages, id: ChannelId) => t.forward.channels[id].name

export function activeChannelOf(method: ForwardMethod | undefined, curl: string | undefined): ChannelId | null {
  if (method === 'SMTP') return 'email'
  if (method === 'DINGTALK') return 'dingtalk'
  if (method === 'CURL') return curl == null ? null : (detectPreset(curl)?.id ?? 'custom')
  return null
}

/** 当前生效的渠道：curl 渠道要读回命令才知道是哪个预设 */
export function useActiveChannel() {
  const method = useQuery({ queryKey: forwardKeys.method, queryFn: forwardApi.method })
  const curl = useQuery({ queryKey: forwardKeys.curl, queryFn: forwardApi.curl })
  const loading = method.isPending || (method.data === 'CURL' && curl.isPending)
  return { active: loading ? undefined : activeChannelOf(method.data, curl.data), curl: curl.data, loading }
}
