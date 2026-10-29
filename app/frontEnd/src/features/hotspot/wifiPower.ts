import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'

import { bandOf, hotspotApi, withBand, type WifiBand, type WifiInfo } from '@/api/hotspot'
import { settle } from '@/app/pending'
import { useConfirm } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { isApiError } from '@/lib/errors'
import { storage } from '@/lib/storage'
import { createStore, useStore } from '@/lib/store'

import { clientsKey, clientsQuery, wifiKey, wifiQuery } from './queries'

/**
 * Wi-Fi 总开关与频段切换（热点页的 Wi-Fi 卡片、总览的快捷开关共用）。
 * 会让 Wi-Fi 断开的操作都先确认；如果浏览器本身就是经这个 Wi-Fi 接入的，确认里明确说「页面会断开」。
 */

/** 最近一次在用的频段：重新打开 Wi-Fi 时沿用；从没见过就用兼容性最好的 2.4 GHz */
const LAST_BAND_KEY = 'wifi-last-band'
export type OnBand = Exclude<WifiBand, 'off'>
export const lastBand = (): OnBand => (storage.get<WifiBand>(LAST_BAND_KEY, 'chip1') === 'chip2' ? 'chip2' : 'chip1')

/** 正在进行的 Wi-Fi 切换（等设备真正生效）：放在模块里，离开页面再回来也接着显示「正在…」 */
const switchingStore = createStore<{ to: WifiBand; kind: 'on' | 'off' | 'band' } | null>(null)

/** 浏览器是不是经这台设备的 Wi-Fi 接入的 */
export function useViaWifi(): boolean {
  const { data: telemetry } = useTelemetry()
  const clients = useQuery(clientsQuery)
  const clientIp = telemetry?.device.clientIp ?? null
  return Boolean(clientIp && clients.data?.clients.some((c) => c.via === 'wifi' && c.ip === clientIp))
}

export function useWifiPower() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const wifi = useQuery(wifiQuery)
  const switching = useStore(switchingStore)
  const viaWifi = useViaWifi()
  // 切换期间缓存里已经是目标状态（补丁），开关、频段都直接按它显示，不会闪回旧状态
  const band = wifi.data ? bandOf(wifi.data) : undefined
  const labels: Record<OnBand, string> = { chip1: t.hotspot.ghz24, chip2: t.hotspot.ghz5 }

  useEffect(() => {
    if (band && band !== 'off') storage.set(LAST_BAND_KEY, band)
  }, [band])

  const apply = async (next: WifiBand, kind: 'on' | 'off' | 'band', done: string) => {
    switchingStore.set({ to: next, kind })
    try {
      // 接口先回成功、设备两三秒后才真正切换：等读到目标状态再收尾
      const ok = await settle(queryClient, wifiKey, {
        patch: (info: WifiInfo) => withBand(info, next),
        write: () => hotspotApi.setBand(next),
        read: hotspotApi.wifi,
        reached: (info) => bandOf(info) === next,
        timeout: 30_000,
      })
      if (ok) toast.success(done)
      else toast.info(t.hotspot.notSettled)
    } catch (error) {
      // 经 Wi-Fi 访问时请求会随断线超时：按「可能已生效」处理
      if (isApiError(error, 'timeout') || isApiError(error, 'network')) toast.info(t.hotspot.maybeApplied)
      else toast.error(t.common.operationFailed)
    } finally {
      switchingStore.set(null)
      void queryClient.invalidateQueries({ queryKey: clientsKey })
    }
  }

  const toggle = async (on: boolean) => {
    if (switchingStore.get()) return
    if (on) return apply(lastBand(), 'on', t.hotspot.turnedOn)
    const ok = await confirm({
      tone: 'danger',
      title: t.hotspot.offTitle,
      description: `${t.hotspot.offBody}${viaWifi ? ` ${t.hotspot.offViaWifi}` : ''}`,
      confirmText: t.common.turnOff,
    })
    if (ok) await apply('off', 'off', t.hotspot.turnedOff)
  }

  const switchBand = async (next: OnBand) => {
    if (next === band || switchingStore.get()) return
    const ok = await confirm({
      tone: 'warning',
      title: t.hotspot.switchTitle(labels[next]),
      description: `${t.hotspot.switchBody}${viaWifi ? ` ${t.hotspot.viaWifiWarn}` : ''}`,
      confirmText: t.common.confirm,
    })
    if (ok) await apply(next, 'band', t.hotspot.switched)
  }

  return {
    wifi,
    band,
    on: band !== undefined && band !== 'off',
    switching,
    viaWifi,
    labels,
    toggle,
    switchBand,
  }
}
