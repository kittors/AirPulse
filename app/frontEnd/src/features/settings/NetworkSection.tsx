import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { atApi } from '@/api/at'
import { atSlotFor } from '@/api/device'
import { systemApi, truthy } from '@/api/system'
import { hrefOf } from '@/app/router'
import { ListGroup, ListRow } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/feedback'
import { SwitchRow } from '@/components/ui/form-rows'
import { SegmentedControl } from '@/components/ui/segmented'
import { toast } from '@/components/ui/toast'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { errorMessage } from '@/lib/errors'
import { isAtError } from '@/model/at'
import { versionInfoQuery } from '@/hooks/queries'

import { ApnGroup } from './ApnGroup'
import { useIpv6 } from './ipv6'
import { askReboot, switchesQuery, useDataSwitch, useSwitch } from './switches'
import { UsbGroup } from './UsbGroup'

/**
 * 网络：移动数据、漫游、SIM 卡槽；VoLTE / VoNR；APN；USB 网络协议。
 * 关闭移动数据会让所有终端断网，先确认；其余开关即点即生效。
 */
export function NetworkSection() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-6 gap-y-7 @4xl:grid-cols-2 @4xl:items-start">
        <div className="flex flex-col gap-7">
          <MobileGroup />
          <ImsGroup />
          <UsbGroup />
        </div>
        <ApnGroup />
      </div>
    </div>
  )
}

function MobileGroup() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  // 设备自己在拨号 / 断开（比如刚切换 SIM 卡）时轮询到状态稳定
  const switches = useQuery({ ...switchesQuery, refetchInterval: (q) => (q.state.data?.dataTransition ? 2_000 : false) })
  const version = useQuery(versionInfoQuery)
  const { data: telemetry } = useTelemetry()
  const data = useDataSwitch()
  const roaming = useSwitch('roaming', systemApi.setRoaming)
  const sim = useSwitch('simSlot', systemApi.setSimSlot)
  const ipv6 = useIpv6()
  if (!switches.data) {
    return (
      <ListGroup title={t.netSettings.mobileTitle} footer={t.netSettings.mobileFooter}>
        <div className="p-4">
          <Skeleton className="h-24" />
        </div>
      </ListGroup>
    )
  }
  const s = switches.data
  // 切换中：开关停在目标位置并转圈，副标题说明正在做什么
  const dataOn = data.isPending ? (data.variables ?? s.dataConnected) : s.dataConnected
  const transition = data.isPending ? (data.variables ? 'connecting' : 'disconnecting') : s.dataTransition
  const limited = telemetry?.traffic.reachedLimit === true && !dataOn
  // V50 有三张内置卡 + 外置卡槽；其它机型只在支持双卡时显示 SIM 1 / SIM 2
  const v50 = (version.data?.model ?? '').toLowerCase() === 'v50'
  const simLabels = v50 ? t.netSettings.simV50 : t.netSettings.simSlots
  const simKnown = s.simSlot in simLabels
  const switchSim = async (next: string) => {
    const ok = await confirm({ tone: 'warning', title: t.netSettings.simSwitchTitle(simLabels[next]), description: t.netSettings.simSwitchBody, confirmText: t.common.confirm })
    if (!ok) return
    sim.mutate(next, {
      onSuccess: () => {
        toast.success(t.netSettings.simSwitched)
        void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
      },
    })
  }
  return (
    <ListGroup title={t.netSettings.mobileTitle} footer={t.netSettings.mobileFooter}>
      <SwitchRow
        title={t.netSettings.data}
        subtitle={
          transition ? (
            transition === 'connecting' ? t.netSettings.dataConnecting : t.netSettings.dataDisconnecting
          ) : limited ? (
            // 流量阈值触发的断网：手动打开十秒左右又会被后端断开，先引导去调阈值
            <span className="text-warning-text">
              {t.netSettings.dataLimit}{' '}
              <a href={hrefOf('settings', 'traffic')} className="font-medium text-accent-text hover:underline">
                {t.netSettings.dataLimitAction}
              </a>
            </span>
          ) : (
            t.netSettings.dataHint
          )
        }
        checked={dataOn}
        loading={data.isPending || Boolean(s.dataTransition)}
        onCheckedChange={async (value) => {
          if (!value) {
            const ok = await confirm({ tone: 'danger', title: t.netSettings.dataOffTitle, description: t.netSettings.dataOffBody, confirmText: t.common.turnOff })
            if (!ok) return
          }
          data.mutate(value)
        }}
      />
      <SwitchRow title={t.netSettings.roaming} subtitle={t.netSettings.roamingHint} checked={s.roaming} onCheckedChange={(v) => roaming.mutate(v)} />
      <SwitchRow
        title={t.netSettings.ipv6}
        subtitle={ipv6.caption ?? (ipv6.error ? '—' : <span className="ap-skeleton inline-block h-[0.9em] w-24 align-[-0.1em]" aria-hidden />)}
        checked={ipv6.target ?? ipv6.enabled ?? false}
        loading={ipv6.target != null}
        disabled={ipv6.enabled == null}
        onCheckedChange={(v) => void ipv6.toggle(v)}
      />
      {(s.dualSim || v50) && (
        <ListRow
          title={t.netSettings.simSlot}
          subtitle={simKnown ? t.netSettings.simHint : t.netSettings.simUnknown(s.simSlot || '—')}
          trailing={
            <SegmentedControl
              size="sm"
              ariaLabel={t.netSettings.simSlot}
              value={simKnown ? s.simSlot : undefined}
              pending={sim.isPending}
              onChange={(next) => void switchSim(next)}
              options={Object.entries(simLabels).map(([value, label]) => ({ value, label }))}
            />
          }
        />
      )}
    </ListGroup>
  )
}

