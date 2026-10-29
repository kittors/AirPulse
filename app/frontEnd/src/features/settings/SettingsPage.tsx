import { ChartBar, Cpu, GearSix, Network, SimCard } from '@phosphor-icons/react'
import type { QueryClient } from '@tanstack/react-query'

import { atSlotFor } from '@/api/device'
import { queryClient } from '@/app/query'
import { useReadyValue } from '@/app/ready'
import { useSubRoute } from '@/app/router'
import { directionOf, swapView, viewName } from '@/app/transition'
import { PageHeader } from '@/components/ui/card'
import { PageTabs } from '@/components/ui/page-tabs'
import { versionInfoQuery } from '@/hooks/queries'
import { useT } from '@/i18n'
import type { Telemetry } from '@/model/telemetry'

import { capabilitiesQuery } from '../tools/keys'
import { apnQuery } from './ipv6'
import { DeviceSection, logStatusQuery } from './DeviceSection'
import { switchesQuery } from './switches'
import { GeneralSection } from './GeneralSection'
import { LanSection, lanQuery } from './LanSection'
import { imsQueries, NetworkSection } from './NetworkSection'
import { dailyUsageQuery, guardQuery, planQuery, TrafficSection } from './TrafficSection'

type Section = 'network' | 'traffic' | 'lan' | 'device' | 'general'
const SECTIONS: Section[] = ['network', 'traffic', 'lan', 'device', 'general']
const sectionOf = (sub: string | null): Section => (SECTIONS.includes(sub as Section) ? (sub as Section) : 'traffic')

/** 各分区的首屏数据（切到分区前预读，见 app/ready.ts） */
function preloadSection(client: QueryClient, section: Section): Promise<unknown> {
  switch (section) {
    case 'network': {
      const telemetry = client.getQueryData<Telemetry>(['telemetry'])
      const ims = telemetry ? imsQueries(atSlotFor(telemetry)) : null
      return Promise.all([
        client.prefetchQuery(switchesQuery),
        client.prefetchQuery(versionInfoQuery),
        client.prefetchQuery(apnQuery),
        ...(ims ? [client.prefetchQuery(ims.volte), client.prefetchQuery(ims.vonr), client.prefetchQuery(ims.rail)] : []),
      ])
    }
    case 'traffic':
      return Promise.all([client.prefetchQuery(dailyUsageQuery()), client.prefetchQuery(planQuery), client.prefetchQuery(guardQuery)])
    case 'lan':
      return client.prefetchQuery(lanQuery)
    case 'device':
      return Promise.all([
        client.prefetchQuery(switchesQuery),
        client.prefetchQuery(versionInfoQuery),
        client.prefetchQuery(logStatusQuery),
        client.prefetchQuery(capabilitiesQuery),
      ])
    case 'general':
      return client.prefetchQuery(versionInfoQuery)
  }
}

/** 首屏数据：切页前预读（见 AppShell） */
export const preload = (client: QueryClient, sub: string | null) => preloadSection(client, sectionOf(sub))

/**
 * 设置：按用途分成网络、流量、局域网、设备、通用五个分区（#/settings/traffic），
 * 每个分区都是 iOS 式分组列表，改了哪组就在哪组旁边保存。
 * 切分区：标签立即高亮，内容等数据读好再换（同切页）。
 */
export default function SettingsPage() {
  const t = useT()
  const target = sectionOf(useSubRoute())
  const section = useReadyValue(target, (next) => preloadSection(queryClient, next), {
    commit: (update, from, to) => swapView(update, { level: 'section', direction: directionOf(SECTIONS, from, to) }),
  })
  return (
    <>
      <PageHeader title={t.settings.title} />
      <PageTabs
        route="settings"
        value={target}
        tabs={[
          { value: 'network', label: t.settingsTabs.network, icon: SimCard },
          { value: 'traffic', label: t.settingsTabs.traffic, icon: ChartBar },
          { value: 'lan', label: t.settingsTabs.lan, icon: Network },
          { value: 'device', label: t.settingsTabs.device, icon: Cpu },
          { value: 'general', label: t.settingsTabs.general, icon: GearSix },
        ]}
      />
      <div key={section} className="ap-section" style={viewName(`ap-section-${section}`)}>
        {section === 'network' && <NetworkSection />}
        {section === 'traffic' && <TrafficSection />}
        {section === 'lan' && <LanSection />}
        {section === 'device' && <DeviceSection />}
        {section === 'general' && <GeneralSection />}
      </div>
    </>
  )
}
