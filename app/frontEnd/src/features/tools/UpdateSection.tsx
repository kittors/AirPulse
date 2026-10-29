import { ArrowClockwise, CheckCircle, Circle, FileArrowUp, Warning, XCircle } from '@phosphor-icons/react'
import { useQuery } from '@tanstack/react-query'
import { useEffect, useRef, useState, type DragEvent } from 'react'

import { rootShell } from '@/api/advanced'
import { deviceApi } from '@/api/device'
import { compareVersions, otaApi, parseApkName } from '@/api/ota'
import type { VersionInfo } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { Callout, Skeleton, Spinner } from '@/components/ui/feedback'
import { Meter } from '@/components/ui/meter'
import { useTelemetry } from '@/hooks/useTelemetry'
import { useT } from '@/i18n'
import { cn } from '@/lib/cn'
import { isApiError, errorMessage } from '@/lib/errors'
import { formatBytes, joinQuantity } from '@/lib/format'
import { createStore, useStore } from '@/lib/store'
import { versionInfoQuery } from '@/hooks/queries'

import { storageQuery, useCapabilities } from './keys'

type StepId = 'upload' | 'transfer' | 'install' | 'restart'
type StepState = 'pending' | 'active' | 'done' | 'error'

interface Flow {
  phase: 'idle' | 'running' | 'success' | 'failed'
  file: { name: string; size: number } | null
  steps: Record<StepId, StepState>
  progress: number
  /** 等待服务恢复已用秒数 */
  waited: number
  error: string | null
  before: VersionInfo | null
  after: VersionInfo | null
  log: string | null
}

const STEPS: StepId[] = ['upload', 'transfer', 'install', 'restart']
const IDLE_FLOW: Flow = {
  phase: 'idle',
  file: null,
  steps: { upload: 'pending', transfer: 'pending', install: 'pending', restart: 'pending' },
  progress: 0,
  waited: 0,
  error: null,
  before: null,
  after: null,
  log: null,
}
const MAX_BYTES = 200 * 1024 * 1024

/** 安装过程放在模块里：切到别的页面再回来，进度还在（安装期间服务会中断，不能靠组件状态） */
const flowStore = createStore<Flow>(IDLE_FLOW)
const patchFlow = (next: Partial<Flow> | ((flow: Flow) => Partial<Flow>)) => {
  const flow = flowStore.get()
  flowStore.set({ ...flow, ...(typeof next === 'function' ? next(flow) : next) })
}
const setStep = (id: StepId, state: StepState) => patchFlow((f) => ({ steps: { ...f.steps, [id]: state } }))
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let uploadAbort: AbortController | null = null

async function runInstall(file: File, hasRootChannel: boolean) {
  const before = await deviceApi.versionInfo().catch(() => null)
  flowStore.set({ ...IDLE_FLOW, phase: 'running', file: { name: file.name, size: file.size }, before })
  const fail = (step: StepId, error: string) => {
    setStep(step, 'error')
    patchFlow({ phase: 'failed', error })
  }

  // 1. 上传到设备
  setStep('upload', 'active')
  uploadAbort = new AbortController()
  let url = ''
  try {
    const res = await otaApi.upload(file, (loaded, total) => patchFlow({ progress: total ? loaded / total : 0 }), uploadAbort.signal)
    url = String(res.url ?? '')
    if (!url) throw new Error('upload_img 没有返回地址')
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return flowStore.set(IDLE_FLOW)
    return fail('upload', errorMessage(error))
  } finally {
    uploadAbort = null
  }
  setStep('upload', 'done')
  const uploaded = url.split('/').pop() ?? ''

  // 2. 让后端从本机地址「下载」，以 status == done 为准
  setStep('transfer', 'active')
  patchFlow({ progress: 0 })
  try {
    await otaApi.startDownload(url)
    const started = Date.now()
    for (;;) {
      await sleep(400)
      const status = await otaApi.downloadStatus()
      patchFlow({ progress: status.percent / 100 })
      if (status.status === 'done') break
      if (status.status === 'error') throw new Error(status.error || 'download failed')
      if (Date.now() - started > 60_000) throw new Error('timeout')
    }
  } catch (error) {
    void otaApi.cleanup(uploaded)
    return fail('transfer', errorMessage(error))
  }
  setStep('transfer', 'done')
  void otaApi.cleanup(uploaded)

  // 3. 安装：成功返回只代表脚本已启动；进程被替换时请求会直接断开，也算正常
  setStep('install', 'active')
  try {
    await otaApi.install()
  } catch (error) {
    if (!isApiError(error, 'network') && !isApiError(error, 'timeout')) return fail('install', errorMessage(error))
  }
  setStep('install', 'done')

  // 4. 等服务恢复并核对版本：先看到服务下线再恢复才算「重启过」；60 秒都没重启说明安装没成功
  setStep('restart', 'active')
  const started = Date.now()
  let sawDown = false
  for (;;) {
    await sleep(2_000)
    const waited = Math.round((Date.now() - started) / 1000)
    patchFlow({ waited })
    const info = await deviceApi.versionInfo().catch(() => null)
    if (!info) {
      sawDown = true
      if (waited > 180) return fail('restart', 'timeout')
      continue
    }
    const changed = info.app_ver !== before?.app_ver || info.app_ver_code !== before?.app_ver_code
    if (changed) {
      setStep('restart', 'done')
      return patchFlow({ phase: 'success', after: info })
    }
    if (sawDown || waited > 60) {
      const log = hasRootChannel ? await rootShell('tail -n 20 /sdcard/ufi_tools_update.log 2>&1', 8_000).catch(() => null) : null
      setStep('restart', 'error')
      return patchFlow({ phase: 'failed', after: info, error: sawDown ? 'unchanged' : 'not-restarted', log })
    }
  }
}

