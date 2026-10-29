import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { bytesOf, SIZE_UNITS, splitBytes, trafficApi, type DataGuard, type DataPlan, type SizeUnit } from '@/api/traffic'
import { ListGroup, ListRow, Panel, PanelHeader } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/feedback'
import { InputRow, SaveActions, SwitchRow } from '@/components/ui/form-rows'
import { SegmentedControl } from '@/components/ui/segmented'
import { toast } from '@/components/ui/toast'
import { UsageBars } from '@/components/viz/usage-bars'
import { useT } from '@/i18n'
import { formatBytes, joinQuantity } from '@/lib/format'

/* 查询选项：组件和分区预读（SettingsPage.preload）共用 */
/** 本月每日用量：key 带上月初时间，跨月自动换一份 */
export const dailyUsageQuery = (start = monthStart()) => ({
  queryKey: ['traffic', 'daily', start] as const,
  queryFn: () => trafficApi.daily(start, Date.now()),
  staleTime: 60_000,
})
export const planQuery = { queryKey: ['traffic', 'plan'] as const, queryFn: trafficApi.plan }
export const guardQuery = { queryKey: ['traffic', 'guard'] as const, queryFn: trafficApi.guard }
function monthStart() {
  const now = new Date()
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime()
}

const sizeOptions = SIZE_UNITS.map((unit) => ({ value: String(unit.value), label: unit.label }))

/** 数字 + 单位的小分段（MB / GB / TB），放在输入行右侧 */
function UnitPicker({ value, onChange, label }: { value: SizeUnit; onChange: (unit: SizeUnit) => void; label: string }) {
  return <SegmentedControl size="sm" ariaLabel={label} value={String(value)} onChange={(v) => onChange(Number(v) as SizeUnit)} options={sizeOptions} />
}

/**
 * 流量：上面是本月逐日用量，下面三组设置——
 * 流量套餐（设备自带后台统计，含提醒比例与清零日）、校准已用流量、AirPulse 的流量保护（到上限自动断网）。
 * 每组各自「还原 / 保存」。
 */
export function TrafficSection() {
  return (
    <div className="@container">
      <div className="grid grid-cols-1 gap-x-6 gap-y-7 @4xl:grid-cols-2 @4xl:items-start">
        <UsagePanel />
        <div className="flex flex-col gap-7">
          <PlanGroup />
          <GuardGroup />
        </div>
      </div>
    </div>
  )
}

/* —— 本月逐日用量 —— */

function UsagePanel() {
  const t = useT()
  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1).getTime()
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
  const usage = useQuery(dailyUsageQuery(start))
  const bars = useMemo(
    () =>
      (usage.data ?? [])
        .map((day) => ({ day: Number(day.date.slice(8, 10)), bytes: day.bytes, today: Number(day.date.slice(8, 10)) === now.getDate() }))
        .filter((bar) => bar.day >= 1 && bar.day <= 31),
    [usage.data],
  )
  const total = bars.reduce((sum, bar) => sum + bar.bytes, 0)
  const today = bars.find((bar) => bar.today)?.bytes ?? 0
  const average = total / Math.max(1, now.getDate())
  const amount = formatBytes(total)
  return (
    // 与右侧第一组卡片顶边对齐（右侧分组标题占 26px）
    <Panel className="@4xl:mt-[26px]">
      <PanelHeader title={t.traffic.usageTitle} detail={t.traffic.usageHint} />
      {usage.isPending ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <span className="flex items-baseline gap-1">
              <span className="num text-metric text-text">{amount.value}</span>
              <span className="text-[15px] font-medium text-text-2">{amount.unit}</span>
            </span>
            <span className="num text-footnote text-text-2">
              {t.traffic.today} {joinQuantity(formatBytes(today))} · {t.traffic.average} {joinQuantity(formatBytes(average))}
            </span>
          </div>
          {bars.length === 0 ? (
            <p className="mt-6 text-footnote text-text-3">{t.traffic.noUsage}</p>
          ) : (
            <UsageBars className="mt-6" bars={bars} daysInMonth={daysInMonth} label={(day) => `${now.getMonth() + 1}/${day}`} />
          )}
        </>
      )}
    </Panel>
  )
}

/* —— 流量套餐 + 校准 —— */