function useImsToggle(kind: 'volte' | 'vonr' | 'high-rail', slot: number) {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const key = ['system', kind, slot]
  return useMutation({
    mutationFn: async (value: boolean) => {
      if (kind === 'volte') return systemApi.setVolte(value, slot)
      if (kind === 'vonr') return systemApi.setVonr(value, slot)
      const result = await atApi.setHighRail(value, slot)
      if (isAtError(result)) throw new Error(result.trim() || 'ERROR')
      return result
    },
    onMutate: (value) => {
      const previous = queryClient.getQueryData(key)
      queryClient.setQueryData(key, kind === 'high-rail' ? value : { enabled: value })
      return { previous }
    },
    onSuccess: () => {
      if (kind === 'high-rail') toast.success(t.netSettings.highRailDone, { duration: 8_000, action: { label: t.netSettings.rebootNow, onClick: () => askReboot(confirm, t) } })
    },
    onError: (error, _value, context) => {
      queryClient.setQueryData(key, context?.previous)
      toast.error(t.common.operationFailed, { description: errorMessage(error) })
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: key }),
  })
}

/** VoLTE / VoNR / 高铁模式的查询选项（组件和分区预读共用） */
export const imsQueries = (slot: number) => ({
  volte: { queryKey: ['system', 'volte', slot] as const, queryFn: () => systemApi.volte(slot) },
  vonr: { queryKey: ['system', 'vonr', slot] as const, queryFn: () => systemApi.vonr(slot) },
  rail: { queryKey: ['system', 'high-rail', slot] as const, queryFn: () => atApi.highRail(slot), staleTime: 60_000 },
})

/** VoLTE / VoNR / 高铁模式都是对当前卡槽的基带设置（双卡时卡槽号与 AT 通道的映射见 atSlotFor） */
function ImsGroup() {
  const t = useT()
  const { data: telemetry } = useTelemetry()
  const slot = telemetry ? atSlotFor(telemetry) : 0
  const ready = telemetry != null
  const ims = imsQueries(slot)
  const volte = useQuery({ ...ims.volte, enabled: ready })
  const vonr = useQuery({ ...ims.vonr, enabled: ready })
  const rail = useQuery({ ...ims.rail, enabled: ready })
  const setVolte = useImsToggle('volte', slot)
  const setVonr = useImsToggle('vonr', slot)
  const setRail = useImsToggle('high-rail', slot)
  return (
    <ListGroup title={t.netSettings.imsTitle} footer={t.netSettings.imsFooter}>
      <SwitchRow title={t.netSettings.volte} checked={truthy(volte.data?.enabled)} disabled={!volte.data} onCheckedChange={(v) => setVolte.mutate(v)} />
      <SwitchRow title={t.netSettings.vonr} checked={truthy(vonr.data?.enabled)} disabled={!vonr.data} onCheckedChange={(v) => setVonr.mutate(v)} />
      <SwitchRow
        title={t.netSettings.highRail}
        subtitle={t.netSettings.highRailHint}
        checked={rail.data === true}
        disabled={rail.data == null}
        loading={setRail.isPending}
        onCheckedChange={(v) => setRail.mutate(v)}
      />
    </ListGroup>
  )
}