/**
 * 系统更新：只支持本地上传安装包（不做在线 OTA）。选好文件先做预检——安装通道、存储空间、
 * 版本新旧——再一步步执行：上传、交给安装器、安装、等服务恢复并核对版本。
 */
export function UpdateSection() {
  const t = useT()
  const flow = useStore(flowStore)
  return (
    <div className="flex w-full max-w-[720px] flex-col gap-6">
      <CurrentVersion />
      {flow.phase === 'idle' ? <Picker /> : <Progress flow={flow} />}
      <p className="px-4 text-footnote text-text-3 max-sm:px-3">{t.tools.update.footer}</p>
    </div>
  )
}

function CurrentVersion() {
  const t = useT()
  const version = useQuery(versionInfoQuery)
  const { data: telemetry } = useTelemetry()
  const caps = useCapabilities()
  const channel = caps.data ? (caps.data.root ? 'root' : caps.data.adb ? 'adb' : 'none') : null
  const build = version.data?.app_ver_code
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="min-w-0 flex-1">
          <p className="text-footnote font-medium text-text-2">{t.tools.update.current}</p>
          {version.data ? (
            <p className="mt-1 flex items-baseline gap-2">
              <span className="num text-title text-text">{version.data.app_ver ?? '—'}</span>
              {build && <span className="num text-footnote text-text-3">{/^\d{8}$/.test(build) ? `${build.slice(0, 4)}-${build.slice(4, 6)}-${build.slice(6)}` : build}</span>}
            </p>
          ) : (
            <Skeleton className="mt-1 h-8 w-32" />
          )}
          <p className="mt-1 truncate text-footnote text-text-3">
            {[version.data?.model, telemetry?.device.firmware].filter(Boolean).join(' · ') || ' '}
          </p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-sunken px-3 py-1.5 text-footnote">
          {channel == null ? (
            <Spinner className="size-3.5" />
          ) : (
            <span className={cn('size-2 rounded-full', channel === 'none' ? 'bg-warning' : 'bg-success')} />
          )}
          <span className="text-text-2">{t.tools.update.channel}</span>
          <span className="font-medium text-text">{channel ? t.tools.update.channels[channel] : '…'}</span>
        </div>
      </div>
    </Panel>
  )
}

