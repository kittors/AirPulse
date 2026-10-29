import { CalendarCheck, CaretRight, Plus, Warning } from '@phosphor-icons/react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { forwardApi, forwardKeys } from '@/api/forward'
import { BEARER_PREFERENCES } from '@/api/radio'
import { buildAction, EMPTY_DRAFT, formatTimeInput, parseAction, sortTasks, tasksApi, normalizeTime, type TaskDraft, type TaskInfo, type TaskKind } from '@/api/tasks'
import type { BearerPreference } from '@/api/types'
import { hrefOf } from '@/app/router'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, Panel } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Callout, EmptyState, Skeleton } from '@/components/ui/feedback'
import { Field, Input, IntegerInput, Textarea } from '@/components/ui/input'
import { SegmentedControl } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { toast } from '@/components/ui/toast'
import { useT, type Messages } from '@/i18n'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { versionInfoQuery } from '@/hooks/queries'

import { tasksKey, tasksQuery } from './keys'

type ActionError = Extract<ReturnType<typeof buildAction>, { ok: false }>['error']

/** 动作列表的顺序：常用在前，开关类其次，最后是短信、推送和自定义 */
const KINDS: TaskKind[] = [
  'reboot',
  'data',
  'wifi',
  'networkMode',
  'simSlot',
  'unlockCells',
  'lockCell',
  'roaming',
  'indicator',
  'nfc',
  'samba',
  'performance',
  'usbDebug',
  'sendSms',
  'forwardInfo',
  'shutdown',
  'custom',
]
const TOGGLE_KINDS = new Set<TaskKind>(['data', 'roaming', 'indicator', 'nfc', 'samba', 'performance', 'usbDebug'])

/** 列表上的一句话说明 */
export function describeTask(draft: TaskDraft, t: Messages): string {
  const k = t.tools.tasks.kinds
  if (TOGGLE_KINDS.has(draft.kind)) return `${draft.on ? t.tools.tasks.turnOn : t.tools.tasks.turnOff}${k[draft.kind]}`
  switch (draft.kind) {
    case 'wifi':
      return draft.wifi === 'off' ? t.tools.tasks.wifiOff : t.tools.tasks.wifiTo(draft.wifi === 'chip1' ? '2.4 GHz' : '5 GHz')
    case 'networkMode':
      return `${k.networkMode}：${t.radio.modes[draft.mode as BearerPreference]?.label ?? draft.mode}`
    case 'simSlot':
      return t.tools.tasks.simTo(simLabel(draft.simSlot, t))
    case 'lockCell':
      return `${k.lockCell} PCI ${draft.pci} · ${draft.earfcn}`
    case 'sendSms':
      return t.tools.tasks.smsTo(draft.number)
    case 'custom': {
      try {
        const map = JSON.parse(draft.custom) as Record<string, string>
        return `${k.custom} · ${map.goformId || '—'}`
      } catch {
        return k.custom
      }
    }
    default:
      return k[draft.kind]
  }
}

function simLabel(slot: string, t: Messages): string {
  const v50 = t.tools.tasks.v50Slots as Record<string, string>
  if (slot === '0' || slot === '1') return `SIM ${Number(slot) + 1}`
  return v50[slot] ?? slot
}

