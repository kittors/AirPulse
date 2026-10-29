import { useQuery, useQueryClient } from '@tanstack/react-query'

import { apnApi, planIpv6, supportsIpv6, type ApnState, type Ipv6Plan } from '@/api/apn'
import { useConfirm } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { useT, type Ipv6Change, type Messages } from '@/i18n'
import { createStore, useStore } from '@/lib/store'

import { switchesKey } from './switches'

export const apnKey = ['system', 'apn'] as const
export const apnQuery = { queryKey: apnKey, queryFn: apnApi.state }

/** 正在切换（等重新拨号）的目标值：放在模块里，设置页和总览的开关一起转圈，离开页面再回来也接着显示 */
const switchingStore = createStore<boolean | null>(null)

const RECONNECT_TIMEOUT_MS = 40_000
const POLL_MS = 2_000
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

function describe(plan: Exclude<Ipv6Plan, { kind: 'full' | 'unknown' }>, state: ApnState, on: boolean): Ipv6Change {
  const leavesAuto = state.mode === 'auto' && plan.kind !== 'auto'
  if (plan.kind === 'auto') return { action: 'auto', name: '', apn: '', on, leavesAuto }
  const { name, apn } = plan.draft
  const action = plan.kind === 'use' ? 'reuse' : plan.created ? 'copy' : 'edit'
  return { action, name, apn, on, leavesAuto }
}

/** 开关下面那一行状态：用的 IP 类型 + 实际拿没拿到 IPv6 地址 */
export function ipv6Caption(t: Messages, state: ApnState | undefined, target: boolean | null): string | null {
  if (target != null) return t.netSettings.ipv6Switching
  if (!state?.pdp) return null
  if (!supportsIpv6(state.pdp)) return t.netSettings.ipv6Off
  return state.link === 'ipv4' ? t.netSettings.ipv6NoAddress : t.netSettings.ipv6On
}

/**
 * IPv6 开关（做法见 model/apn 的 planIpv6）：确认框里写入 APN（失败就在框里报错），
 * 关掉确认框后等设备重新拨号、读回新的 IP 类型（最多约 40 s），期间开关停在目标位置转圈。
 */
export function useIpv6() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const apn = useQuery(apnQuery)
  const target = useStore(switchingStore)
  const state = apn.data
  const enabled = state?.pdp ? supportsIpv6(state.pdp) : null

  /** 重新拨号要先断开再连上：看到断开（或读到的地址已经对得上）之后再认连上的状态 */
  const reconnect = async (on: boolean) => {
    const deadline = Date.now() + RECONNECT_TIMEOUT_MS
    let dropped = false
    while (Date.now() < deadline) {
      await wait(POLL_MS)
      const next = await apnApi.state().catch(() => null)
      if (!next) {
        dropped = true
        continue
      }
      queryClient.setQueryData(apnKey, next)
      if (next.link === 'busy' || next.link === 'down') {
        dropped = true
        continue
      }
      const hasV6 = next.link === 'dual' || next.link === 'ipv6'
      if (next.pdp && supportsIpv6(next.pdp) === on && (hasV6 === on || dropped)) return true
    }
    return false
  }

  const toggle = async (on: boolean) => {
    if (!state || target != null) return
    const plan = planIpv6(state, on)
    if (plan.kind === 'full') return void toast.error(t.netSettings.apnFull)
    if (plan.kind === 'unknown') return void toast.error(t.netSettings.ipv6Unknown)
    const ok = await confirm({
      tone: 'warning',
      title: on ? t.netSettings.ipv6OnTitle : t.netSettings.ipv6OffTitle,
      description: t.netSettings.ipv6Body(describe(plan, state, on)),
      confirmText: on ? t.common.turnOn : t.common.turnOff,
      onConfirm: () => apnApi.applyIpv6(plan),
    })
    if (!ok) return
    switchingStore.set(on)
    try {
      if (await reconnect(on)) toast.success(t.netSettings.ipv6Done(on))
      else toast.info(t.netSettings.ipv6Pending)
    } finally {
      switchingStore.set(null)
      void queryClient.invalidateQueries({ queryKey: apnKey })
      void queryClient.invalidateQueries({ queryKey: switchesKey })
      void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
    }
  }

  return {
    /** 设备当前的设置；读到之前为 null */
    enabled,
    /** 正在切换到的值（等重新拨号）；没在切换为 null */
    target,
    caption: ipv6Caption(t, state, target),
    /** 数据连接实际拿到的地址 */
    link: state?.link ?? null,
    ready: state != null,
    error: apn.isError,
    toggle,
  }
}
