import { Warning } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useState } from 'react'

import { radioApi } from '@/api/radio'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/card'
import { ToggleChip } from '@/components/ui/chip'
import { useConfirm } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/feedback'
import { Tooltip } from '@/components/ui/overlay'
import { toast } from '@/components/ui/toast'
import { radioKeys, useBandLock, useNrBands } from '@/hooks/useRadio'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { bandLabel, LTE_BANDS, LTE_LOCKABLE_BANDS, NR_BANDS, NR_FALLBACK_BANDS, type BandInfo } from '@/lib/bands'
import { cn } from '@/lib/cn'
import { collapse } from '@/lib/motion'
import { storage } from '@/lib/storage'

type Tech = 'NR' | 'LTE'
type Group = 'low' | 'mid' | 'high' | 'other'

const NONE: ReadonlySet<number> = new Set()

/** 上次从设备读到的 5G 支持列表：读新列表期间先按它排版，数据回来版面基本不动 */
const NR_CACHE_KEY = 'nr-bands'
function cachedNrBands(): number[] | null {
  const value = storage.get<unknown>(NR_CACHE_KEY, null)
  return Array.isArray(value) && value.length > 0 && value.every(Number.isInteger) ? (value as number[]) : null
}

/** 按下行频率分组：1 GHz 以下低频（覆盖广），3 GHz 以上高频（速度快），中间中频 */
function groupOf(info: BandInfo | undefined): Group {
  const low = info ? Number.parseFloat(info.range) : Number.NaN
  if (!Number.isFinite(low)) return 'other'
  if (low < 1000) return 'low'
  if (low < 3000) return 'mid'
  return 'high'
}

/**
 * 频段锁：5G / 4G 各一组芯片，组内按低 / 中 / 高频分行并写明用途，选哪个频段一看就懂。
 * 语义与原版一致——全选即不锁；应用 = 两次写入 + 重启协议栈（断网 5–10 秒），所以先确认。
 * 有改动时卡片底部才出现「还原 / 应用」，每个制式至少保留一个频段。
 */