function PlanGroup() {
  const t = useT()
  const queryClient = useQueryClient()
  const plan = useQuery(planQuery)
  const [draft, setDraft] = useState<{ enabled: boolean; size: string; unit: SizeUnit; alert: string; day: string; autoClear: boolean } | null>(null)
  const reset = (p: DataPlan) =>
    setDraft({ enabled: p.enabled, size: p.size ? String(p.size) : '', unit: p.unit, alert: String(p.alertPercent), day: String(p.clearDay), autoClear: p.autoClear })
  useEffect(() => {
    if (plan.data) reset(plan.data)
  }, [plan.data])

  const [used, setUsed] = useState('')
  const [usedUnit, setUsedUnit] = useState<SizeUnit>(1024)

  const save = useMutation({
    mutationFn: (next: DataPlan) => trafficApi.savePlan(next),
    onSuccess: () => {
      toast.success(t.traffic.saved)
      void queryClient.invalidateQueries({ queryKey: ['traffic', 'plan'] })
      void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
    },
    onError: () => toast.error(t.common.operationFailed),
  })
  const calibrate = useMutation({
    mutationFn: (bytes: number) => trafficApi.calibrate(bytes),
    onSuccess: () => {
      toast.success(t.traffic.calibrated)
      setUsed('')
      void queryClient.invalidateQueries({ queryKey: ['traffic', 'plan'] })
      void queryClient.invalidateQueries({ queryKey: ['telemetry'] })
    },
    onError: () => toast.error(t.common.operationFailed),
  })

  if (!plan.data || !draft) {
    return (
      <ListGroup title={t.traffic.planTitle}>
        <div className="p-4">
          <Skeleton className="h-28" />
        </div>
      </ListGroup>
    )
  }
  const base = plan.data
  const size = Number(draft.size)
  const alert = Number(draft.alert)
  const day = Number(draft.day)
  const errors = {
    size: draft.enabled && !(size > 0) ? t.traffic.invalidSize : null,
    alert: draft.enabled && !(Number.isInteger(alert) && alert >= 0 && alert <= 100) ? t.traffic.invalidPercent : null,
    day: draft.enabled && !(Number.isInteger(day) && day >= 1 && day <= 31) ? t.traffic.invalidDay : null,
  }
  const dirty =
    draft.enabled !== base.enabled ||
    (draft.enabled &&
      (size !== base.size || draft.unit !== base.unit || alert !== base.alertPercent || day !== base.clearDay || draft.autoClear !== base.autoClear))
  const usedNumber = Number(used)
  return (
    <>
      <div>
        <ListGroup title={t.traffic.planTitle} footer={t.traffic.planFooter}>
          <SwitchRow title={t.traffic.planEnabled} checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
          {draft.enabled && (
            <>
              <InputRow
                label={t.traffic.planSize}
                value={draft.size}
                onChange={(v) => setDraft({ ...draft, size: v.replace(/[^\d.]/g, '') })}
                inputMode="decimal"
                mono
                placeholder="200"
                error={errors.size}
                suffix={<UnitPicker value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit })} label={t.traffic.planSize} />}
              />
              <InputRow
                label={t.traffic.alertPercent}
                value={draft.alert}
                onChange={(v) => setDraft({ ...draft, alert: v.replace(/\D/g, '') })}
                inputMode="numeric"
                mono
                suffix="%"
                error={errors.alert}
              />
              <InputRow
                label={t.traffic.clearDay}
                value={draft.day}
                onChange={(v) => setDraft({ ...draft, day: v.replace(/\D/g, '') })}
                inputMode="numeric"
                mono
                error={errors.day}
              />
              <SwitchRow title={t.traffic.autoClear} checked={draft.autoClear} onCheckedChange={(autoClear) => setDraft({ ...draft, autoClear })} />
            </>
          )}
        </ListGroup>
        <SaveActions
          dirty={dirty}
          saving={save.isPending}
          disabled={Boolean(errors.size || errors.alert || errors.day)}
          onRevert={() => reset(base)}
          onSave={() => save.mutate({ ...base, enabled: draft.enabled, size, unit: draft.unit, alertPercent: alert, clearDay: day, autoClear: draft.autoClear })}
        />
      </div>

      <div>
        <ListGroup title={t.traffic.calibrateTitle} footer={t.traffic.calibrateFooter}>
          <ListRow title={t.traffic.usedNow} trailing={<span className="num">{joinQuantity(formatBytes(base.usedBytes))}</span>} />
          <InputRow
            label={t.traffic.usedValue}
            value={used}
            onChange={(v) => setUsed(v.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            mono
            placeholder={(base.usedBytes / (usedUnit * 1024 * 1024)).toFixed(usedUnit === 1 ? 0 : 1)}
            suffix={<UnitPicker value={usedUnit} onChange={setUsedUnit} label={t.traffic.usedValue} />}
          />
        </ListGroup>
        <SaveActions
          dirty={used !== '' && usedNumber >= 0}
          saving={calibrate.isPending}
          saveLabel={t.traffic.calibrate}
          onRevert={() => setUsed('')}
          onSave={() => calibrate.mutate(bytesOf(usedNumber, usedUnit))}
        />
      </div>
    </>
  )
}

