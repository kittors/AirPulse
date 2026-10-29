import { ArrowRight, Broom, Copy, PaperPlaneRight, Warning } from '@phosphor-icons/react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useRef, useState, type KeyboardEvent } from 'react'

import { advancedApi } from '@/api/advanced'
import { runAt } from '@/api/at'
import { atSlotFor } from '@/api/device'
import { hrefOf } from '@/app/router'
import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, Panel, PanelHeader } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Spinner } from '@/components/ui/feedback'
import { Tooltip } from '@/components/ui/overlay'
import { SegmentedControl } from '@/components/ui/segmented'
import { toast } from '@/components/ui/toast'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT, type Messages } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { spring } from '@/lib/motion'
import { storage } from '@/lib/storage'
import { createStore, useStore } from '@/lib/store'
import { classifyAt, forbiddenAtChar, formatAtOutput, isAtError, normalizeAt } from '@/model/at'
import { parseQos } from '@/model/telemetry'

import { useRoot } from './keys'

interface AtEntry {
  id: number
  command: string
  slot: number
  status: 'running' | 'done' | 'failed'
  output?: string
  error?: string
  ms?: number
  /** 不是 AT，而是 root shell 里跑的工具（如 imei_reader） */
  via?: 'root'
}

/** 记录留在内存里：切到别的工具再回来，刚才的输出还在 */
const transcriptStore = createStore<AtEntry[]>([])
let seq = 0
const HISTORY_KEY = 'at-history'
const HISTORY_MAX = 20

const PRESETS: { key: keyof Messages['tools']['at']['presets']; command: string }[] = [
  { key: 'qos', command: 'AT+CGEQOSRDP=1' },
  { key: 'imei', command: 'AT+CGSN' },
  { key: 'imsi', command: 'AT+CIMI' },
  { key: 'firmware', command: 'AT+CGMR' },
]

/** 往记录里加一条，执行完把结果（或错误）补上 */
async function record(entry: Pick<AtEntry, 'command' | 'slot' | 'via'>, run: () => Promise<string>) {
  const id = ++seq
  transcriptStore.set([...transcriptStore.get(), { ...entry, id, status: 'running' as const }].slice(-80))
  const started = performance.now()
  const patch = (next: Partial<AtEntry>) =>
    transcriptStore.set(transcriptStore.get().map((item) => (item.id === id ? { ...item, ...next, ms: performance.now() - started } : item)))
  try {
    patch({ status: 'done', output: await run() })
  } catch (error) {
    patch({ status: 'failed', error: errorMessage(error) })
  }
}

/**
 * AT 指令：左边是终端（记录在上、输入在下，↑↓ 翻历史），右边是常用指令。
 * 只读查询直接执行；写入指令确认一次；断网、改串号这类高危指令红色确认并写明后果。
 */
export function AtSection() {
  const t = useT()
  const confirm = useConfirm()
  const { data: telemetry } = useTelemetry()
  const entries = useStore(transcriptStore)
  const root = useRoot()
  const [slot, setSlot] = useState<'0' | '1' | null>(null)
  const currentSlot = slot ?? (telemetry ? (String(atSlotFor(telemetry)) as '0' | '1') : '0')

  const execute = async (raw: string) => {
    const command = normalizeAt(raw)
    if (!command) return false
    if (forbiddenAtChar(command)) return false
    const risk = classifyAt(command)
    if (risk !== 'read') {
      const ok = await confirm({
        tone: risk === 'danger' ? 'danger' : 'default',
        title: risk === 'danger' ? t.tools.at.dangerTitle : t.tools.at.writeTitle,
        description: risk === 'danger' ? dangerHint(command, t) : t.tools.at.writeBody,
        details: <code className="block rounded-[8px] bg-sunken px-3 py-2 text-left font-mono text-[13px] break-all text-text">{command}</code>,
        confirmText: risk === 'danger' ? t.tools.at.runAnyway : t.tools.at.run,
      })
      if (!ok) return false
    }
    remember(command)
    // 不等执行完：输入框马上清空好输下一条（runAt 自己排队，按顺序发给基带）
    void record({ command, slot: Number(currentSlot) }, () => runAt(command, Number(currentSlot)))
    return true
  }

  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_300px]">
        <Panel className="flex flex-col">
          <PanelHeader
            title={t.tools.at.terminal}
            action={
              <>
                <SegmentedControl
                  size="sm"
                  ariaLabel={t.tools.at.slot}
                  value={currentSlot}
                  onChange={setSlot}
                  options={[
                    { value: '0', label: 'SIM 1' },
                    { value: '1', label: 'SIM 2' },
                  ]}
                />
                {entries.length > 0 && (
                  <Tooltip content={t.tools.at.clear}>
                    <Button variant="ghost" size="icon-sm" aria-label={t.tools.at.clear} onClick={() => transcriptStore.set([])}>
                      <Broom />
                    </Button>
                  </Tooltip>
                )}
              </>
            }
          />
          <Transcript entries={entries} />
          <Composer onRun={execute} />
        </Panel>

        <div className="flex flex-col gap-7">
          <ListGroup title={t.tools.at.queries}>
            {PRESETS.map((preset) => (
              <ListRow
                key={preset.key}
                title={t.tools.at.presets[preset.key]}
                subtitle={<span className="font-mono text-[12px]">{preset.command}</span>}
                trailing={<ArrowRight className="size-4 text-text-4" />}
                onClick={() => void execute(preset.command)}
              />
            ))}
            <ListRow
              title={t.tools.at.deepImei}
              subtitle={root.data ? t.tools.at.deepImeiHint : t.tools.at.needsRoot}
              disabled={!root.data}
              trailing={<ArrowRight className="size-4 text-text-4" />}
              onClick={() => void record({ command: 'imei_reader', slot: Number(currentSlot), via: 'root' }, advancedApi.readImeiDeep)}
            />
          </ListGroup>
          <ListGroup title={t.tools.at.dangerGroup} footer={t.tools.at.footer}>
            <ListRow
              title={<span className="text-danger-text">{t.tools.at.resetModem}</span>}
              subtitle={<span className="font-mono text-[12px]">AT+CFUN=1,1</span>}
              onClick={() => void execute('AT+CFUN=1,1')}
            />
          </ListGroup>
          <p className="-mt-4 px-4 text-footnote text-text-3 max-sm:px-3">
            {t.tools.at.relatedPrefix}
            <a href={hrefOf('settings', 'network')} className="text-accent-text hover:underline">
              {t.tools.at.relatedLink}
            </a>
          </p>
        </div>
      </div>
    </div>
  )
}

