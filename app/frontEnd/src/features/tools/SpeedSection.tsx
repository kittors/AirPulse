import { CellTower, Copy, Desktop } from '@phosphor-icons/react'
import { useEffect, useState, type PointerEvent } from 'react'

import { Button } from '@/components/ui/button'
import { ListGroup, ListRow, Panel } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { InputRow } from '@/components/ui/form-rows'
import { Tooltip } from '@/components/ui/overlay'
import { SegmentedControl } from '@/components/ui/segmented'
import { Select } from '@/components/ui/select'
import { toast } from '@/components/ui/toast'
import { RollingNumber } from '@/components/viz/rolling-number'
import { areaPath, monotonePath, type Point } from '@/components/viz/curve'
import { useElementSize } from '@/hooks/useElementSize'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { formatBytes, niceCeil } from '@/lib/format'
import { storage } from '@/lib/storage'

import { relativeTime } from '../overview/parts'
import { LIMIT_SECONDS, loadHistory, saveHistory, useSpeedTest, type SpeedMode, type SpeedRecord, type SpeedSample } from './speedtest'

/** 预置的公网大文件（可改成自定义地址）：国内 CDN 优先 */
const SERVERS = [
  { id: 'qq', url: 'https://dldir1.qq.com/weixin/Windows/WeChatSetup.exe' },
  { id: 'cloudflare', url: 'https://speed.cloudflare.com/__down?bytes=200000000' },
  { id: 'cachefly', url: 'http://cachefly.cachefly.net/100mb.test' },
] as const
type ServerId = (typeof SERVERS)[number]['id'] | 'custom'

const fmt = (mbps: number | null) => (mbps == null ? '—' : mbps >= 100 ? mbps.toFixed(0) : mbps >= 10 ? mbps.toFixed(1) : mbps.toFixed(2))

/**
 * 测速：大数字是主角，下面一条随时间生长的速率曲线；局域网测设备到本机的吞吐（不耗流量），
 * 蜂窝网络经设备代理下载公网文件（耗流量，首次开始前提醒）。结果留最近 10 次。
 */