function Picker() {
  const t = useT()
  const confirm = useConfirm()
  const caps = useCapabilities()
  const version = useQuery(versionInfoQuery)
  const info = useQuery(storageQuery)
  const input = useRef<HTMLInputElement>(null)
  const [file, setFile] = useState<File | null>(null)
  const [dragging, setDragging] = useState(false)

  const choose = (next: File | undefined | null) => {
    if (next) setFile(next)
  }
  const onDrop = (event: DragEvent<HTMLButtonElement>) => {
    event.preventDefault()
    setDragging(false)
    choose(event.dataTransfer.files?.[0])
  }

  const channelOk = Boolean(caps.data && (caps.data.root || caps.data.adb))
  const isApk = Boolean(file && /\.apk$/i.test(file.name) && file.size > 0)
  const tooLarge = Boolean(file && file.size > MAX_BYTES)
  const available = info.data?.internal_available_storage ?? null
  const needed = file ? file.size * 2.2 : 0
  const storageOk = available == null || available >= needed
  const parsed = file ? parseApkName(file.name) : null
  const current = version.data?.app_ver
  const cmp = parsed?.version && current ? compareVersions(parsed.version, current) : null
  const older = cmp != null && (cmp < 0 || (cmp === 0 && parsed?.build != null && version.data?.app_ver_code != null && parsed.build < version.data.app_ver_code))
  const blocked = !file || !isApk || tooLarge || !channelOk || !storageOk

  const start = async () => {
    if (!file || blocked) return
    const ok = await confirm({
      tone: older ? 'danger' : 'warning',
      title: t.tools.update.confirmTitle,
      description: older ? t.tools.update.confirmOlder : t.tools.update.confirmBody,
      confirmText: t.tools.update.install,
    })
    if (ok) void runInstall(file, Boolean(caps.data?.root))
  }

  return (
    <Panel>
      <PanelHeader title={t.tools.update.installTitle} />
      <input
        ref={input}
        type="file"
        accept=".apk,application/vnd.android.package-archive"
        className="hidden"
        onChange={(event) => {
          choose(event.target.files?.[0])
          event.target.value = ''
        }}
      />
      {!file ? (
        <button
          type="button"
          onClick={() => input.current?.click()}
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          className={cn(
            'flex w-full flex-col items-center justify-center gap-2 rounded-inner border-[1.5px] border-dashed px-6 py-12 text-center transition-colors',
            dragging ? 'border-accent bg-accent-soft' : 'border-border-strong hover:bg-hover',
          )}
        >
          <FileArrowUp className={cn('size-9', dragging ? 'text-accent' : 'text-text-4')} weight="light" />
          <span className="text-body text-text">
            {t.tools.update.dropPrefix}
            <span className="font-medium text-accent-text">{t.tools.update.choose}</span>
          </span>
          <span className="text-footnote text-text-3">{t.tools.update.dropHint}</span>
        </button>
      ) : (
        <>
          <div className="flex items-center gap-3 rounded-inner bg-sunken px-4 py-3">
            <FileArrowUp className="size-6 shrink-0 text-text-3" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-body font-medium text-text">{file.name}</p>
              <p className="text-footnote text-text-3">
                {joinQuantity(formatBytes(file.size))}
                {parsed?.version && ` · ${t.tools.update.versionOf(parsed.version)}`}
              </p>
            </div>
            <Button size="sm" variant="ghost" onClick={() => setFile(null)}>
              {t.tools.update.rechoose}
            </Button>
          </div>

          <ul className="mt-4 flex flex-col gap-2.5">
            <Check ok={isApk && !tooLarge} label={t.tools.update.checkFile} detail={!isApk ? t.tools.update.notApk : tooLarge ? t.tools.update.tooLarge : t.tools.update.fileOk} />
            <Check
              ok={channelOk}
              pending={!caps.data}
              label={t.tools.update.checkChannel}
              detail={caps.data ? (caps.data.root ? t.tools.update.channels.root : caps.data.adb ? t.tools.update.channels.adb : t.tools.update.noChannel) : ''}
            />
            <Check
              ok={storageOk}
              pending={!info.data && !info.isError}
              label={t.tools.update.checkStorage}
              detail={available == null ? t.tools.update.storageUnknown : t.tools.update.storageFree(joinQuantity(formatBytes(available)), joinQuantity(formatBytes(needed)))}
            />
            {cmp != null && (
              <Check
                ok={!older}
                warn={older}
                label={t.tools.update.checkVersion}
                detail={older ? t.tools.update.olderVersion(current ?? '') : cmp === 0 ? t.tools.update.sameVersion : t.tools.update.newerVersion(current ?? '')}
              />
            )}
          </ul>

          <Callout className="mt-4" tone="neutral" icon={<Warning weight="fill" />}>
            {t.tools.update.notes}
          </Callout>

          <div className="mt-5 flex justify-end gap-2 max-sm:[&>*]:flex-1">
            <Button variant="primary" size="lg" disabled={blocked} onClick={() => void start()}>
              {t.tools.update.install}
            </Button>
          </div>
        </>
      )}
    </Panel>
  )
}

function Check({ ok, pending, warn, label, detail }: { ok: boolean; pending?: boolean; warn?: boolean; label: string; detail: string }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 shrink-0">
        {pending ? (
          <Spinner className="size-[18px]" />
        ) : ok ? (
          <CheckCircle className="size-[18px] text-success" weight="fill" />
        ) : warn ? (
          <Warning className="size-[18px] text-warning" weight="fill" />
        ) : (
          <XCircle className="size-[18px] text-danger" weight="fill" />
        )}
      </span>
      <div className="min-w-0">
        <p className="text-subhead text-text">{label}</p>
        {detail && <p className={cn('text-footnote', !ok && !pending ? (warn ? 'text-warning-text' : 'text-danger-text') : 'text-text-3')}>{detail}</p>}
      </div>
    </li>
  )
}

