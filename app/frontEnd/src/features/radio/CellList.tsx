import { Broadcast, CaretRight, Crosshair, LockSimple, PencilSimpleLine } from '@phosphor-icons/react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'motion/react'
import { useRef, useState, type FormEvent } from 'react'

import { radioApi } from '@/api/radio'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Callout, EmptyState, Skeleton } from '@/components/ui/feedback'
import { Field, IntegerInput } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { LevelScale, SIGNAL_GRADIENT } from '@/components/viz/level-scale'
import { radioKeys, useCells } from '@/hooks/useRadio'
import { useStickyOrder } from '@/hooks/useStickyOrder'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { bandLabel, earfcnToMHz, techOfEarfcn } from '@/lib/bands'
import { cn } from '@/lib/cn'
import { collapse, spring } from '@/lib/motion'
import { overallQuality, positionIn, qualityOf, RANGES, THRESHOLDS, type Metric } from '@/lib/signal'
import { cellKey } from '@/model/cells'
import type { ServingCell, Tech } from '@/model/telemetry'

import { QUALITY_DOT, QUALITY_TEXT, Quantity } from '../overview/parts'

interface Target {
  tech: Tech
  pci: number
  earfcn: number
  band?: number | null
}

interface Row extends Target {
  key: string
  band: number | null
  rsrp: number | null
  rsrq: number | null
  sinr: number | null
  serving: boolean
}

const PCI_MAX: Record<Tech, number> = { LTE: 503, NR: 1007 }
/** 列：小区 / PCI·频点 / 信号强度 / RSRQ / SINR / 箭头 */
const COLUMNS = '@2xl:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)_minmax(0,2.2fr)_72px_72px_16px]'
const techTag = (tech: Tech) => (tech === 'NR' ? '5G' : '4G')
const describe = (cell: Target) => `${techTag(cell.tech)}${cell.band ? ` ${bandLabel(cell.tech, cell.band)}` : ''} · PCI ${cell.pci} · ${cell.earfcn}`

/**
 * 周边小区：当前驻留的小区固定在第一行，邻区按信号强弱排下来（粘滞排序：信号明显更强才换位，不来回跳）。
 * 列表只负责「看」——点一行打开详情，在详情里锁定；已锁定的小区在顶部一条里，一键解除。
 */
