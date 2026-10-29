import { ArrowsDownUp, CaretUpDown, CellTower, CircleNotch, GlobeSimple, Lightning, WifiHigh, Warning, type Icon } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import type { ComponentProps, ReactNode } from 'react'

import { BEARER_PREFERENCES, RISKY_PREFERENCES } from '@/api/radio'
import type { BearerPreference } from '@/api/types'
import { Panel } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from '@/components/ui/overlay'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'

import { useWifiPower } from '../hotspot/wifiPower'
import { useNetMode } from '../radio/netMode'
import { useIpv6 } from '../settings/ipv6'
import { switchesQuery, useDataSwitch, usePerformanceMode } from '../settings/switches'

/**
 * 快捷开关：常切的几项放在总览上，点一下就切（学 iOS 控制中心的「开就点亮」，但用平铺的小块，不做装饰）。
 * 每一块的行为和设置页里对应的开关完全一样：会断网的先确认，切换中转圈，等设备真正生效再落定。
 */
export function QuickControls({ className }: { className?: string }) {
  const t = useT()
  return (
    <Panel className={cn('@container', className)}>
      <div className="flex h-5 items-center text-footnote font-medium text-text-2">{t.overview.quickTitle}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 @lg:grid-cols-3 @3xl:grid-cols-5">
        <DataTile />
        <WifiTile />
        <PerformanceTile />
        <Ipv6Tile />
        <ModeTile className="col-span-2 @3xl:col-span-1" />
      </div>
    </Panel>
  )
}

function DataTile() {
  const t = useT()
  const confirm = useConfirm()
  const { data: telemetry } = useTelemetry()
  const data = useDataSwitch()
  const live = telemetry?.dataState
  // 切换中按要去的方向显示；平时看遥测（每两秒一次，别处断开 / 流量阈值断网也能及时反映）
  const transition = data.isPending ? (data.variables ? 'connecting' : 'disconnecting') : live === 'connecting' || live === 'disconnecting' ? live : null
  const on = transition ? transition === 'connecting' : live === 'connected'
  const state =
    transition === 'connecting'
      ? t.netSettings.dataConnecting
      : transition === 'disconnecting'
        ? t.netSettings.dataDisconnecting
        : on
          ? t.overview.quick.connected
          : t.overview.quick.disconnected
  return (
    <Tile
      icon={ArrowsDownUp}
      label={t.overview.quick.data}
      state={live == null || live === 'unknown' ? null : state}
      active={on}
      busy={transition != null}
      onToggle={async () => {
        if (on) {
          const ok = await confirm({ tone: 'danger', title: t.netSettings.dataOffTitle, description: t.netSettings.dataOffBody, confirmText: t.common.turnOff })
          if (!ok) return
        }
        data.mutate(!on)
      }}
    />
  )
}

function WifiTile() {
  const t = useT()
  const { band, on, switching, labels, toggle } = useWifiPower()
  const target = switching ? switching.to !== 'off' : on
  const state = switching
    ? { on: t.hotspot.turningOn, off: t.hotspot.turningOff, band: t.hotspot.switchingBand }[switching.kind]
    : band === undefined
      ? null
      : band === 'off'
        ? t.overview.quick.off
        : labels[band]
  return <Tile icon={WifiHigh} label={t.overview.quick.wifi} state={state} active={target} busy={switching != null} onToggle={() => void toggle(!on)} />
}

function PerformanceTile() {
  const t = useT()
  const switches = useQuery(switchesQuery)
  const performance = usePerformanceMode()
  const on = switches.data?.performanceMode ?? false
  return (
    <Tile
      icon={Lightning}
      label={t.overview.quick.performance}
      state={switches.data ? (on ? t.overview.quick.on : t.overview.quick.off) : null}
      active={on}
      busy={performance.pending}
      onToggle={() => performance.set(!on)}
    />
  )
}

function Ipv6Tile() {
  const t = useT()
  const ipv6 = useIpv6()
  const on = ipv6.target ?? ipv6.enabled ?? false
  const state =
    ipv6.target != null
      ? t.overview.quick.ipv6Switching
      : ipv6.enabled == null
        ? ipv6.error
          ? '—'
          : null
        : !ipv6.enabled
          ? t.overview.quick.ipv6Off
          : ipv6.link === 'ipv4'
            ? t.overview.quick.ipv6NoAddress
            : t.overview.quick.ipv6On
  return (
    <Tile
      icon={GlobeSimple}
      label={t.overview.quick.ipv6}
      state={state}
      active={on}
      busy={ipv6.target != null}
      disabled={ipv6.enabled == null}
      onToggle={() => void ipv6.toggle(!on)}
    />
  )
}

