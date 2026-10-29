import { useMutation, useQueryClient } from '@tanstack/react-query'

import { systemApi, type DeviceSwitches } from '@/api/system'
import { patched, settle } from '@/app/pending'
import { useConfirm } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { useT, type Messages } from '@/i18n'
import { errorMessage } from '@/lib/errors'

/**
 * 设备与网络开关的共用读写（设置页、热点页、总览的快捷开关都用）。
 * 单独放一个模块：总览只引这些，不用把整个设置页一起加载进来。
 */

export const switchesKey = ['system', 'switches'] as const
/** 同一个 key 的 useQuery 共用这份选项：开关的读取要带「等生效」补丁（见 app/pending.ts） */
export const switchesQuery = { queryKey: switchesKey, queryFn: patched(switchesKey, systemApi.switches) }

/**
 * 开关类设置的通用写法：即点即生效（缓存里先放目标值），写完等设备读回目标值再收尾，开关不会闪回旧位置；
 * 写入失败回到真实状态并提示；等不到（设备没生效）也回到真实状态并提示。
 */
export function useSwitch<K extends keyof DeviceSwitches>(key: K, write: (value: DeviceSwitches[K]) => Promise<unknown>) {
  const t = useT()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (value: DeviceSwitches[K]) =>
      settle(queryClient, switchesKey, {
        patch: (s: DeviceSwitches) => ({ ...s, [key]: value }),
        write: () => write(value),
        read: systemApi.switches,
        reached: (s) => s[key] === value,
        timeout: 8_000,
        interval: 700,
      }),
    onSuccess: (settled) => {
      if (!settled) toast.warning(t.common.notApplied)
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })
}

export function askReboot(confirm: ReturnType<typeof useConfirm>, t: Messages) {
  void confirm({
    tone: 'danger',
    title: t.device.rebootTitle,
    description: t.device.rebootBody,
    confirmText: t.device.reboot,
    onConfirm: () => systemApi.reboot(),
  }).then((ok) => ok && toast.info(t.device.rebooting))
}

/** 性能模式：设备重启后才真正切换（原版的提示也是「重启生效」），写完给一个「立即重启」 */
export function usePerformanceMode() {
  const t = useT()
  const confirm = useConfirm()
  const mutation = useSwitch('performanceMode', systemApi.setPerformanceMode)
  const set = (value: boolean) =>
    mutation.mutate(value, {
      onSuccess: (settled) => {
        if (!settled) return
        toast.success(t.device.performanceDone(value), {
          description: t.device.performanceReboot,
          duration: 8_000,
          action: { label: t.netSettings.rebootNow, onClick: () => askReboot(confirm, t) },
        })
      },
    })
  return { set, pending: mutation.isPending }
}

const DATA_SETTLE_TRIES = 10
const DATA_SETTLE_MS = 1_500
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/**
 * 移动数据：拨号 / 断开要几秒，写完立刻读多半还是旧状态或「连接中」。
 * 等状态稳定到目标值再结束（最多约 15 s），期间界面停在目标位置；超时也不算失败，提示稍后再看。
 */
export function useDataSwitch() {
  const t = useT()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (connected: boolean) => {
      await queryClient.cancelQueries({ queryKey: switchesKey })
      await systemApi.setData(connected)
      for (let i = 0; i < DATA_SETTLE_TRIES; i++) {
        await wait(DATA_SETTLE_MS)
        const next = await systemApi.switches().catch(() => null)
        if (next && !next.dataTransition && next.dataConnected === connected) {
          queryClient.setQueryData(switchesKey, next)
          return true
        }
      }
      return false
    },
    onSuccess: (settled) => {
      if (!settled) toast.warning(t.netSettings.dataPending)
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: switchesKey })
      void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
    },
  })
}