export function CellList({ className }: { className?: string }) {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [live, setLive] = useState(true)
  const [detail, setDetail] = useState<Row | null>(null)
  const [manualOpen, setManualOpen] = useState(false)
  const cells = useCells(live)
  const { data: telemetry } = useTelemetry()

  const lockMutation = useMutation({
    mutationFn: (target: Target) => radioApi.lockCell(target),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: radioKeys.cells }),
  })
  const unlockMutation = useMutation({
    mutationFn: () => radioApi.unlockAllCells(),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: radioKeys.cells }),
  })
  const busy = lockMutation.isPending || unlockMutation.isPending

  const lock = async (target: Target) => {
    const ok = await confirm({
      tone: 'warning',
      title: t.radio.lockConfirmTitle(describe(target)),
      description: t.radio.lockConfirmBody,
      confirmText: t.radio.lockCell,
    })
    if (!ok) return false
    try {
      await toast.promise(lockMutation.mutateAsync(target), { loading: t.radio.locking, success: t.radio.lockedToast, error: t.common.operationFailed })
      return true
    } catch {
      return false
    }
  }

  const unlockAll = async () => {
    const ok = await confirm({
      title: t.radio.unlockCellsConfirmTitle,
      description: t.radio.unlockCellsConfirmBody,
      confirmText: t.radio.unlock,
    })
    if (!ok) return
    await toast
      .promise(unlockMutation.mutateAsync(), { loading: t.radio.unlocking, success: t.radio.unlockedToast, error: t.common.operationFailed })
      .catch(() => undefined)
  }

  const locked = cells.data?.locked ?? []
  const lockedKeys = new Set(locked.map((cell) => cell.key))
  const serving = [telemetry?.nr, telemetry?.lte].filter(
    (cell): cell is ServingCell & { pci: number; earfcn: number } => cell?.pci != null && cell.earfcn != null,
  )
  const servingKeys = new Set(serving.map((cell) => cellKey(cell.pci, cell.earfcn)))
  const neighbors = useStickyOrder(
    (cells.data?.neighbors ?? []).filter((cell) => !servingKeys.has(cell.key)).map((cell) => ({ ...cell, serving: false })),
    (cell) => cell.key,
    (cell) => cell.rsrp ?? -200,
    4,
  )
  // 驻留小区与邻区共用 key：设备重选到某个邻区时，那一行直接滑到顶部
  const rows: Row[] = [
    ...serving.map((cell) => ({
      key: cellKey(cell.pci, cell.earfcn),
      tech: cell.tech,
      band: cell.band,
      earfcn: cell.earfcn,
      pci: cell.pci,
      rsrp: cell.rsrp,
      rsrq: cell.rsrq,
      sinr: cell.sinr,
      serving: true,
    })),
    ...neighbors,
  ]

  return (
    <Panel className={cn('@container', className)}>
      <PanelHeader
        title={t.radio.nearbyTitle}
        detail={rows.length > 0 ? t.radio.cellsCount(rows.length) : undefined}
        action={
          <>
            <button
              type="button"
              onClick={() => setLive((v) => !v)}
              aria-pressed={live}
              className="flex h-7 items-center gap-1.5 rounded-full px-2.5 text-caption font-medium text-text-2 transition-colors hover:bg-hover"
            >
              <span className={cn('ap-live-dot size-1.5', live ? 'bg-success' : 'bg-text-4')} data-breathing={live || undefined} />
              {live ? t.radio.live : t.radio.paused}
            </button>
            <Button variant="ghost" size="sm" className="text-accent-text" icon={<PencilSimpleLine weight="bold" />} onClick={() => setManualOpen(true)}>
              {t.radio.manualTitle}
            </Button>
          </>
        }
      />

      <AnimatePresence initial={false}>
        {locked.length > 0 && (
          <motion.div {...collapse} className="overflow-hidden">
            <div className="mb-4 flex items-center gap-3 rounded-inner bg-accent-soft py-2.5 pr-2 pl-3.5">
              <LockSimple className="size-4 shrink-0 text-accent" weight="fill" />
              <span className="num min-w-0 flex-1 truncate text-footnote font-medium text-accent-text">
                {locked.length === 1 ? t.radio.lockedTo(describe(locked[0])) : t.radio.lockedMany(locked.length)}
              </span>
              <Button variant="ghost" size="sm" className="text-accent-text" loading={unlockMutation.isPending} disabled={busy} onClick={() => void unlockAll()}>
                {t.radio.unlock}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {cells.isPending ? (
        <div className="flex flex-col gap-2">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <EmptyState icon={<Broadcast weight="light" />} title={t.radio.noNeighbors} description={t.radio.noNeighborsHint} className="py-8" />
      ) : (
        <div className="-mx-2">
          <div className={cn('hidden px-2 pb-1.5 text-caption text-text-3 @2xl:grid @2xl:gap-x-5', COLUMNS)}>
            <span>{t.radio.cell}</span>
            <span>{t.radio.pciEarfcn}</span>
            <span>{t.radio.rsrpColumn}</span>
            <span>RSRQ</span>
            <span>SINR</span>
            <span />
          </div>
          <ul className="flex flex-col">
            <AnimatePresence initial={false} mode="popLayout">
              {rows.map((row) => (
                <CellRow key={row.key} row={row} locked={lockedKeys.has(row.key)} onOpen={() => setDetail(row)} />
              ))}
            </AnimatePresence>
          </ul>
        </div>
      )}

      <CellSheet
        row={detail ? (rows.find((row) => row.key === detail.key) ?? detail) : null}
        locked={detail ? lockedKeys.has(detail.key) : false}
        busy={busy}
        onClose={() => setDetail(null)}
        onLock={async (target) => {
          if (await lock(target)) setDetail(null)
        }}
      />
      <ManualSheet
        open={manualOpen}
        serving={serving[0]}
        busy={busy}
        onClose={() => setManualOpen(false)}
        onLock={async (target) => {
          const ok = await lock(target)
          if (ok) setManualOpen(false)
          return ok
        }}
      />
    </Panel>
  )
}

/* —— 一行：桌面六列；窄容器里折成「小区 · PCI ／ 信号条」两行 —— */

function CellRow({ row, locked, onOpen }: { row: Row; locked: boolean; onOpen: () => void }) {
  const t = useT()
  const freq = earfcnToMHz(row.earfcn)
  return (
    <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }} transition={spring.layout}>
      <button
        type="button"
        onClick={onOpen}
        className={cn(
          'group grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-5 gap-y-2 rounded-[12px] px-2 py-2.5 text-left @2xl:gap-y-0',
          COLUMNS,
          'transition-colors duration-100 hover:bg-hover active:bg-pressed',
          row.serving && 'bg-accent-soft hover:bg-accent-soft',
        )}
      >
        <span className="flex min-w-0 items-center gap-2">
          <span className={cn('rounded-[5px] px-1 text-[10.5px] leading-4 font-semibold', row.tech === 'NR' ? 'bg-accent-soft text-accent-text' : 'bg-sunken text-text-2')}>
            {techTag(row.tech)}
          </span>
          <span className="num text-[15px] font-semibold text-text">{row.band ? bandLabel(row.tech, row.band) : '—'}</span>
          {row.serving && <span className="text-caption font-medium text-accent-text">{t.radio.current}</span>}
          {/* 窄屏：PCI 跟在频段后面 */}
          <span className="num truncate text-footnote text-text-2 @2xl:hidden">· PCI {row.pci}</span>
        </span>

        <span className="hidden min-w-0 @2xl:block">
          <span className="num block text-[14px] font-medium text-text">{row.pci}</span>
          <span className="num block truncate text-caption text-text-3">
            {row.earfcn}
            {freq != null && ` · ${freq.toFixed(1)} MHz`}
          </span>
        </span>

        <RsrpBar value={row.rsrp} className="col-span-2 row-start-2 @2xl:col-span-1 @2xl:row-start-auto" />

        <Reading metric="rsrq" value={row.rsrq} className="hidden @2xl:flex" />
        <Reading metric="sinr" value={row.sinr} className="hidden @2xl:flex" />

        <span className="col-start-2 row-start-1 flex justify-end @2xl:col-start-auto @2xl:row-start-auto">
          {locked ? (
            <LockSimple className="size-4 text-accent" weight="fill" aria-label={t.radio.lockedTag} />
          ) : (
            <CaretRight className="size-3.5 text-text-4 transition-transform duration-150 group-hover:translate-x-0.5" weight="bold" />
          )}
        </span>
      </button>
    </motion.li>
  )
}