/* —— AirPulse 流量保护 —— */

function GuardGroup() {
  const t = useT()
  const queryClient = useQueryClient()
  const guard = useQuery(guardQuery)
  const [draft, setDraft] = useState<{ enabled: boolean; value: string; unit: SizeUnit; period: DataGuard['period']; notify: boolean } | null>(null)
  const reset = (g: DataGuard) => {
    const { value, unit } = splitBytes(g.maxBytes)
    setDraft({ enabled: g.enabled, value: value ? String(value) : '', unit, period: g.period, notify: g.notify })
  }
  useEffect(() => {
    if (guard.data) reset(guard.data)
  }, [guard.data])
  const save = useMutation({
    mutationFn: (next: DataGuard) => trafficApi.saveGuard(next),
    onSuccess: () => {
      toast.success(t.traffic.saved)
      void queryClient.invalidateQueries({ queryKey: ['traffic', 'guard'] })
    },
    onError: () => toast.error(t.common.operationFailed),
  })
  if (!guard.data || !draft) {
    return (
      <ListGroup title={t.traffic.guardTitle}>
        <div className="p-4">
          <Skeleton className="h-20" />
        </div>
      </ListGroup>
    )
  }
  const base = guard.data
  const value = Number(draft.value)
  const maxBytes = bytesOf(value, draft.unit)
  const error = draft.enabled && !(value > 0) ? t.traffic.invalidSize : null
  const dirty =
    draft.enabled !== base.enabled ||
    (draft.enabled && (maxBytes !== base.maxBytes || draft.period !== base.period || draft.notify !== base.notify))
  return (
    <div>
      <ListGroup title={t.traffic.guardTitle} footer={t.traffic.guardFooter}>
        <SwitchRow title={t.traffic.guardEnabled} checked={draft.enabled} onCheckedChange={(enabled) => setDraft({ ...draft, enabled })} />
        {draft.enabled && (
          <>
            <InputRow
              label={t.traffic.guardLimit}
              value={draft.value}
              onChange={(v) => setDraft({ ...draft, value: v.replace(/[^\d.]/g, '') })}
              inputMode="decimal"
              mono
              placeholder="100"
              error={error}
              suffix={<UnitPicker value={draft.unit} onChange={(unit) => setDraft({ ...draft, unit })} label={t.traffic.guardLimit} />}
            />
            <ListRow
              title={t.traffic.guardPeriod}
              trailing={
                <SegmentedControl<DataGuard['period']>
                  size="sm"
                  ariaLabel={t.traffic.guardPeriod}
                  value={draft.period}
                  onChange={(period) => setDraft({ ...draft, period })}
                  options={[
                    { value: 'daily', label: t.traffic.daily },
                    { value: 'monthly', label: t.traffic.monthly },
                  ]}
                />
              }
            />
            <SwitchRow
              title={t.traffic.guardNotify}
              subtitle={t.traffic.guardNotifyHint}
              checked={draft.notify}
              onCheckedChange={(notify) => setDraft({ ...draft, notify })}
            />
          </>
        )}
      </ListGroup>
      <SaveActions
        dirty={dirty}
        saving={save.isPending}
        disabled={Boolean(error)}
        onRevert={() => reset(base)}
        onSave={() => save.mutate({ enabled: draft.enabled, maxBytes, period: draft.period, notify: draft.notify })}
      />
    </div>
  )
}
