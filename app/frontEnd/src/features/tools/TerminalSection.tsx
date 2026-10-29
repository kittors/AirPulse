import { ArrowClockwise, ArrowSquareOut, Broom, Copy, Play, PlugsConnected, TerminalWindow } from '@phosphor-icons/react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { useRef, useState } from 'react'

import { rootShell, TTYD_PORT, ttydUrl, userShell } from '@/api/advanced'
import { mockStore } from '@/api/client'
import { hrefOf } from '@/app/router'
import { Button } from '@/components/ui/button'
import { Panel, PanelHeader } from '@/components/ui/card'
import { useConfirm } from '@/components/ui/dialog'
import { EmptyState, Skeleton, Spinner } from '@/components/ui/feedback'
import { Input } from '@/components/ui/input'
import { Tooltip } from '@/components/ui/overlay'
import { SegmentedControl } from '@/components/ui/segmented'
import { toast } from '@/components/ui/toast'
import { useT } from '@/i18n'
import { copyText } from '@/lib/clipboard'
import { cn } from '@/lib/cn'
import { errorMessage } from '@/lib/errors'
import { useStore } from '@/lib/store'

import { ttydQuery, useRoot } from './keys'

/**
 * 终端：上面嵌入设备的 Web 终端（ttyd，root 身份，需要高级功能）；
 * 下面是一次性的命令执行，常用的日志、存储、进程查询一点就跑。
 */
export function TerminalSection() {
  return (
    <div className="flex flex-col gap-6">
      <WebTerminal />
      <CommandRunner />
    </div>
  )
}

/** 终端区域的高度：连接中、连不上、已连上三种状态共用，切换时版面不动 */
const FRAME = 'h-[min(62vh,560px)] rounded-inner'

/**
 * 浏览器能不能连上终端：取一下 ttyd 的 /token（只读）。跨域时拿到的是不透明响应，能拿到就说明连得上；
 * 连不上（被代理 / VPN 拦下、端口不通）时 iframe 只会一直黑着，所以先探一下，连不上就直接说明原因。
 */