/** RSRP 信号条：长度 = 量程内位置，颜色 = 质量档；三条刻度标出质量分界 */
function RsrpBar({ value, className }: { value: number | null; className?: string }) {
  const quality = qualityOf('rsrp', value)
  const [min, max] = RANGES.rsrp
  return (
    <span className={cn('flex min-w-0 items-center gap-3', className)}>
      <span className="relative h-1 flex-1 overflow-hidden rounded-full bg-[rgb(120_120_128/0.16)] dark:bg-[rgb(120_120_128/0.3)]">
        <motion.span
          className={cn('absolute inset-y-0 left-0 rounded-full', QUALITY_DOT[quality])}
          initial={false}
          animate={{ width: `${Math.max(value == null ? 0 : 3, positionIn('rsrp', value) * 100)}%` }}
          transition={spring.smooth}
        />
        {THRESHOLDS.rsrp.map((edge) => (
          <span
            key={edge}
            aria-hidden
            className="absolute inset-y-0 w-0.5 bg-surface"
            style={{ left: `${((edge - min) / (max - min)) * 100}%` }}
          />
        ))}
      </span>
      <Quantity value={value ?? '—'} unit="dBm" className="w-[76px] justify-end text-[14px] font-semibold text-text" unitClassName="text-caption font-normal text-text-3" />
    </span>
  )
}