const pad = (n: number) => String(n).padStart(2, '0')
function formatRun(ts: number): string {
  const d = new Date(ts)
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/**
 * 定时任务：学 iOS 闹钟——每行一个大号时间，下面一句「每天 · 重启设备」。
 * 动作用表单填（开关、下拉、号码与内容），由前端生成参数；按设备本地时间执行。
 */
export function TasksSection() {
  const t = useT()
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const tasks = useQuery({ ...tasksQuery, refetchInterval: 30_000 })
  const [editing, setEditing] = useState<TaskInfo | 'new' | null>(null)
  const list = sortTasks(tasks.data ?? [])

  const clear = () =>
    void confirm({
      tone: 'danger',
      title: t.tools.tasks.clearTitle,
      description: t.tools.tasks.clearBody(list.length),
      confirmText: t.tools.tasks.clearAll,
      onConfirm: async () => {
        await tasksApi.clear()
        await queryClient.invalidateQueries({ queryKey: tasksKey })
      },
    })

  return (
    <div className="w-full max-w-[720px]">
      <div className="mb-3 flex items-center justify-between gap-3 px-1">
        <p className="text-subhead text-text-2">{tasks.data ? t.tools.tasks.summary(list.length) : ' '}</p>
        <Button variant="primary" icon={<Plus weight="bold" />} onClick={() => setEditing('new')}>
          {t.tools.tasks.add}
        </Button>
      </div>

      {!tasks.data ? (
        tasks.isError ? (
          <Panel>
            <EmptyState title={t.tools.tasks.loadFailed} description={errorMessage(tasks.error)} action={<Button onClick={() => void tasks.refetch()}>{t.common.retry}</Button>} />
          </Panel>
        ) : (
          <Skeleton className="h-56 rounded-card" />
        )
      ) : list.length === 0 ? (
        <Panel>
          <EmptyState
            className="py-14"
            icon={<CalendarCheck weight="light" />}
            title={t.tools.tasks.emptyTitle}
            description={t.tools.tasks.emptyBody}
            action={
              <Button variant="secondary" icon={<Plus weight="bold" />} onClick={() => setEditing('new')}>
                {t.tools.tasks.add}
              </Button>
            }
          />
        </Panel>
      ) : (
        <ListGroup
          footer={
            <>
              {t.tools.tasks.footer}{' '}
              <button type="button" className="text-danger-text hover:underline" onClick={clear}>
                {t.tools.tasks.clearAll}
              </button>
            </>
          }
        >
          {list.map((task) => {
            const draft = parseAction(task.actionMap)
            const done = !task.repeatDaily && task.hasTriggered
            return (
              <ListRow
                key={task.id}
                onClick={() => setEditing(task)}
                className={cn(done && 'opacity-55')}
                title={
                  <span className="flex items-baseline gap-2.5">
                    <span className="num text-[30px] leading-9 font-light tracking-[-0.02em] text-text">{task.time}</span>
                    <span className="min-w-0 truncate text-subhead text-text-2">{task.id}</span>
                  </span>
                }
                subtitle={`${task.repeatDaily ? t.tools.tasks.daily : t.tools.tasks.once} · ${describeTask(draft, t)}`}
                trailing={
                  <>
                    <span className="text-footnote text-text-3 max-sm:hidden">
                      {task.lastRunTimestamp ? t.tools.tasks.lastRun(formatRun(task.lastRunTimestamp)) : t.tools.tasks.neverRun}
                    </span>
                    <CaretRight className="size-3.5 text-text-4" weight="bold" />
                  </>
                }
              />
            )
          })}
        </ListGroup>
      )}

      <TaskSheet
        task={editing}
        taken={(tasks.data ?? []).map((task) => task.id)}
        onClose={() => setEditing(null)}
        onSaved={() => void queryClient.invalidateQueries({ queryKey: tasksKey })}
      />
    </div>
  )
}

function TaskSheet({
  task,
  taken,
  onClose,
  onSaved,
}: {
  task: TaskInfo | 'new' | null
  taken: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const t = useT()
  const confirm = useConfirm()
  const isNew = task === 'new'
  const original = task && task !== 'new' ? task : null
  const [name, setName] = useState('')
  const [time, setTime] = useState('03:00')
  const [repeat, setRepeat] = useState<'daily' | 'once'>('daily')
  const [draft, setDraft] = useState<TaskDraft>(EMPTY_DRAFT)
  const [submitted, setSubmitted] = useState(false)
  const version = useQuery(versionInfoQuery)
  const forward = useQuery({ queryKey: forwardKeys.enabled, queryFn: forwardApi.enabled, enabled: draft.kind === 'forwardInfo' })
  const v50 = (version.data?.model ?? '').toLowerCase() === 'v50'

  // 打开时回填
  useEffect(() => {
    if (!task) return
    setSubmitted(false)
    if (task === 'new') {
      setName('')
      setTime('03:00')
      setRepeat('daily')
      setDraft(EMPTY_DRAFT)
    } else {
      setName(task.id)
      setTime(task.time)
      setRepeat(task.repeatDaily ? 'daily' : 'once')
      setDraft(parseAction(task.actionMap))
    }
  }, [task])

  const patch = (next: Partial<TaskDraft>) => setDraft((d) => ({ ...d, ...next }))
  const normalized = normalizeTime(time)
  const trimmed = name.trim()
  const nameError = !trimmed ? t.tools.tasks.nameRequired : trimmed !== original?.id && taken.includes(trimmed) ? t.tools.tasks.nameTaken : null
  const built = buildAction(draft)
  const actionError = built.ok ? null : built.error

  const save = useMutation({
    mutationFn: async () => {
      if (!built.ok || !normalized) return
      await tasksApi.save({ id: trimmed, time: normalized, repeatDaily: repeat === 'daily', action: built.action })
      // 改名 = 新建一条再删掉旧的（后端以 id 为键）
      if (original && original.id !== trimmed) await tasksApi.remove(original.id)
    },
    onSuccess: () => {
      toast.success(isNew ? t.tools.tasks.created : t.tools.tasks.saved)
      onSaved()
      onClose()
    },
    onError: (error) => toast.error(t.common.operationFailed, { description: errorMessage(error) }),
  })

  const submit = () => {
    setSubmitted(true)
    if (nameError || !normalized || actionError) return
    save.mutate()
  }

  const remove = () =>
    original &&
    void confirm({
      tone: 'danger',
      title: t.tools.tasks.deleteTitle(original.id),
      confirmText: t.common.delete,
      onConfirm: async () => {
        await tasksApi.remove(original.id)
        onSaved()
        onClose()
      },
    })

  const risky =
    (draft.kind === 'data' && !draft.on) ||
    (draft.kind === 'wifi' && draft.wifi === 'off') ||
    (draft.kind === 'networkMode' && draft.mode !== 'WL_AND_5G' && draft.mode !== 'LTE_AND_5G') ||
    draft.kind === 'simSlot' ||
    draft.kind === 'lockCell' ||
    draft.kind === 'shutdown'

  return (
    <Sheet open={task != null} onOpenChange={(open) => !open && !save.isPending && onClose()}>
      <SheetContent
        title={isNew ? t.tools.tasks.newTitle : t.tools.tasks.editTitle}
        description={original?.lastRunTimestamp ? t.tools.tasks.lastRun(formatRun(original.lastRunTimestamp)) : undefined}
        footer={
          <>
            {original && (
              <Button variant="danger-soft" className="mr-auto max-sm:flex-none" disabled={save.isPending} onClick={remove}>
                {t.common.delete}
              </Button>
            )}
            <Button variant="secondary" disabled={save.isPending} onClick={onClose}>
              {t.common.cancel}
            </Button>
            <Button variant="primary" loading={save.isPending} onClick={submit}>
              {t.common.save}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-5">
          <Field label={t.tools.tasks.name} error={submitted ? nameError : null}>
            {(id) => <Input id={id} value={name} onValueChange={setName} placeholder={t.tools.tasks.namePlaceholder} maxLength={40} invalid={submitted && Boolean(nameError)} />}
          </Field>

          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4">
            <Field label={t.tools.tasks.time} hint={t.tools.tasks.timeHint} error={submitted && !normalized ? t.tools.tasks.timeInvalid : null}>
              {(id) => (
                <Input
                  id={id}
                  mono
                  value={time}
                  inputMode="numeric"
                  maxLength={5}
                  placeholder="03:00"
                  invalid={submitted && !normalized}
                  onValueChange={(raw) => setTime(formatTimeInput(raw))}
                  onBlur={() => normalized && setTime(normalized)}
                />
              )}
            </Field>
            <Field label={t.tools.tasks.repeat}>
              {() => (
                <SegmentedControl
                  size="lg"
                  ariaLabel={t.tools.tasks.repeat}
                  value={repeat}
                  onChange={setRepeat}
                  options={[
                    { value: 'daily', label: t.tools.tasks.daily },
                    { value: 'once', label: t.tools.tasks.once },
                  ]}
                />
              )}
            </Field>
          </div>

          <Field label={t.tools.tasks.action}>
            {() => (
              <Select<TaskKind>
                ariaLabel={t.tools.tasks.action}
                value={draft.kind}
                onValueChange={(kind) => patch({ kind })}
                options={KINDS.map((kind) => ({ value: kind, label: t.tools.tasks.kinds[kind] }))}
              />
            )}
          </Field>

          <ActionFields draft={draft} patch={patch} v50={v50} error={submitted ? actionError : null} />

          {draft.kind === 'forwardInfo' && forward.data === false && (
            <Callout tone="warning" icon={<Warning weight="fill" />} title={t.tools.tasks.forwardOffTitle}>
              {t.tools.tasks.forwardOffBody}{' '}
              <a href={hrefOf('messages', 'forward')} className="font-medium underline">
                {t.tools.tasks.forwardOffLink}
              </a>
            </Callout>
          )}
          {risky && (
            <Callout tone="warning" icon={<Warning weight="fill" />}>
              {draft.kind === 'shutdown' ? t.tools.tasks.shutdownHint : t.tools.tasks.riskyHint}
            </Callout>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function ActionFields({
  draft,
  patch,
  v50,
  error,
}: {
  draft: TaskDraft
  patch: (next: Partial<TaskDraft>) => void
  v50: boolean
  error: ActionError | null
}) {
  const t = useT()
  const message = (...kinds: ActionError[]) => (error && kinds.includes(error) ? t.tools.tasks.errors[error] : null)
  if (TOGGLE_KINDS.has(draft.kind)) {
    return (
      <SegmentedControl
        fullWidth
        ariaLabel={t.tools.tasks.kinds[draft.kind]}
        value={draft.on ? 'on' : 'off'}
        onChange={(v) => patch({ on: v === 'on' })}
        options={[
          { value: 'on', label: t.tools.tasks.turnOn },
          { value: 'off', label: t.tools.tasks.turnOff },
        ]}
      />
    )
  }
  switch (draft.kind) {
    case 'wifi':
      return (
        <SegmentedControl
          fullWidth
          ariaLabel={t.tools.tasks.kinds.wifi}
          value={draft.wifi}
          onChange={(wifi) => patch({ wifi })}
          options={[
            { value: 'off', label: t.common.off },
            { value: 'chip1', label: '2.4 GHz' },
            { value: 'chip2', label: '5 GHz' },
          ]}
        />
      )
    case 'networkMode':
      return (
        <Select<string>
          ariaLabel={t.tools.tasks.kinds.networkMode}
          value={draft.mode}
          onValueChange={(mode) => patch({ mode })}
          options={BEARER_PREFERENCES.map((mode) => ({ value: mode, label: t.radio.modes[mode].label, description: t.radio.modes[mode].hint }))}
        />
      )
    case 'simSlot':
      return v50 ? (
        <Select<string>
          ariaLabel={t.tools.tasks.kinds.simSlot}
          value={draft.simSlot}
          onValueChange={(simSlot) => patch({ simSlot })}
          options={Object.entries(t.tools.tasks.v50Slots).map(([value, label]) => ({ value, label }))}
        />
      ) : (
        <SegmentedControl
          fullWidth
          ariaLabel={t.tools.tasks.kinds.simSlot}
          value={draft.simSlot === '1' ? '1' : '0'}
          onChange={(simSlot) => patch({ simSlot })}
          options={[
            { value: '0', label: 'SIM 1' },
            { value: '1', label: 'SIM 2' },
          ]}
        />
      )
    case 'lockCell':
      return (
        <div className="flex flex-col gap-4">
          <SegmentedControl
            fullWidth
            ariaLabel={t.tools.tasks.rat}
            value={draft.rat}
            onChange={(rat) => patch({ rat })}
            options={[
              { value: '16', label: '5G NR' },
              { value: '12', label: '4G LTE' },
            ]}
          />
          <div className="grid grid-cols-2 gap-3">
            <Field label="PCI" error={message('pci')}>
              {(id) => <IntegerInput id={id} value={draft.pci} onValueChange={(pci) => patch({ pci })} placeholder="912" maxLength={4} />}
            </Field>
            <Field label={draft.rat === '16' ? 'NR-ARFCN' : 'EARFCN'} error={message('earfcn')}>
              {(id) => <IntegerInput id={id} value={draft.earfcn} onValueChange={(earfcn) => patch({ earfcn })} placeholder="504990" maxLength={7} />}
            </Field>
          </div>
        </div>
      )
    case 'sendSms':
      return (
        <div className="flex flex-col gap-4">
          <Field label={t.tools.tasks.smsNumber} error={message('number')}>
            {(id) => <Input id={id} value={draft.number} onValueChange={(number) => patch({ number })} inputMode="tel" placeholder="10086" maxLength={24} />}
          </Field>
          <Field label={t.tools.tasks.smsBody} error={message('body')}>
            {(id) => <Textarea id={id} value={draft.body} onChange={(event) => patch({ body: event.target.value })} placeholder={t.tools.tasks.smsPlaceholder} rows={3} />}
          </Field>
        </div>
      )
    case 'forwardInfo':
      return <p className="-mt-2 text-footnote text-text-3">{t.tools.tasks.forwardHint}</p>
    case 'custom':
      return (
        <Field label={t.tools.tasks.customLabel} hint={t.tools.tasks.customHint} error={message('json', 'goformId')}>
          {(id) => (
            <Textarea
              id={id}
              value={draft.custom}
              onChange={(event) => patch({ custom: event.target.value })}
              rows={6}
              spellCheck={false}
              className="font-mono text-[13px]"
              invalid={Boolean(error)}
            />
          )}
        </Field>
      )
    default:
      return null
  }
}