export function SpeedSection() {
  const t = useT()
  const confirm = useConfirm()
  const [mode, setMode] = useState<SpeedMode>(() => storage.get<SpeedMode>('speed-mode', 'lan'))
  const [server, setServer] = useState<ServerId>(() => storage.get<ServerId>('speed-server', 'qq'))
  const [customUrl, setCustomUrl] = useState(() => storage.get('speed-custom-url', ''))
  const [threads, setThreads] = useState<'1' | '2' | '4'>(() => storage.get<'1' | '2' | '4'>('speed-threads', '2'))
  const [history, setHistory] = useState<SpeedRecord[]>(loadHistory)
  const test = useSpeedTest((record) =>
    setHistory((list) => {
      const next = [record, ...list].slice(0, 10)
      saveHistory(next)
      return next
    }),
  )
  const { state } = test
  const running = state.phase === 'connecting' || state.phase === 'running'
  const url = server === 'custom' ? customUrl.trim() : SERVERS.find((s) => s.id === server)?.url ?? ''
  const urlValid = /^https?:\/\/[^\s/]+\.[^\s]+$/i.test(url)

  const begin = async () => {
    if (mode === 'cellular') {
      if (!urlValid) return toast.error(t.tools.speed.invalidUrl)
      if (!storage.get('speed-cellular-ack', false)) {
        const ok = await confirm({
          tone: 'warning',
          title: t.tools.speed.dataTitle,
          description: t.tools.speed.dataBody,
          confirmText: t.tools.speed.start,
        })
        if (!ok) return
        storage.set('speed-cellular-ack', true)
      }
    }
    void test.start(mode, { url, threads: Number(threads) })
  }

  const shown = state.mode === mode ? state : null
  const value = shown && shown.phase !== 'idle' && shown.phase !== 'error' ? shown.current : null
  // 统计行一直在（没开测时是灰色的 0），开测 / 出错都不改变面板高度；
  // 测速中平均值按「已收字节 ÷ 已用时间」实时算，和测完的口径一致
  const live = shown && shown.phase !== 'idle' && shown.phase !== 'error' ? shown : null
  const average = live ? (live.phase === 'done' ? live.average : live.seconds > 0 ? (live.bytes * 8) / 1e6 / live.seconds : 0) : null

  // 失败原因放进通知（同一条原地更新，连点也不叠），面板里只把状态字变红，不插行
  useEffect(() => {
    if (state.phase === 'error') toast.error(t.tools.speed.failed, { description: state.error ?? undefined, key: 'speedtest' })
  }, [state.phase, state.error, t])

  return (
    <div className="@container">
      <div className="grid grid-cols-1 items-start gap-6 @4xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex flex-col gap-7">
          <Panel className="flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <SegmentedControl
                ariaLabel={t.tools.speed.mode}
                value={mode}
                disabled={running}
                onChange={(next) => {
                  setMode(next)
                  storage.set('speed-mode', next)
                }}
                options={[
                  { value: 'lan', label: t.tools.speed.lan },
                  { value: 'cellular', label: t.tools.speed.cellular },
                ]}
              />
              <span className={cn('text-footnote', shown?.phase === 'error' ? 'text-danger-text' : 'text-text-3')}>{statusText(t, shown, mode)}</span>
            </div>

            <div className="mt-6 flex items-end justify-between gap-4 max-sm:mt-5">
              <div>
                <p className="text-footnote font-medium text-text-2">{shown?.phase === 'done' ? t.tools.speed.average : t.tools.speed.download}</p>
                <p className={cn('mt-1 flex items-baseline gap-2', value == null ? 'text-text-4' : 'text-text')}>
                  <span className="num text-display max-sm:text-[52px] max-sm:leading-[52px]">
                    {value == null ? '0' : <RollingNumber value={fmt(value)} />}
                  </span>
                  <span className="text-headline text-text-3">Mbps</span>
                </p>
              </div>
              <Button size="lg" variant={running ? 'secondary' : 'primary'} className="min-w-28 max-sm:hidden" onClick={() => (running ? test.stop() : void begin())}>
                {running ? t.tools.speed.stop : shown?.phase === 'done' ? t.tools.speed.again : t.tools.speed.start}
              </Button>
            </div>

            <SpeedTrace samples={shown?.samples ?? []} limit={LIMIT_SECONDS[mode]} running={running} />

            {/* 曲线下方还挂着时间轴刻度（-bottom-5），统计行要让开 */}
            <dl className="mt-10 grid grid-cols-4 gap-4 max-sm:grid-cols-2 max-sm:gap-y-3">
              <Stat label={t.tools.speed.average} value={live ? fmt(average) : '0'} unit="Mbps" muted={!live} />
              <Stat label={t.tools.speed.peak} value={live ? fmt(live.peak ?? 0) : '0'} unit="Mbps" muted={!live} />
              <Stat label={t.tools.speed.received} {...bytesOf(live?.bytes ?? 0)} muted={!live} />
              <Stat label={t.tools.speed.elapsed} value={(live?.seconds ?? 0).toFixed(1)} unit={t.units.seconds} muted={!live} />
            </dl>

            <Button size="lg" variant={running ? 'secondary' : 'primary'} className="mt-5 w-full sm:hidden" onClick={() => (running ? test.stop() : void begin())}>
              {running ? t.tools.speed.stop : shown?.phase === 'done' ? t.tools.speed.again : t.tools.speed.start}
            </Button>
          </Panel>

          {mode === 'cellular' ? (
            <ListGroup title={t.tools.speed.cellularOptions} footer={t.tools.speed.cellularFooter}>
              <ListRow
                title={t.tools.speed.server}
                trailing={
                  <Select<ServerId>
                    size="sm"
                    className="w-44 max-sm:w-40"
                    value={server}
                    disabled={running}
                    ariaLabel={t.tools.speed.server}
                    onValueChange={(next) => {
                      setServer(next)
                      storage.set('speed-server', next)
                    }}
                    options={[
                      ...SERVERS.map((s) => ({ value: s.id as ServerId, label: t.tools.speed.servers[s.id] })),
                      { value: 'custom' as const, label: t.tools.speed.servers.custom },
                    ]}
                  />
                }
              />
              {server === 'custom' && (
                <InputRow
                  label={t.tools.speed.url}
                  value={customUrl}
                  onChange={(v) => {
                    setCustomUrl(v)
                    storage.set('speed-custom-url', v)
                  }}
                  placeholder="https://…"
                  inputMode="url"
                  disabled={running}
                  error={customUrl.trim() && !urlValid ? t.tools.speed.invalidUrl : null}
                />
              )}
              <ListRow
                title={t.tools.speed.threads}
                subtitle={t.tools.speed.threadsHint}
                trailing={
                  <SegmentedControl
                    size="sm"
                    ariaLabel={t.tools.speed.threads}
                    value={threads}
                    disabled={running}
                    onChange={(next) => {
                      setThreads(next)
                      storage.set('speed-threads', next)
                    }}
                    options={[
                      { value: '1', label: '1' },
                      { value: '2', label: '2' },
                      { value: '4', label: '4' },
                    ]}
                  />
                }
              />
            </ListGroup>
          ) : (
            <p className="-mt-3 px-4 text-footnote text-text-3 max-sm:px-3">{t.tools.speed.lanFooter}</p>
          )}
        </div>

        <div className="flex flex-col gap-7">
          <HistoryGroup
            history={history}
            onClear={() => {
              setHistory([])
              saveHistory([])
            }}
          />
          <IperfGroup />
        </div>
      </div>
    </div>
  )
}

