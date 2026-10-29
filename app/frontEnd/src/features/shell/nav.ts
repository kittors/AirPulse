import { CellTower, ChatCircleDots, Gauge, GearSix, Toolbox, WifiHigh, type Icon } from '@phosphor-icons/react'

import type { RouteId } from '@/app/router'
import type { Messages } from '@/i18n'

export interface NavItem {
  id: RouteId
  icon: Icon
  label: (t: Messages) => string
  /** 移动端 Dock 直接展示；其余收进「更多」 */
  primary: boolean
}

export const NAV: NavItem[] = [
  { id: 'overview', icon: Gauge, label: (t) => t.nav.overview, primary: true },
  { id: 'radio', icon: CellTower, label: (t) => t.nav.radio, primary: true },
  { id: 'hotspot', icon: WifiHigh, label: (t) => t.nav.hotspot, primary: true },
  { id: 'messages', icon: ChatCircleDots, label: (t) => t.nav.messages, primary: true },
  { id: 'tools', icon: Toolbox, label: (t) => t.nav.tools, primary: false },
  { id: 'settings', icon: GearSix, label: (t) => t.nav.settings, primary: false },
]

export const PAGE_META: Record<RouteId, (t: Messages) => { title: string; subtitle: string }> = {
  overview: (t) => ({ title: t.overview.title, subtitle: t.overview.subtitle }),
  radio: (t) => ({ title: t.radio.title, subtitle: t.radio.subtitle }),
  hotspot: (t) => ({ title: t.nav.hotspot, subtitle: '' }),
  messages: (t) => ({ title: t.nav.messages, subtitle: '' }),
  tools: (t) => ({ title: t.tools.title, subtitle: '' }),
  settings: (t) => ({ title: t.settings.title, subtitle: t.settings.subtitle }),
}