function ModeTile({ className }: { className?: string }) {
  const t = useT()
  const { current, selected, pending, choose } = useNetMode()
  const state = pending ? t.overview.quick.modeSwitching : selected ? t.radio.modes[selected].label : current.isError ? '—' : null
  return (
    <Menu>
      <MenuTrigger asChild disabled={current.isPending}>
        <TileFrame className={className} aria-label={t.overview.quick.mode}>
          <TileIcon icon={CellTower} tone="neutral" busy={pending != null} />
          <TileText label={t.overview.quick.mode} state={state} />
          <CaretUpDown className="size-3.5 shrink-0 text-text-3" weight="bold" aria-hidden />
        </TileFrame>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-60">
        <MenuRadioGroup value={selected ?? ''} onValueChange={(value) => void choose(value as BearerPreference)}>
          {BEARER_PREFERENCES.map((value) => (
            <MenuRadioItem key={value} value={value} className="py-1.5">
              <span className="flex min-w-0 flex-col">
                <span>{t.radio.modes[value].label}</span>
                <span className="flex items-center gap-1 text-caption text-text-3">
                  {RISKY_PREFERENCES.has(value) && <Warning className="!size-3 shrink-0 !text-warning" weight="fill" aria-hidden />}
                  {t.radio.modes[value].hint}
                </span>
              </span>
            </MenuRadioItem>
          ))}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  )
}

/* —— 小块 —— */

function Tile({
  icon,
  label,
  state,
  active,
  busy,
  disabled,
  onToggle,
}: {
  icon: Icon
  label: string
  /** 读到状态之前为 null（显示占位条） */
  state: ReactNode | null
  active: boolean
  busy: boolean
  disabled?: boolean
  onToggle: () => void
}) {
  return (
    <TileFrame
      role="switch"
      aria-checked={active}
      aria-busy={busy || undefined}
      aria-label={label}
      disabled={disabled || busy || state == null}
      onClick={onToggle}
    >
      <TileIcon icon={icon} tone={active ? 'on' : 'off'} busy={busy} />
      <TileText label={label} state={state} />
    </TileFrame>
  )
}

function TileFrame({ className, ...props }: ComponentProps<'button'>) {
  return (
    <button
      type="button"
      className={cn(
        'ap-press flex min-h-[60px] min-w-0 items-center gap-3 rounded-inner bg-sunken py-2.5 pr-3 pl-2.5 text-left',
        'outline-offset-2 hover:bg-[color-mix(in_oklab,var(--color-sunken),var(--color-text)_4%)]',
        'disabled:cursor-default disabled:hover:bg-sunken data-[state=open]:bg-[color-mix(in_oklab,var(--color-sunken),var(--color-text)_6%)]',
        className,
      )}
      {...props}
    />
  )
}

function TileIcon({ icon: IconComponent, tone, busy }: { icon: Icon; tone: 'on' | 'off' | 'neutral'; busy: boolean }) {
  return (
    <span
      className={cn(
        'grid size-9 shrink-0 place-items-center rounded-full transition-colors duration-200',
        tone === 'on' && 'bg-accent-solid text-on-accent',
        tone === 'off' && 'bg-[rgb(120_120_128/0.16)] text-text-2 dark:bg-[rgb(120_120_128/0.32)]',
        tone === 'neutral' && 'bg-accent-soft text-accent',
      )}
      aria-hidden
    >
      {busy ? <CircleNotch className="ap-spin size-[18px]" weight="bold" /> : <IconComponent className="size-[18px]" weight={tone === 'off' ? 'regular' : 'fill'} />}
    </span>
  )
}

function TileText({ label, state }: { label: string; state: ReactNode | null }) {
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-footnote font-semibold text-text">{label}</span>
      <span className="block truncate text-caption text-text-3">
        {state ?? <span className="ap-skeleton inline-block h-[0.85em] w-14 align-[-0.1em]" aria-hidden />}
      </span>
    </span>
  )
}