function statusText(t: ReturnType<typeof useT>, state: ReturnType<typeof useSpeedTest>['state'] | null, mode: SpeedMode): string {
  if (!state || state.phase === 'idle') return t.tools.speed.ready(LIMIT_SECONDS[mode])
  if (state.phase === 'connecting') return t.tools.speed.connecting
  if (state.phase === 'running') return t.tools.speed.runningFor(Math.min(LIMIT_SECONDS[mode], Math.floor(state.seconds)))
  if (state.phase === 'error') return t.tools.speed.failed
  return state.stopped ? t.tools.speed.stopped : t.tools.speed.finished
}

const bytesOf = (bytes: number) => {
  if (!bytes) return { value: '0', unit: 'MB' }
  const q = formatBytes(bytes)
  return { value: q.value, unit: q.unit }
}

function Stat({ label, value, unit, muted = false }: { label: string; value: string; unit: string; muted?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-caption text-text-3">{label}</dt>
      <dd className="mt-0.5 flex items-baseline gap-1">
        <span className={cn('num text-headline', muted ? 'text-text-4' : 'text-text')}>{value}</span>
        <span className="text-caption text-text-3">{unit}</span>
      </dd>
    </div>
  )
}

/** 速率曲线：横轴固定为整个测速时长，线条从左往右生长；悬停看任一时刻的读数 */
function SpeedTrace({ samples, limit, running }: { samples: SpeedSample[]; limit: number; running: boolean }) {
  const t = useT()
  const [ref, { width }] = useElementSize<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const height = 132
  const top = 10
  const peak = Math.max(0, ...samples.map((s) => s.mbps))
  const max = niceCeil(Math.max(peak * 1.15, 10))
  const x = (seconds: number) => (Math.min(seconds, limit) / limit) * width
  const y = (mbps: number) => top + (1 - mbps / max) * (height - top - 1)
  const points: Point[] = width ? [[0, y(0)], ...samples.map((s): Point => [x(s.t), y(s.mbps)])] : []
  const active = hover != null ? samples[hover] : null

  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!samples.length) return
    const rect = event.currentTarget.getBoundingClientRect()
    const seconds = ((event.clientX - rect.left) / rect.width) * limit
    let best = 0
    samples.forEach((s, i) => {
      if (Math.abs(s.t - seconds) < Math.abs(samples[best].t - seconds)) best = i
    })
    setHover(best)
  }

  return (
    <div ref={ref} className="relative mt-5 w-full" style={{ height }} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
      {width > 0 && (
        <svg width={width} height={height} className="block overflow-visible" aria-hidden>
          <line x1={0} x2={width} y1={y(max / 2)} y2={y(max / 2)} stroke="var(--color-line)" strokeDasharray="2 4" />
          <line x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} stroke="var(--color-line)" />
          {points.length > 1 && (
            <>
              <path d={areaPath(points, height)} fill="var(--color-series-down)" fillOpacity={0.12} />
              <path d={monotonePath(points)} fill="none" stroke="var(--color-series-down)" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            </>
          )}
          {running && points.length > 1 && <circle cx={points.at(-1)![0]} cy={points.at(-1)![1]} r={4} fill="var(--color-series-down)" stroke="var(--color-surface)" strokeWidth={2} />}
          {active && (
            <>
              <line x1={x(active.t)} x2={x(active.t)} y1={top} y2={height} stroke="var(--color-border-strong)" />
              <circle cx={x(active.t)} cy={y(active.mbps)} r={4} fill="var(--color-series-down)" stroke="var(--color-surface)" strokeWidth={2} />
            </>
          )}
        </svg>
      )}
      <span className="pointer-events-none absolute top-0 left-0 -translate-y-1/2 text-caption2 text-text-4 tabular-nums">{max} Mbps</span>
      <span className="pointer-events-none absolute right-0 -bottom-5 text-caption2 text-text-4 tabular-nums">{t.tools.speed.seconds(limit)}</span>
      <span className="pointer-events-none absolute -bottom-5 left-0 text-caption2 text-text-4 tabular-nums">0</span>
      {active && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full rounded-[8px] bg-text px-2 py-1 text-caption whitespace-nowrap text-bg shadow-overlay"
          style={{ left: Math.min(Math.max(x(active.t), 40), width - 40) }}
        >
          <span className="num font-semibold">{fmt(active.mbps)}</span> Mbps · {active.t.toFixed(1)} s
        </div>
      )}
    </div>
  )
}