async function canReach(url: string, signal: AbortSignal): Promise<boolean> {
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal.addEventListener('abort', abort)
  const timer = window.setTimeout(abort, 5_000)
  try {
    const res = await fetch(new URL('token', new URL(url, window.location.href)), { mode: 'no-cors', cache: 'no-store', signal: controller.signal })
    return res.type === 'opaque' || res.ok
  } catch {
    return false
  } finally {
    window.clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

function WebTerminal() {
  const t = useT()
  const mock = useStore(mockStore)
  const ttyd = useQuery(ttydQuery)
  const url = ttydUrl()
  const address = ttyd.data?.address || `${window.location.hostname}:${TTYD_PORT}`
  const available = Boolean(ttyd.data?.available)
  // 每次「重新连接」换一个 attempt：重新探测，iframe 也重新挂载
  const [attempt, setAttempt] = useState(0)
  const [loaded, setLoaded] = useState(-1)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const reach = useQuery({
    queryKey: ['tools', 'ttyd-reach', url, attempt],
    queryFn: ({ signal }) => canReach(url, signal),
    enabled: available && !mock,
    staleTime: 60_000,
    retry: false,
  })
  const embed = available && !mock
  return (
    <Panel>
      <PanelHeader
        title={t.tools.terminal.web}
        detail={ttyd.data ? (available ? t.tools.terminal.running(TTYD_PORT) : t.tools.terminal.notRunning) : null}
        action={
          embed && (
            <>
              <Tooltip content={t.tools.terminal.reconnect}>
                <Button variant="ghost" size="icon-sm" aria-label={t.tools.terminal.reconnect} onClick={() => setAttempt((n) => n + 1)}>
                  <ArrowClockwise />
                </Button>
              </Tooltip>
              <Button variant="secondary" size="sm" asChild>
                <a href={url} target="_blank" rel="noreferrer">
                  <ArrowSquareOut />
                  {t.tools.terminal.openTab}
                </a>
              </Button>
            </>
          )
        }
      />
      {!ttyd.data ? (
        <Skeleton className="h-72 rounded-inner" />
      ) : embed ? (
        <>
          {reach.data === false ? (
            <EmptyState
              className={cn(FRAME, 'bg-sunken')}
              icon={<PlugsConnected weight="light" />}
              title={t.tools.terminal.unreachableTitle}
              description={t.tools.terminal.unreachableBody(address)}
              action={
                <Button variant="secondary" icon={<ArrowClockwise />} onClick={() => setAttempt((n) => n + 1)}>
                  {t.common.retry}
                </Button>
              }
            />
          ) : (
            <div className={cn(FRAME, 'relative overflow-hidden bg-[#0b0b0c]')}>
              {reach.data && (
                <iframe
                  key={attempt}
                  ref={frameRef}
                  title={t.tools.terminal.web}
                  // ttyd 支持用查询参数改客户端选项：关掉它的「离开页面」确认框（嵌在页面里时会变成浏览器原生弹窗）
                  src={`${url}?disableLeaveAlert=true`}
                  className="absolute inset-0 size-full"
                  referrerPolicy="no-referrer"
                  onLoad={() => {
                    setLoaded(attempt)
                    // 桌面上连上就能直接打字；触屏设备等用户点进去再弹键盘
                    if (window.matchMedia('(pointer: fine)').matches) frameRef.current?.focus()
                  }}
                />
              )}
              {loaded !== attempt && (
                <div className="absolute inset-0 flex items-center justify-center gap-2 text-footnote text-white/60">
                  <Spinner className="size-4" />
                  {t.tools.terminal.connecting}
                </div>
              )}
            </div>
          )}
          <p className="mt-3 text-footnote text-text-3">{t.tools.terminal.loginHint}</p>
        </>
      ) : !available ? (
        <EmptyState
          className="rounded-inner bg-sunken py-12"
          icon={<TerminalWindow weight="light" />}
          title={t.tools.terminal.unavailableTitle}
          description={t.tools.terminal.unavailableBody}
          action={
            <Button variant="secondary" asChild>
              <a href={hrefOf('tools', 'advanced')}>{t.tools.terminal.goAdvanced}</a>
            </Button>
          }
        />
      ) : (
        <EmptyState
          className="rounded-inner bg-sunken py-12"
          icon={<TerminalWindow weight="light" />}
          title={t.tools.terminal.mockTitle}
          description={t.tools.terminal.mockBody(address)}
        />
      )}
    </Panel>
  )
}

type Identity = 'root' | 'app'

const PRESETS: { key: 'smbLog' | 'keepAliveLog' | 'updateLog' | 'storage' | 'uptime' | 'processes'; command: string; root: boolean }[] = [
  { key: 'smbLog', command: 'tail -n 200 /sdcard/smb_log.log', root: true },
  { key: 'keepAliveLog', command: 'tail -n 200 /sdcard/ufi_keep_alive.log', root: true },
  { key: 'updateLog', command: 'tail -n 200 /sdcard/ufi_tools_update.log', root: false },
  { key: 'storage', command: 'df -h', root: false },
  { key: 'uptime', command: 'uptime', root: false },
  { key: 'processes', command: 'top -b -n 1 | head -30', root: true },
]

const RISKY = /\b(rm|dd|mkfs|reboot|shutdown|setprop|svc|pm\s+(uninstall|disable|clear)|chmod|chown|mv|iptables)\b/

interface RunResult {
  command: string
  identity: Identity
  output: string
  ms: number
  failed: boolean
}

function CommandRunner() {
  const t = useT()
  const confirm = useConfirm()
  const root = useRoot()
  const [identity, setIdentity] = useState<Identity | null>(null)
  const current: Identity = identity ?? (root.data ? 'root' : 'app')
  const [command, setCommand] = useState('')
  const [result, setResult] = useState<RunResult | null>(null)

  const run = useMutation({
    mutationFn: async ({ cmd, as }: { cmd: string; as: Identity }) => {
      // stderr 并进 stdout：root 通道本来就不回传 stderr，应用身份有 stderr 会被判失败
      const wrapped = `( ${cmd} ) 2>&1`
      const started = performance.now()
      try {
        const output = as === 'root' ? await rootShell(wrapped, 30_000) : await userShell(wrapped, 60_000)
        return { command: cmd, identity: as, output, ms: performance.now() - started, failed: false }
      } catch (error) {
        return { command: cmd, identity: as, output: errorMessage(error), ms: performance.now() - started, failed: true }
      }
    },
    onSuccess: setResult,
  })

  const submit = async (cmd: string, as: Identity = current) => {
    const text = cmd.trim()
    if (!text || run.isPending) return
    if (RISKY.test(text)) {
      const ok = await confirm({
        tone: 'danger',
        title: t.tools.terminal.riskyTitle,
        description: t.tools.terminal.riskyBody,
        details: <code className="block rounded-[8px] bg-sunken px-3 py-2 text-left font-mono text-[13px] break-all text-text">{text}</code>,
        confirmText: t.tools.terminal.run,
      })
      if (!ok) return
    }
    run.mutate({ cmd: text, as })
  }

  return (
    <Panel>
      <PanelHeader
        title={t.tools.terminal.command}
        action={
          <SegmentedControl
            size="sm"
            ariaLabel={t.tools.terminal.identity}
            value={current}
            onChange={setIdentity}
            options={[
              { value: 'root', label: 'Root', disabled: !root.data },
              { value: 'app', label: t.tools.terminal.app },
            ]}
          />
        }
      />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          void submit(command)
        }}
      >
        <Input
          mono
          value={command}
          onValueChange={setCommand}
          placeholder={current === 'root' ? 'cat /proc/meminfo' : 'ls /sdcard'}
          aria-label={t.tools.terminal.command}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          clearable
        />
        <Button type="submit" variant="primary" icon={<Play weight="fill" />} loading={run.isPending} disabled={!command.trim()}>
          {t.tools.terminal.run}
        </Button>
      </form>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => {
          const disabled = preset.root && !root.data
          return (
            <Tooltip key={preset.key} content={disabled ? t.tools.terminal.needsRoot : preset.command}>
              <button
                type="button"
                disabled={disabled || run.isPending}
                onClick={() => {
                  setCommand(preset.command)
                  void submit(preset.command, preset.root ? 'root' : current)
                }}
                className="ap-press h-8 rounded-full bg-[rgb(120_120_128/0.12)] px-3 text-[13px] font-medium text-text transition-colors hover:bg-[rgb(120_120_128/0.18)] disabled:pointer-events-none disabled:opacity-40 dark:bg-[rgb(120_120_128/0.24)]"
              >
                {t.tools.terminal.presets[preset.key]}
              </button>
            </Tooltip>
          )
        })}
      </div>

      <div className="relative mt-4 overflow-hidden rounded-inner bg-sunken">
        {run.isPending ? (
          <div className="flex h-40 items-center justify-center gap-2 text-footnote text-text-3">
            <Spinner className="size-4" />
            {t.tools.terminal.running2}
          </div>
        ) : result ? (
          <>
            <div className="flex items-center gap-2 border-b border-line px-4 py-2 text-caption text-text-3 max-sm:px-3">
              <span className="min-w-0 flex-1 truncate font-mono">
                {result.identity === 'root' ? '#' : '$'} {result.command}
              </span>
              <span className="shrink-0 tabular-nums">{(result.ms / 1000).toFixed(1)} s</span>
              <Tooltip content={t.common.copy}>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t.common.copy}
                  onClick={() => void copyText(result.output).then((ok) => (ok ? toast.success(t.common.copied) : toast.error(t.common.copyFailed)))}
                >
                  <Copy />
                </Button>
              </Tooltip>
              <Tooltip content={t.common.clear}>
                <Button variant="ghost" size="icon-sm" aria-label={t.common.clear} onClick={() => setResult(null)}>
                  <Broom />
                </Button>
              </Tooltip>
            </div>
            <pre
              className={cn(
                'max-h-[min(56vh,520px)] overflow-auto px-4 py-3 font-mono text-[12.5px] leading-5 whitespace-pre max-sm:px-3',
                result.failed ? 'text-danger-text' : 'text-text-2',
              )}
            >
              {result.output || t.tools.terminal.noOutput}
            </pre>
          </>
        ) : (
          <p className="flex h-40 items-center justify-center px-6 text-center text-footnote text-text-3">{t.tools.terminal.idle}</p>
        )}
      </div>
    </Panel>
  )
}
