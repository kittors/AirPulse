import { Envelope, Tray } from '@phosphor-icons/react'
import type { QueryClient } from '@tanstack/react-query'

import { forwardApi, forwardKeys } from '@/api/forward'
import { queryClient } from '@/app/query'
import { useReadyValue } from '@/app/ready'
import { useSubRoute } from '@/app/router'
import { directionOf, swapView, viewName } from '@/app/transition'
import { PageHeader } from '@/components/ui/card'
import { PageTabs } from '@/components/ui/page-tabs'
import { versionInfoQuery } from '@/hooks/queries'
import { useT } from '@/i18n'
import type { Telemetry } from '@/model/telemetry'

import { guardQuery } from '../settings/TrafficSection'
import { ForwardSettings } from './ForwardSettings'
import { Inbox, inboxQuery } from './Inbox'

type Section = 'inbox' | 'forward'
const SECTIONS: Section[] = ['inbox', 'forward']

/** 各分区的首屏数据（切到分区前预读；只读，和打开页面时发的请求一样，不会把短信标成已读） */
function preloadSection(client: QueryClient, section: Section): Promise<unknown> {
  if (section === 'forward') {
    return Promise.all([
      client.prefetchQuery({ queryKey: forwardKeys.enabled, queryFn: forwardApi.enabled }),
      client.prefetchQuery({ queryKey: forwardKeys.mail, queryFn: forwardApi.mail }),
      client.prefetchQuery({ queryKey: forwardKeys.dingtalk, queryFn: forwardApi.dingtalk }),
      client.prefetchQuery({ queryKey: forwardKeys.power, queryFn: forwardApi.powerEnabled }),
      client.prefetchQuery({ queryKey: forwardKeys.blacklist, queryFn: forwardApi.blacklist }),
      client.prefetchQuery(guardQuery),
      client.prefetchQuery(versionInfoQuery),
    ])
  }
  const unread = client.getQueryData<Telemetry>(['telemetry'])?.smsUnread ?? 0
  return client.prefetchQuery(inboxQuery(unread))
}

/** 首屏数据：切页前预读（见 AppShell） */
export const preload = (client: QueryClient, sub: string | null) => preloadSection(client, sub === 'forward' ? 'forward' : 'inbox')

/**
 * 短信：收件箱（会话列表 + 对话）与转发设置两个分区。
 * 会话用路由第二段表示（#/messages/10086），手机上点进对话后浏览器返回键就能回到列表。
 */
export default function MessagesPage() {
  const t = useT()
  const sub = useSubRoute()
  const target: Section = sub === 'forward' ? 'forward' : 'inbox'
  const section = useReadyValue(target, (next) => preloadSection(queryClient, next), {
    commit: (update, from, to) => swapView(update, { level: 'section', direction: directionOf(SECTIONS, from, to) }),
  })
  return (
    <>
      <PageHeader title={t.messages.title} />
      <PageTabs
        route="messages"
        value={target}
        tabs={[
          { value: 'inbox', label: t.messages.inbox, icon: Tray },
          { value: 'forward', label: t.messages.forward, icon: Envelope },
        ]}
      />
      <div key={section} className="ap-section" style={viewName(`ap-section-${section}`)}>
        {section === 'forward' ? <ForwardSettings /> : <Inbox selected={sub && sub !== 'inbox' && sub !== 'forward' ? sub : null} />}
      </div>
    </>
  )
}