export function BandLock({ className }: { className?: string }) {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const lock = useBandLock()
  const nrSupported = useNrBands()
  const { data: telemetry } = useTelemetry()

  const options: Record<Tech, number[]> = useMemo(
    () => ({
      NR: nrSupported.data ?? (nrSupported.isPending ? cachedNrBands() : null) ?? [...NR_FALLBACK_BANDS],
      LTE: [...LTE_LOCKABLE_BANDS],
    }),
    [nrSupported.data, nrSupported.isPending],
  )
  useEffect(() => {
    if (nrSupported.data?.length) storage.set(NR_CACHE_KEY, nrSupported.data)
  }, [nrSupported.data])

  // 等基带支持列表落定再出草稿（读的这段时间芯片先按上次的列表排好、不可点，见下）
  const device = useMemo(() => {
    if (!lock.data || nrSupported.isPending) return null
    const pick = (tech: Tech, values: number[]) => {
      const allowed = values.filter((band) => options[tech].includes(band))
      return new Set(allowed.length ? allowed : options[tech])
    }
    return { NR: pick('NR', lock.data.nr), LTE: pick('LTE', lock.data.lte) }
  }, [lock.data, nrSupported.isPending, options])

  const [draft, setDraft] = useState<Record<Tech, Set<number>> | null>(null)
  useEffect(() => {
    if (device) setDraft({ NR: new Set(device.NR), LTE: new Set(device.LTE) })
  }, [device])

  const live = useMemo(
    () => ({ NR: new Set(telemetry?.nr?.bands ?? []), LTE: new Set(telemetry?.lte?.bands ?? []) }),
    [telemetry?.nr?.bands, telemetry?.lte?.bands],
  )

  const apply = useMutation({
    mutationFn: (bands: Record<Tech, number[]>) => radioApi.applyBandLock(bands.LTE, bands.NR),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: radioKeys.bandLock })
      void queryClient.invalidateQueries({ queryKey: radioKeys.cells })
    },
  })

  const changes =
    device && draft
      ? (['NR', 'LTE'] as const).reduce(
          (sum, tech) => sum + options[tech].filter((band) => draft[tech].has(band) !== device[tech].has(band)).length,
          0,
        )
      : 0
  const lockedCount = device
    ? (['NR', 'LTE'] as const).reduce((sum, tech) => sum + (device[tech].size === options[tech].length ? 0 : device[tech].size), 0)
    : 0
  const emptyTech = draft ? (['NR', 'LTE'] as const).find((tech) => draft[tech].size === 0) : undefined
  const ready = device !== null && draft !== null

  const submit = async (bands: Record<Tech, number[]>, unlock: boolean) => {
    const ok = await confirm({
      tone: 'warning',
      title: unlock ? t.radio.unlockConfirmTitle : t.radio.bandsConfirmTitle,
      description: unlock ? t.radio.unlockConfirmBody : t.radio.bandsConfirmBody,
      confirmText: unlock ? t.radio.unlockAll : t.radio.apply,
    })
    if (!ok) return
    try {
      const result = await toast.promise(apply.mutateAsync(bands), {
        loading: t.radio.applying,
        success: t.radio.applied,
        error: t.common.operationFailed,
      })
      if (!result.lteOk) toast.warning(t.radio.partial(t.radio.lteBands))
      if (!result.nrOk) toast.warning(t.radio.partial(t.radio.nrBands))
    } catch {
      /* 错误已由 toast.promise 展示 */
    }
  }

  const toggle = (tech: Tech, band: number) =>
    setDraft((prev) => {
      if (!prev) return prev
      const next = new Set(prev[tech])
      if (next.has(band)) next.delete(band)
      else next.add(band)
      return { ...prev, [tech]: next }
    })
  const setAll = (tech: Tech, on: boolean) => setDraft((prev) => (prev ? { ...prev, [tech]: new Set(on ? options[tech] : []) } : prev))

  return (
    <Panel className={cn('flex flex-col', className)}>
      <PanelHeader
        title={t.radio.bandsTitle}
        detail={device ? (lockedCount ? t.radio.bandsLocked(lockedCount) : t.radio.bandsUnlocked) : undefined}
        action={
          lockedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-accent-text"
              disabled={apply.isPending}
              onClick={() => void submit({ NR: options.NR, LTE: options.LTE }, true)}
            >
              {t.radio.unlockAll}
            </Button>
          )
        }
      />

      {/* 数据回来之前也按真实布局排好芯片（不选中、不可点），回来后只是亮起选中态，卡片高度不变 */}
      <div className="flex flex-col gap-6" aria-busy={!ready || undefined}>
        {(['NR', 'LTE'] as const).map((tech) => (
          <BandGroup
            key={tech}
            tech={tech}
            options={options[tech]}
            selected={ready ? draft[tech] : NONE}
            device={ready ? device[tech] : NONE}
            live={live[tech]}
            loading={!ready}
            disabled={apply.isPending}
            onToggle={(band) => toggle(tech, band)}
            onAll={(on) => setAll(tech, on)}
          />
        ))}
        {nrSupported.isError && <p className="text-caption text-text-3">{t.radio.nrFallback}</p>}
      </div>

      <AnimatePresence initial={false}>
        {draft && device && changes > 0 && (
          <motion.div {...collapse} className="overflow-hidden">
            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-line pt-4">
              {emptyTech ? (
                <span className="flex min-w-0 items-center gap-1.5 text-footnote font-medium text-warning-text">
                  <Warning className="size-4 shrink-0" weight="fill" />
                  {t.radio.atLeastOne(emptyTech === 'NR' ? t.radio.nrBands : t.radio.lteBands)}
                </span>
              ) : (
                <span className="text-footnote text-text-2">{t.radio.changesPending(changes)}</span>
              )}
              <div className="ml-auto flex gap-2 max-sm:w-full max-sm:[&>*]:flex-1">
                <Button
                  variant="secondary"
                  disabled={apply.isPending}
                  onClick={() => setDraft({ NR: new Set(device.NR), LTE: new Set(device.LTE) })}
                >
                  {t.radio.revert}
                </Button>
                <Button
                  variant="primary"
                  loading={apply.isPending}
                  disabled={Boolean(emptyTech)}
                  onClick={() =>
                    void submit(
                      {
                        NR: options.NR.filter((band) => draft.NR.has(band)),
                        LTE: options.LTE.filter((band) => draft.LTE.has(band)),
                      },
                      false,
                    )
                  }
                >
                  {t.radio.apply}
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  )
}