function dangerHint(command: string, t: Messages): string {
  if (/^AT\+(CFUN|SFUN)=/i.test(command)) return t.tools.at.hints.cfun
  if (/^AT\+(SPIMEI|EGMR)=/i.test(command)) return t.tools.at.hints.imei
  if (/^AT\+(CGDCONT|COPS)=/i.test(command)) return t.tools.at.hints.dial
  if (/^AT\+SP5GCMDS="set/i.test(command)) return t.tools.at.hints.nr
  if (/^AT\+(CLCK|CPWD|CPIN)=/i.test(command)) return t.tools.at.hints.sim
  return t.tools.at.hints.generic
}

function remember(command: string) {
  const history = storage.get<string[]>(HISTORY_KEY, []).filter((item) => item !== command)
  storage.set(HISTORY_KEY, [...history, command].slice(-HISTORY_MAX))
}

/* —— 记录 —— */

function Transcript({ entries }: { entries: AtEntry[] }) {
  const t = useT()
  const scroller = useRef<HTMLDivElement>(null)
  const last = entries.at(-1)
  // 新记录、或最后一条有了结果：贴底时跟着滚到底；用户往上翻看时不打扰
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom || last?.status === 'running') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }, [entries.length, last?.status, last])

  return (
    <div
      ref={scroller}
      className="relative h-[min(52vh,460px)] min-h-64 overflow-y-auto rounded-inner bg-sunken px-4 py-3.5 font-mono text-[13px] leading-5 max-sm:px-3"
      aria-live="polite"
    >
      {entries.length === 0 ? (
        <div className="grid h-full place-items-center text-center font-sans">
          <div className="max-w-64">
            <p className="text-subhead font-medium text-text-2">{t.tools.at.emptyTitle}</p>
            <p className="mt-1 text-footnote text-text-3">{t.tools.at.emptyBody}</p>
          </div>
        </div>
      ) : (
        <ol className="flex flex-col gap-4">
          <AnimatePresence initial={false}>
            {entries.map((entry) => (
              <motion.li key={entry.id} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={spring.snappy}>
                <Entry entry={entry} />
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </div>
  )
}

function Entry({ entry }: { entry: AtEntry }) {
  const t = useT()
  const failed = entry.status === 'failed' || (entry.output != null && isAtError(entry.output))
  const qos = entry.output && /CGEQOSRDP/i.test(entry.command) ? parseQos(entry.output) : null
  const text = entry.output != null ? formatAtOutput(entry.output) || t.tools.at.noOutput : entry.error
  return (
    <div className="group/entry">
      <div className="flex items-baseline gap-2">
        <span className="shrink-0 text-accent select-none" aria-hidden>
          ›
        </span>
        <span className="min-w-0 flex-1 font-medium break-all text-text">{entry.command}</span>
        <span className="shrink-0 font-sans text-caption text-text-3 tabular-nums">
          {entry.via === 'root' ? 'root' : `SIM ${entry.slot + 1}`}
          {entry.ms != null && entry.status !== 'running' && ` · ${(entry.ms / 1000).toFixed(1)} s`}
        </span>
        {entry.status !== 'running' && text && (
          <Tooltip content={t.common.copy}>
            <button
              type="button"
              aria-label={t.common.copy}
              onClick={() => void copyText(text).then((ok) => (ok ? toast.success(t.common.copied) : toast.error(t.common.copyFailed)))}
              className="-my-1 grid size-6 shrink-0 place-items-center rounded-full text-text-3 opacity-0 transition-opacity group-hover/entry:opacity-100 hover:bg-hover hover:text-text focus-visible:opacity-100 max-sm:opacity-100"
            >
              <Copy className="size-3.5" />
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-1 pl-4">
        {entry.status === 'running' ? (
          <span className="inline-flex items-center gap-2 font-sans text-footnote text-text-3">
            <Spinner className="size-3.5" />
            {t.tools.at.running}
          </span>
        ) : (
          <pre className={cn('font-mono whitespace-pre-wrap break-all', failed ? 'text-danger-text' : 'text-text-2')}>{text}</pre>
        )}
        {qos && (
          <p className="mt-1.5 inline-flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[8px] bg-surface px-2.5 py-1 font-sans text-footnote text-text-2 shadow-thumb">
            <span>
              QCI <b className="font-semibold text-text tabular-nums">{qos.qci}</b>
            </span>
            <span className="tabular-nums">↓ {Math.round(qos.downKbps / 1000)} Mbps</span>
            <span className="tabular-nums">↑ {Math.round(qos.upKbps / 1000)} Mbps</span>
          </p>
        )}
      </div>
    </div>
  )
}

/* —— 输入 —— */

function Composer({ onRun }: { onRun: (command: string) => Promise<boolean> }) {
  const t = useT()
  const [value, setValue] = useState('')
  const [cursor, setCursor] = useState<number | null>(null)
  const normalized = normalizeAt(value)
  const bad = forbiddenAtChar(value)
  const preview = value.trim() && !/^at/i.test(value.trim()) && !bad ? normalized : null

  const submit = async () => {
    if (!normalized || bad) return
    const ran = await onRun(value)
    if (ran) {
      setValue('')
      setCursor(null)
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault()
      void submit()
      return
    }
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    const history = storage.get<string[]>(HISTORY_KEY, [])
    if (!history.length) return
    event.preventDefault()
    const next = event.key === 'ArrowUp' ? Math.max(0, (cursor ?? history.length) - 1) : cursor == null ? null : cursor + 1
    if (next == null || next >= history.length) {
      setCursor(null)
      setValue('')
    } else {
      setCursor(next)
      setValue(history[next])
    }
  }

  return (
    <div className="mt-3">
      <div
        className={cn(
          'flex h-11 items-center gap-2 rounded-control bg-sunken pr-1.5 pl-3.5 transition-shadow duration-150',
          'focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-accent)_35%,transparent)]',
          bad && 'shadow-[0_0_0_1.5px_var(--color-danger)] focus-within:shadow-[0_0_0_3px_color-mix(in_oklab,var(--color-danger)_35%,transparent)]',
        )}
      >
        <span className="shrink-0 font-mono text-[13px] text-text-4 select-none" aria-hidden>
          ›
        </span>
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
            setCursor(null)
          }}
          onKeyDown={onKeyDown}
          placeholder={t.tools.at.placeholder}
          aria-label={t.tools.at.inputLabel}
          autoComplete="off"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="send"
          className="h-full min-w-0 flex-1 bg-transparent font-mono text-[14px] text-text outline-none placeholder:text-text-4"
        />
        <Button size="icon-sm" variant="primary" aria-label={t.tools.at.run} disabled={!normalized || Boolean(bad)} onClick={() => void submit()}>
          <PaperPlaneRight weight="fill" />
        </Button>
      </div>
      <div className="mt-1.5 flex min-h-5 items-center gap-1.5 px-1 text-footnote">
        {bad ? (
          <span className="flex items-center gap-1.5 text-danger-text">
            <Warning className="size-3.5" weight="fill" />
            {t.tools.at.forbidden(bad === '\n' || bad === '\r' ? '↵' : bad)}
          </span>
        ) : preview ? (
          <span className="text-text-3">
            {t.tools.at.willSend} <code className="font-mono text-text-2">{preview}</code>
          </span>
        ) : (
          <span className="text-text-4 max-sm:hidden">{t.tools.at.keysHint}</span>
        )}
      </div>
    </div>
  )
}