function Reading({ metric, value, className }: { metric: Metric; value: number | null; className?: string }) {
  const quality = qualityOf(metric, value)
  return (
    <span className={cn('items-center gap-1.5', className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', QUALITY_DOT[quality])} aria-hidden />
      <Quantity value={value ?? '—'} unit="dB" className="text-[14px] font-medium text-text" unitClassName="text-caption font-normal text-text-3" />
    </span>
  )
}

/* —— 详情：大读数 + 色阶条 + 四项读数；在这里锁定 —— */

function CellSheet({
  row,
  locked,
  busy,
  onClose,
  onLock,
}: {
  row: Row | null
  locked: boolean
  busy: boolean
  onClose: () => void
  onLock: (target: Target) => void
}) {
  const t = useT()
  // 关闭时 row 变成 null，但抽屉还要播完退场动画：用最后一次的内容垫着
  const lastRef = useRef<Row | null>(row)
  if (row) lastRef.current = row
  const shown = row ?? lastRef.current
  const freq = shown ? earfcnToMHz(shown.earfcn) : null
  const quality = overallQuality(shown?.rsrp ?? null, shown?.sinr ?? null)
  return (
    <Sheet open={Boolean(row)} onOpenChange={(open) => !open && onClose()}>
      {shown && (
        <SheetContent
          title={`${shown.band ? `${bandLabel(shown.tech, shown.band)} · ` : ''}PCI ${shown.pci}`}
          description={`${shown.tech === 'NR' ? '5G NR' : '4G LTE'} · ${t.overview.earfcn} ${shown.earfcn}${freq != null ? ` · ${freq.toFixed(2)} MHz` : ''}`}
          footer={
            <>
              <Button variant="secondary" onClick={onClose}>
                {t.common.cancel}
              </Button>
              <Button variant="primary" icon={<LockSimple weight="bold" />} disabled={busy || locked} onClick={() => onLock(shown)}>
                {locked ? t.radio.lockedTag : t.radio.lockThis}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-5">
            <div>
              <div className="flex items-baseline gap-2">
                <Quantity value={shown.rsrp ?? '—'} unit="dBm" className="text-metric text-text" unitClassName="text-[15px]" />
                <span className={cn('text-[15px] font-semibold', QUALITY_TEXT[quality])}>{t.signal.quality[quality]}</span>
              </div>
              <LevelScale className="mt-4" position={shown.rsrp == null ? null : positionIn('rsrp', shown.rsrp)} gradient={SIGNAL_GRADIENT} />
              <div className="mt-1.5 flex justify-between text-caption2 font-medium text-text-4">
                <span>{t.overview.weak}</span>
                <span>{t.overview.strong}</span>
              </div>
            </div>
            <dl className="grid grid-cols-2 gap-x-4 gap-y-4 rounded-inner bg-sunken p-4">
              {[
                { label: 'SINR', value: shown.sinr, unit: 'dB', metric: 'sinr' as const },
                { label: 'RSRQ', value: shown.rsrq, unit: 'dB', metric: 'rsrq' as const },
                { label: t.overview.band, value: shown.band ? bandLabel(shown.tech, shown.band) : null },
                { label: t.overview.frequency, value: freq != null ? freq.toFixed(1) : null, unit: 'MHz' },
              ].map((item) => (
                <div key={item.label}>
                  <dt className="flex items-center gap-1.5 text-caption text-text-3">
                    {item.metric && <span className={cn('size-1.5 rounded-full', QUALITY_DOT[qualityOf(item.metric, item.value as number | null)])} />}
                    {item.label}
                  </dt>
                  <dd className="mt-0.5">
                    <Quantity value={item.value ?? '—'} unit={item.value != null ? item.unit : undefined} className="text-[17px] font-semibold text-text" unitClassName="text-caption" />
                  </dd>
                </div>
              ))}
            </dl>
            {shown.serving && (
              <Callout tone="accent" icon={<Crosshair weight="bold" />}>
                {t.radio.serving}
              </Callout>
            )}
            <p className="text-footnote text-text-3">{t.radio.lockConfirmBody}</p>
          </div>
        </SheetContent>
      )}
    </Sheet>
  )
}

/* —— 手动锁定：PCI + 频点，制式按频点自动判断（也可手动改） —— */

function ManualSheet({
  open,
  serving,
  busy,
  onClose,
  onLock,
}: {
  open: boolean
  serving: (ServingCell & { pci: number; earfcn: number }) | undefined
  busy: boolean
  onClose: () => void
  onLock: (target: Target) => Promise<boolean>
}) {
  const t = useT()
  const [pci, setPci] = useState('')
  const [earfcn, setEarfcn] = useState('')
  const [tech, setTech] = useState<Tech>('NR')
  const [techTouched, setTechTouched] = useState(false)
  const [errors, setErrors] = useState<{ pci?: string; earfcn?: string }>({})
  const freq = earfcn ? earfcnToMHz(Number(earfcn)) : null

  const reset = () => {
    setPci('')
    setEarfcn('')
    setTechTouched(false)
    setErrors({})
  }

  const onEarfcn = (value: string) => {
    setEarfcn(value)
    if (errors.earfcn) setErrors((e) => ({ ...e, earfcn: undefined }))
    const n = Number(value)
    if (!techTouched && value && Number.isFinite(n) && n > 0) setTech(techOfEarfcn(n))
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const p = Number(pci)
    const e = Number(earfcn)
    const next: typeof errors = {}
    if (pci === '' || !Number.isInteger(p) || p < 0 || p > PCI_MAX[tech]) next.pci = t.radio.invalidPci(PCI_MAX[tech])
    if (earfcn === '' || !Number.isInteger(e) || e <= 0) next.earfcn = t.radio.invalidEarfcn
    setErrors(next)
    if (next.pci || next.earfcn) return
    if (await onLock({ tech, pci: p, earfcn: e })) reset()
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose()
      }}
    >
      <SheetContent
        title={t.radio.manualTitle}
        description={t.radio.manualHint}
        footer={
          <>
            <Button variant="secondary" onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button type="submit" form="ap-manual-lock" variant="primary" icon={<LockSimple weight="bold" />} disabled={busy}>
              {t.radio.lockCell}
            </Button>
          </>
        }
      >
        <form id="ap-manual-lock" onSubmit={submit} noValidate className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <span className="text-footnote font-medium text-text-2">{t.radio.tech}</span>
            <SegmentedControl<Tech>
              ariaLabel={t.radio.tech}
              value={tech}
              fullWidth
              onChange={(value) => {
                setTech(value)
                setTechTouched(true)
              }}
              options={[
                { value: 'NR', label: '5G NR' },
                { value: 'LTE', label: '4G LTE' },
              ]}
            />
          </div>
          <Field label="PCI" error={errors.pci}>
            {(id) => (
              <IntegerInput
                id={id}
                value={pci}
                onValueChange={(value) => {
                  setPci(value)
                  if (errors.pci) setErrors((e) => ({ ...e, pci: undefined }))
                }}
                placeholder={`0–${PCI_MAX[tech]}`}
                invalid={Boolean(errors.pci)}
              />
            )}
          </Field>
          <Field label={t.overview.earfcn} error={errors.earfcn}>
            {(id) => (
              <IntegerInput
                id={id}
                value={earfcn}
                onValueChange={onEarfcn}
                placeholder={tech === 'NR' ? '504990' : '1825'}
                invalid={Boolean(errors.earfcn)}
                suffix={freq != null && freq > 0 ? <span className="num">{freq.toFixed(1)} MHz</span> : undefined}
              />
            )}
          </Field>
          {serving && (
            <button
              type="button"
              onClick={() => {
                setPci(String(serving.pci))
                setEarfcn(String(serving.earfcn))
                setTech(serving.tech)
                setTechTouched(true)
                setErrors({})
              }}
              className="flex w-fit items-center gap-1.5 text-footnote font-medium text-accent-text transition-opacity hover:opacity-75"
            >
              <Crosshair className="size-4" weight="bold" />
              {t.radio.useServing}
              <span className="num font-normal text-text-3">
                （PCI {serving.pci} · {serving.earfcn}）
              </span>
            </button>
          )}
        </form>
      </SheetContent>
    </Sheet>
  )
}
