import { useMutation, useQueryClient } from '@tanstack/react-query'

import { radioApi, RISKY_PREFERENCES } from '@/api/radio'
import type { BearerPreference } from '@/api/types'
import { useConfirm } from '@/components/ui/dialog'
import { toast } from '@/components/ui/toast'
import { radioKeys, useNetSelect } from '@/hooks/useRadio'
import { useT } from '@/i18n'
import { createStore, useStore } from '@/lib/store'

/** 正在切换到的模式：放在模块里，射频页的列表和总览的快捷开关一起显示「切换中」 */
const pendingStore = createStore<BearerPreference | null>(null)

/**
 * 选网模式的切换（射频页的单选列表、总览的快捷开关共用）：
 * 会断网的模式先确认；点了立即显示目标并转圈，失败自动回到原来的选项。
 */
export function useNetMode() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const current = useNetSelect()
  const pending = useStore(pendingStore)

  const mutation = useMutation({
    mutationFn: (value: BearerPreference) => radioApi.setNetSelect(value),
    onMutate: (value) => pendingStore.set(value),
    onSettled: () => {
      pendingStore.set(null)
      void queryClient.invalidateQueries({ queryKey: radioKeys.netSelect })
      void queryClient.invalidateQueries({ queryKey: ['qos'] })
    },
  })

  const choose = async (value: BearerPreference) => {
    if (value === current.data || pendingStore.get()) return
    const label = t.radio.modes[value].label
    if (RISKY_PREFERENCES.has(value)) {
      const ok = await confirm({
        tone: 'warning',
        title: t.radio.riskyTitle(label),
        description: t.radio.riskyBody,
        confirmText: t.radio.switchNow,
      })
      if (!ok) return
    }
    await toast
      .promise(mutation.mutateAsync(value), {
        loading: t.radio.switching,
        success: t.radio.switched(label),
        error: t.common.operationFailed,
      })
      .catch(() => undefined)
  }

  return {
    current,
    /** 界面上打勾的那项：切换中显示目标 */
    selected: pending ?? current.data ?? undefined,
    pending,
    choose,
  }
}