function BandGroup({
  tech,
  options,
  selected,
  device,
  live,
  loading,
  disabled,
  onToggle,
  onAll,
}: {
  tech: Tech
  options: number[]
  selected: ReadonlySet<number>
  device: ReadonlySet<number>
  live: Set<number>
  loading: boolean
  disabled: boolean
  onToggle: (band: number) => void
  onAll: (on: boolean) => void
}) {
  const t = useT()
  const table = tech === 'NR' ? NR_BANDS : LTE_BANDS
  const all = selected.size === options.length
  const groups = (['low', 'mid', 'high', 'other'] as const)
    .map((group) => ({ group, bands: options.filter((band) => groupOf(table[band]) === group) }))
    .filter((entry) => entry.bands.length > 0)
  return (
    <section>
      <div className="flex h-7 items-center gap-2">
        <h3 className="text-[14px] font-semibold text-text">{tech === 'NR' ? t.radio.nrBands : t.radio.lteBands}</h3>
        {loading ? (
          <Skeleton className="h-3 w-12" />
        ) : (
          <span className="num text-caption text-text-3">{t.radio.selectedOf(selected.size, options.length)}</span>
        )}
        <button
          type="button"
          disabled={disabled || loading}
          onClick={() => onAll(!all)}
          className={cn(
            'ml-auto rounded-[6px] px-1.5 py-0.5 text-footnote font-medium text-accent-text transition-opacity hover:opacity-75 disabled:opacity-40',
            loading && 'invisible',
          )}
        >
          {all ? t.common.deselectAll : t.common.selectAll}
        </button>
      </div>
      <div className="mt-2.5 flex flex-col gap-3">
        {groups.map(({ group, bands }) => (
          <div key={group} className="flex gap-4 max-sm:flex-col max-sm:gap-1.5">
            <div className="w-[92px] shrink-0 pt-[7px] max-sm:w-auto max-sm:pt-0">
              <p className="text-caption leading-[18px] font-medium text-text-2">{t.radio.bandGroups[group]}</p>
              {t.radio.bandGroupHints[group] && (
                <p className="text-[11px] leading-[14px] text-text-4 max-sm:hidden">{t.radio.bandGroupHints[group]}</p>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {bands.map((band) => {
                const info = table[band] as BandInfo | undefined
                const pressed = selected.has(band)
                const isLive = live.has(band)
                return (
                  <Tooltip key={band} content={<BandTip tech={tech} band={band} info={info} live={isLive} />}>
                    <ToggleChip
                      pressed={pressed}
                      live={isLive}
                      dirty={pressed !== device.has(band)}
                      disabled={disabled || loading}
                      onPressedChange={() => onToggle(band)}
                    >
                      {bandLabel(tech, band)}
                    </ToggleChip>
                  </Tooltip>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

/** 频段说明气泡：频段号 · 双工 · 频率范围，国内运营商，是否正驻留 */
function BandTip({ tech, band, info, live }: { tech: Tech; band: number; info?: BandInfo; live: boolean }) {
  const t = useT()
  return (
    <span className="flex flex-col gap-0.5">
      <span className="num font-semibold">
        {bandLabel(tech, band)}
        {info && ` · ${info.duplex} · ${info.range} MHz`}
      </span>
      {info && info.carriers.length > 0 && <span>{info.carriers.map((code) => t.network.carriers[code]).join(' / ')}</span>}
      {live && <span className="opacity-80">● {t.radio.liveBand}</span>}
    </span>
  )
}