function Progress({ flow }: { flow: Flow }) {
  const t = useT()
  // 成功后提示刷新：新版前端随安装包一起更新
  const [reloading, setReloading] = useState(false)
  useEffect(() => {
    if (flow.phase === 'success') document.title = `${t.tools.update.successTitle} · AirPulse`
  }, [flow.phase, t])

  const detail = (id: StepId): string | null => {
    const state = flow.steps[id]
    if (id === 'upload' && state === 'active') return `${Math.round(flow.progress * 100)}% · ${joinQuantity(formatBytes((flow.file?.size ?? 0) * flow.progress))} / ${joinQuantity(formatBytes(flow.file?.size ?? 0))}`
    if (id === 'transfer' && state === 'active') return `${Math.round(flow.progress * 100)}%`
    if (id === 'install' && state === 'active') return t.tools.update.installing
    if (id === 'restart' && state === 'active') return t.tools.update.waiting(flow.waited)
    return null
  }

  return (
    <Panel>
      <PanelHeader
        title={flow.phase === 'success' ? t.tools.update.successTitle : flow.phase === 'failed' ? t.tools.update.failedTitle : t.tools.update.runningTitle}
        detail={flow.file?.name}
      />
      <ol className="flex flex-col">
        {STEPS.map((id, index) => {
          const state = flow.steps[id]
          const text = detail(id)
          return (
            <li key={id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < STEPS.length - 1 && (
                <span aria-hidden className={cn('absolute top-6 bottom-0 left-[9px] w-px', state === 'done' ? 'bg-success/50' : 'bg-line')} />
              )}
              <span className="relative z-10 grid size-5 shrink-0 place-items-center bg-surface">
                {state === 'done' ? (
                  <CheckCircle className="size-5 text-success" weight="fill" />
                ) : state === 'error' ? (
                  <XCircle className="size-5 text-danger" weight="fill" />
                ) : state === 'active' ? (
                  <Spinner className="size-5 text-accent" />
                ) : (
                  <Circle className="size-5 text-text-4" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-subhead', state === 'pending' ? 'text-text-3' : 'text-text', state === 'active' && 'font-medium')}>{t.tools.update.steps[id]}</p>
                {text && <p className="num mt-0.5 text-footnote text-text-3">{text}</p>}
                {(id === 'upload' || id === 'transfer') && state === 'active' && (
                  <Meter className="mt-2 max-w-80" value={flow.progress} max={1} tone="accent" size="sm" />
                )}
              </div>
              {id === 'upload' && state === 'active' && (
                <Button size="sm" variant="ghost" onClick={() => uploadAbort?.abort()}>
                  {t.common.cancel}
                </Button>
              )}
            </li>
          )
        })}
      </ol>

      {flow.phase === 'success' && (
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-inner bg-success-soft px-4 py-3">
          <p className="text-subhead text-success-text">{t.tools.update.successBody(flow.after?.app_ver ?? '')}</p>
          <Button
            variant="primary"
            icon={<ArrowClockwise weight="bold" />}
            loading={reloading}
            onClick={() => {
              setReloading(true)
              flowStore.set(IDLE_FLOW)
              window.location.reload()
            }}
          >
            {t.tools.update.reload}
          </Button>
        </div>
      )}

      {flow.phase === 'failed' && (
        <div className="mt-5 flex flex-col gap-3">
          <Callout tone="danger" icon={<XCircle weight="fill" />} title={failureTitle(t, flow)}>
            {failureBody(t, flow)}
          </Callout>
          {flow.log && <pre className="max-h-56 overflow-auto rounded-inner bg-sunken px-3.5 py-3 font-mono text-[12px] leading-5 whitespace-pre-wrap text-text-2">{flow.log}</pre>}
          <div className="flex justify-end">
            <Button variant="secondary" onClick={() => flowStore.set(IDLE_FLOW)}>
              {t.tools.update.again}
            </Button>
          </div>
        </div>
      )}
    </Panel>
  )
}

function failureTitle(t: ReturnType<typeof useT>, flow: Flow): string {
  const step = STEPS.find((id) => flow.steps[id] === 'error')
  return step ? t.tools.update.failedAt(t.tools.update.steps[step]) : t.tools.update.failedTitle
}

function failureBody(t: ReturnType<typeof useT>, flow: Flow): string {
  if (flow.error === 'unchanged') return t.tools.update.unchanged
  if (flow.error === 'not-restarted') return t.tools.update.notRestarted
  if (flow.error === 'timeout') return t.tools.update.timeout
  return flow.error ?? ''
}