function HistoryGroup({ history, onClear }: { history: SpeedRecord[]; onClear: () => void }) {
  const t = useT()
  if (!history.length) {
    return (
      <ListGroup title={t.tools.speed.history}>
        <p className="px-4 py-6 text-center text-footnote text-text-3">{t.tools.speed.noHistory}</p>
      </ListGroup>
    )
  }
  return (
    <ListGroup
      title={t.tools.speed.history}
      footer={
        <button type="button" onClick={onClear} className="text-accent-text hover:underline">
          {t.tools.speed.clearHistory}
        </button>
      }
    >
      {history.map((record) => {
        const Icon = record.mode === 'lan' ? Desktop : CellTower
        return (
          <ListRow
            key={record.at}
            leading={<Icon className="size-[18px] text-text-3" />}
            title={
              <span className="flex items-baseline gap-1">
                <span className="num font-semibold">{fmt(record.average)}</span>
                <span className="text-footnote text-text-3">Mbps</span>
              </span>
            }
            subtitle={`${record.mode === 'lan' ? t.tools.speed.lan : t.tools.speed.cellular} · ${t.tools.speed.peak} ${fmt(record.peak)}`}
            trailing={<span className="text-footnote text-text-3">{relativeTime(t, record.at)}</span>}
          />
        )
      })}
    </ListGroup>
  )
}

function IperfGroup() {
  const t = useT()
  const host = ['localhost', '127.0.0.1', '::1', '[::1]'].includes(window.location.hostname) ? '192.168.0.1' : window.location.hostname
  const rows = [
    { title: t.tools.speed.iperfDown, command: `iperf3 -c ${host} -R` },
    { title: t.tools.speed.iperfUp, command: `iperf3 -c ${host}` },
  ]
  return (
    <ListGroup title="iperf3" footer={t.tools.speed.iperfFooter}>
      {rows.map((row) => (
        <ListRow
          key={row.command}
          title={row.title}
          subtitle={<span className="font-mono text-[12px] text-text-2">{row.command}</span>}
          trailing={
            <Tooltip content={t.common.copy}>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t.common.copy}
                onClick={() => void copyText(row.command).then((ok) => (ok ? toast.success(t.common.copied) : toast.error(t.common.copyFailed)))}
              >
                <Copy />
              </Button>
            </Tooltip>
          }
        />
      ))}
    </ListGroup>
  )
}
