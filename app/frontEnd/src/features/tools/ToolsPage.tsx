import { ArrowCircleUp, Broadcast, CalendarCheck, Gauge, TerminalWindow, Wrench } from '@phosphor-icons/react'
import type { QueryClient } from '@tanstack/react-query'

import { queryClient } from '@/app/query'
import { useReadyValue } from '@/app/ready'
import { useSubRoute } from '@/app/router'
import { directionOf, swapView, viewName } from '@/app/transition'
import { PageHeader } from '@/components/ui/card'
import { PageTabs } from '@/components/ui/page-tabs'
import { versionInfoQuery } from '@/hooks/queries'
import { useT } from '@/i18n'

import { switchesQuery } from '../settings/switches'
import { AdvancedSection } from './AdvancedSection'
import { AtSection } from './AtSection'
import { adbWifiQuery, capabilitiesQuery, customHeadQuery, portsQuery, rootKey, rootQuery, storageQuery, tasksQuery, ttydQuery, uploadsQuery } from './keys'
import { SpeedSection } from './SpeedSection'
import { TasksSection } from './TasksSection'
import { TerminalSection } from './TerminalSection'
import { UpdateSection } from './UpdateSection'

type Section = 'at' | 'terminal' | 'speed' | 'tasks' | 'advanced' | 'update'
const SECTIONS: Section[] = ['at', 'terminal', 'speed', 'tasks', 'advanced', 'update']
const sectionOf = (sub: string | null): Section => (SECTIONS.includes(sub as Section) ? (sub as Section) : 'at')

/** 各分区的首屏数据（切到分区前预读，见 app/ready.ts）；AT 指令和测速没有要等的数据 */
function preloadSection(client: QueryClient, section: Section): Promise<unknown> {
  switch (section) {
    case 'terminal':
      return Promise.all([client.prefetchQuery(ttydQuery), client.prefetchQuery(rootQuery)])
    case 'tasks':
      return client.prefetchQuery(tasksQuery)
    case 'advanced':
      return Promise.all([
        client.prefetchQuery(switchesQuery),
        client.prefetchQuery(capabilitiesQuery),
        client.prefetchQuery(adbWifiQuery),
        client.prefetchQuery(customHeadQuery),
        client.prefetchQuery(uploadsQuery),
        // 端口防护要先知道有没有 root
        client.prefetchQuery(rootQuery).then(() => (client.getQueryData(rootKey) ? client.prefetchQuery(portsQuery) : undefined)),
      ])
    case 'update':
      return Promise.all([client.prefetchQuery(versionInfoQuery), client.prefetchQuery(storageQuery), client.prefetchQuery(capabilitiesQuery)])
    default:
      return Promise.resolve()
  }
}

/** 首屏数据：切页前预读（见 AppShell） */
export const preload = (client: QueryClient, sub: string | null) => preloadSection(client, sectionOf(sub))

/**
 * 工具：AT 指令、终端、测速、定时任务、高级、系统更新（#/tools/speed）。
 * 每个分区自成一页，需要 root / ADB 的功能就地说明前置条件，而不是点了才报错。
 * 切分区：标签立即高亮，内容等数据读好再换（同切页）。
 */
export default function ToolsPage() {
  const t = useT()
  const target = sectionOf(useSubRoute())
  const section = useReadyValue(target, (next) => preloadSection(queryClient, next), {
    commit: (update, from, to) => swapView(update, { level: 'section', direction: directionOf(SECTIONS, from, to) }),
  })
  return (
    <>
      <PageHeader title={t.tools.title} />
      <PageTabs
        route="tools"
        value={target}
        tabs={[
          { value: 'at', label: t.tools.tabs.at, icon: Broadcast },
          { value: 'terminal', label: t.tools.tabs.terminal, icon: TerminalWindow },
          { value: 'speed', label: t.tools.tabs.speed, icon: Gauge },
          { value: 'tasks', label: t.tools.tabs.tasks, icon: CalendarCheck },
          { value: 'advanced', label: t.tools.tabs.advanced, icon: Wrench },
          { value: 'update', label: t.tools.tabs.update, icon: ArrowCircleUp },
        ]}
      />
      <div key={section} className="ap-section" style={viewName(`ap-section-${section}`)}>
        {section === 'at' && <AtSection />}
        {section === 'terminal' && <TerminalSection />}
        {section === 'speed' && <SpeedSection />}
        {section === 'tasks' && <TasksSection />}
        {section === 'advanced' && <AdvancedSection />}
        {section === 'update' && <UpdateSection />}
      </div>
    </>
  )
}
